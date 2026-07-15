import { findDuplicate, isValidHttpUrl } from "./dedup.js";
import {
  SOURCE_CATEGORIES,
  PRIORITY_LEVELS,
  classifyMaterialProfile,
  enrichDecisionWithProfile,
  isNoiseOnly,
  preliminaryFilter,
  titleKeywordFallback,
} from "./topics.js";

function createReport(discovered) {
  return {
    discovered,
    queued: 0,
    rejected: 0,
    duplicates: 0,
    accepted_title_keyword_fallback: 0,
    normative_act: 0,
    google_news_resolved_url: 0,
    google_news_unresolved_url: 0,
    categories: Object.fromEntries(SOURCE_CATEGORIES.map((category) => [category, 0])),
    priorities: Object.fromEntries(PRIORITY_LEVELS.map((priority) => [priority, 0])),
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

function recordAccepted(report, material, categories = []) {
  const profile = classifyMaterialProfile(material, categories);
  report.categories[profile.materialCategory] = (report.categories[profile.materialCategory] ?? 0) + 1;
  report.priorities[profile.priorityLevel] = (report.priorities[profile.priorityLevel] ?? 0) + 1;
  if (profile.normativeAct || profile.normative_act) report.normative_act += 1;
  if (material.googleNewsUrlResolved) report.google_news_resolved_url += 1;
  if (material.googleNewsUrlUnresolved) report.google_news_unresolved_url += 1;
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

function fallbackCategory(keyword) {
  if (/НКРЕКП|закон|стратег/i.test(keyword)) return "legislation";
  if (/тариф|інвестиційн|вартість/i.test(keyword)) return "tariffs";
  if (/WASH|донор|world bank|ebrd|unicef|undp|usaid/i.test(keyword)) return "donors";
  if (/smart water|leak detection|non-revenue|wastewater treatment|sludge|digital water|desalination/i.test(keyword)) return "technology";
  if (/очисн|водовідвед|каналізаці/i.test(keyword)) return "wastewater";
  if (/питн|якість/i.test(keyword)) return "drinking_water";
  if (/водоканал|водогін|водопровод|водопостач|втрати води/i.test(keyword)) return "water_supply";
  if (/тариф|вартість/i.test(keyword)) return "tariffs";
  if (/водоканал|зношені мережі|втрати води/i.test(keyword)) return "utilities";
  if (/водовідвед/i.test(keyword)) return "wastewater";
  if (/питн|каламут/i.test(keyword)) return "drinking_water";
  return "water_supply";
}

function fallbackDecision(candidate, keyword, preliminaryCategories = []) {
  const snippet = String(candidate.summary ?? candidate.snippet ?? "").trim();
  return enrichDecisionWithProfile({
    relevant: true,
    relevanceScore: 90,
    category: fallbackCategory(keyword),
    importance: 60,
    confidence: "high",
    confidenceScore: 90,
    summary: snippet,
    whyImportant: "",
    hashtags: ["#вода"],
    titleKeywordFallback: true,
    fallbackKeyword: keyword,
  }, candidate, preliminaryCategories);
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
        if (isNoiseOnly(candidate)) {
          await saveRejected(repository, candidate, "filtered_out", "Noise-only item without water-sector utility context");
          recordRejection(report, candidate, "irrelevant", "Noise-only item without water-sector utility context");
          continue;
        }
        const candidateDuplicate = findDuplicate(candidate, existing);
        if (candidateDuplicate.duplicate) {
          await saveRejected(repository, candidate, "duplicate", `Duplicate by ${candidateDuplicate.reason}`, initialFilter.categories);
          report.duplicates += 1;
          continue;
        }

        const fallback = titleKeywordFallback(candidate.title);
        if (fallback.accepted) {
          const decision = fallbackDecision(candidate, fallback.keyword, initialFilter.categories);
          const snippet = String(candidate.summary ?? candidate.snippet ?? "").trim();
          const saved = await repository.saveMaterial({
            ...candidate,
            content: snippet,
            status: "queued",
            statusReason: `Accepted by title keyword fallback: ${fallback.keyword}`,
            preliminaryCategories: initialFilter.categories,
            aiDecision: decision,
          });
          existing.push(candidate);
          report.queued += 1;
          report.accepted_title_keyword_fallback += 1;
          recordAccepted(report, candidate, initialFilter.categories);
          await onQueued(saved);
          continue;
        }

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
        if (isNoiseOnly(article)) {
          await saveRejected(repository, article, "filtered_out", "Noise-only item without water-sector utility context", contentFilter.categories);
          recordRejection(report, article, "irrelevant", "Noise-only item without water-sector utility context");
          existing.push(article);
          continue;
        }
        let decision;
        try {
          decision = enrichDecisionWithProfile(await classify(article), article, contentFilter.categories);
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
          recordAccepted(report, article, contentFilter.categories);
          await onQueued(saved);
        } else {
          recordRejection(report, article, "irrelevant", decision.rejectionReason || "AI визначив матеріал нерелевантним");
        }
      }

      return report;
    },
  };
}
