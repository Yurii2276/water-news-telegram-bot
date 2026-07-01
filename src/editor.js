import { findDuplicate } from "./dedup.js";
import { preliminaryFilter } from "./topics.js";

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
      const report = { discovered: candidates.length, queued: 0, rejected: 0, duplicates: 0 };

      for (const candidate of candidates) {
        try {
          const initialFilter = preliminaryFilter(candidate);
          if (!initialFilter.relevant) {
            await repository.saveMaterial({
              ...candidate,
              content: "",
              status: "filtered_out",
              statusReason: initialFilter.reason,
              preliminaryCategories: [],
            });
            report.rejected += 1;
            continue;
          }

          const article = await extract(candidate);
          if (article.extractionStatus !== "ok") {
            await repository.saveMaterial({
              ...article,
              status: "filtered_out",
              statusReason: article.extractionStatus,
              preliminaryCategories: initialFilter.categories,
            });
            report.rejected += 1;
            continue;
          }

          if (!article.sourceTrusted) {
            await repository.saveMaterial({
              ...article,
              status: "rejected_source",
              statusReason: "Source URL is not in the trusted-source registry",
              preliminaryCategories: initialFilter.categories,
            });
            report.rejected += 1;
            continue;
          }

          const duplicate = findDuplicate(article, existing);
          if (duplicate.duplicate) {
            await repository.saveMaterial({
              ...article,
              status: "duplicate",
              statusReason: `Duplicate by ${duplicate.reason}`,
              preliminaryCategories: initialFilter.categories,
            });
            report.duplicates += 1;
            continue;
          }

          const contentFilter = preliminaryFilter(article);
          const decision = await classify(article);
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
            report.rejected += 1;
          }
        } catch (error) {
          logger.error(`Candidate processing failed: ${candidate.url}`, error);
          report.rejected += 1;
        }
      }

      return report;
    },
  };
}
