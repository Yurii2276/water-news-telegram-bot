import { findDuplicate, isValidHttpUrl } from "./dedup.js";
import { preliminaryFilter } from "./topics.js";

function createReport(discovered) {
  return {
    discovered,
    queued: 0,
    rejected: 0,
    duplicates: 0,
    rejectedBy: {
      irrelevant: 0,
      openaiError: 0,
      missingContentOrLink: 0,
      rejected_missing_url: 0,
      rejected_invalid_url: 0,
      other: 0,
    },
    rejectedItems: [],
  };
}

function recordRejection(report, candidate, type, reason) {
  report.rejected += 1;
  report.rejectedBy[type] += 1;
  if (report.rejectedItems.length < 10) {
    report.rejectedItems.push({
      title: candidate.title || "(без заголовка)",
      reason,
      type,
    });
  }
}

export async function saveRejected(repository, material, status, reason, categories = []) {
  if (!isValidHttpUrl(material?.url)) return null;
  return repository.saveMaterial({
    ...material,
    content: material.content ?? "",
    status,
    statusReason: reason,
    preliminaryCategories: categories,
  });
}

export function createEditorPipeline({
  discover,
  extract,
  classify,
  repository,
  onQueued = async () => {},
  logger = console,
}) {
  return {
    async scan() {
      const candidates = await discover();
      const existing = await repository.listForDedup();
      const report = createReport(candidates.length);

      for (const candidate of candidates) {
        if (!candidate?.url) {
          recordRejection(report, candidate ?? {}, "rejected_missing_url", "Відсутнє посилання на матеріал");
          continue;
        }
        if (!isValidHttpUrl(candidate.url)) {
          recordRejection(report, candidate, "rejected_invalid_url", "Некоректне посилання на матеріал");
          continue;
        }

        const initialFilter = preliminaryFilter(candidate);
        if (!initialFilter.relevant) {
          await saveRejected(repository, candidate, "filtered_out", initialFilter.reason);
          recordRejection(report, candidate, "irrelevant", initialFilter.reason);
          continue;
        }

        let article;
        try {
          article = await extract(candidate);
        } catch (error) {
          const reason = `Extraction error: ${error.message}`;
          logger.error(`Article extraction failed: ${candidate.url}`, error);
          await saveRejected(repository, candidate, "filtered_out", reason);
          recordRejection(report, candidate, "missingContentOrLink", reason);
          continue;
        }

        if (article.extractionStatus !== "ok") {
          const reason = article.extractionStatus === "unresolved_primary_source"
            ? "Не вдалося визначити посилання на першоджерело"
            : "Недостатньо тексту першоджерела";
          await saveRejected(repository, article, "filtered_out", reason, initialFilter.categories);
          recordRejection(report, article, "missingContentOrLink", reason);
          continue;
        }

        if (!article.sourceTrusted) {
          const reason = "Посилання не належить надійному джерелу";
          await saveRejected(repository, article, "rejected_source", reason, initialFilter.categories);
          recordRejection(report, article, "missingContentOrLink", reason);
          continue;
        }

        const duplicate = findDuplicate(article, existing);
        if (duplicate.duplicate) {
          await saveRejected(repository, article, "duplicate", `Duplicate by ${duplicate.reason}`, initialFilter.categories);
          report.duplicates += 1;
          continue;
        }

        const contentFilter = preliminaryFilter(article);
        let decision;
        try {
          decision = await classify(article);
        } catch (error) {
          const reason = `OpenAI error: ${error.message}`;
          logger.error(`OpenAI classification failed: ${article.url}`, error);
          await saveRejected(repository, article, "rejected_ai_error", reason, contentFilter.categories);
          recordRejection(report, article, "openaiError", reason);
          existing.push(article);
          continue;
        }

        const saved = await repository.saveMaterial({
          ...article,
          status: decision.relevant ? "queued" : "rejected_ai",
          statusReason: decision.rejectionReason || null,
          preliminaryCategories: contentFilter.categories,
          aiDecision: decision,
        });
        existing.push(article);

        if (decision.relevant) {
          report.queued += 1;
          await onQueued(saved);
        } else {
          recordRejection(report, article, "irrelevant", decision.rejectionReason || "AI визначив матеріал нерелевантним");
        }
      }

      return report;
    },
  };
}
