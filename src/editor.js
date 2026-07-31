import { findDuplicate, isValidHttpUrl } from "./dedup.js";
import { resolvedDedupPool, shouldRunCandidateDedup } from "./dedupPolicy.js";
import {
  SOURCE_CATEGORIES,
  PRIORITY_LEVELS,
  classifyMaterialProfile,
  enrichDecisionWithProfile,
  isNoiseOnly,
  preliminaryFilter,
  titleKeywordFallback,
} from "./topics.js";
import { rescueTitleFallback } from "./relevanceRescue.js";
import {
  createStoryKey,
  inferSourceQuality,
  factualExtract,
  standalonePublicationEligibility,
} from "./editorial.js";

function createReport(discovered) {
  return {
    discovered,
    queued: 0,
    rejected: 0,
    duplicates: 0,
    duplicateBy: {
      url: 0,
      title: 0,
      story: 0,
      content: 0,
      other: 0,
    },
    duplicateItems: [],
    accepted_title_keyword_fallback: 0,
    accepted_ai_unavailable_fallback: 0,
    normative_act: 0,
    google_news_resolved_url: 0,
    google_news_unresolved_url: 0,
    source_fetch_failures: 0,
    transient_retries: 0,
    google_queries_executed: 0,
    direct_sources_attempted: 0,
    direct_sources_skipped_google_news_only: 0,
    direct_sources_skipped_cooldown: 0,
    transient_failures: 0,
    permanent_failures: 0,
    recovered_sources: 0,
    candidates_discovered: 0,
    story_clusters: 0,
    standalone_eligible: 0,
    insufficient_public_context: 0,
    scheduled_retry_attempt: 0,
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
  const standalone = standalonePublicationEligibility(material);
  if (standalone.eligible) report.standalone_eligible += 1;
  else if (standalone.reason === "insufficient_public_context" || standalone.reason === "title_only") {
    report.insufficient_public_context += 1;
  }
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

function recordDuplicate(report, candidate, duplicate) {
  const reason = duplicate?.reason ?? "other";
  report.duplicates += 1;
  report.duplicateBy[reason] = (report.duplicateBy[reason] ?? 0) + 1;
  if (report.duplicateItems.length < 10) {
    report.duplicateItems.push({
      title: candidate?.title || "(без заголовка)",
      reason,
      matchedTitle: duplicate?.material?.title ?? null,
      matchedId: duplicate?.material?.id ?? null,
    });
  }
}

function fallbackCategory(keyword) {
  if (/НКРЕКП|закон|стратег/i.test(keyword)) return "legislation";
  if (/тариф|інвестиційн|вартість|коштує|подорожча/i.test(keyword)) return "tariffs";
  if (/WASH|донор|world bank|ebrd|unicef|undp|usaid/i.test(keyword)) return "donors";
  if (/smart water|leak detection|non-revenue|wastewater treatment|sludge|digital water|desalination/i.test(keyword)) return "technology";
  if (/очисн|водовідвед|каналізаці/i.test(keyword)) return "wastewater";
  if (/питн|якість|забруднен|колодяз/i.test(keyword)) return "drinking_water";
  if (/відключ|перекрит|без води|не буде води/i.test(keyword)) return "outages";
  if (/водоканал|водогін|водопровод|водопостач|втрати води/i.test(keyword)) return "water_supply";
  if (/комунальн/i.test(keyword)) return "utilities";
  return "water_supply";
}

function fallbackDecision(candidate, fallback, preliminaryCategories = []) {
  const snippet = String(candidate.summary ?? candidate.snippet ?? "").trim();
  return enrichDecisionWithProfile({
    relevant: true,
    relevanceScore: 90,
    category: fallback.category ?? fallbackCategory(fallback.keyword),
    importance: 60,
    confidence: "high",
    confidenceScore: 90,
    summary: snippet,
    whyImportant: "",
    hashtags: ["#вода"],
    titleKeywordFallback: true,
    fallbackKeyword: fallback.keyword,
    contextBasis: snippet ? "rss_snippet" : "title_only",
  }, candidate, preliminaryCategories);
}

function aiUnavailableDecision(article, preliminaryCategories = [], error = undefined) {
  const summary = String(article.summary ?? article.snippet ?? "").trim();
  const category = preliminaryCategories[0] ?? "water_supply";
  return enrichDecisionWithProfile({
    relevant: true,
    relevanceScore: 75,
    category,
    importance: 60,
    confidence: "medium",
    confidenceScore: 70,
    summary,
    whyImportant: "",
    hashtags: ["#вода"],
    aiUnavailableFallback: true,
    aiError: String(error?.message ?? error ?? "OpenAI unavailable").slice(0, 300),
    contextBasis: article.content ? "full_article" : summary ? "rss_snippet" : "title_only",
  }, article, preliminaryCategories);
}

async function extractForFallback(candidate, extract, logger) {
  try {
    const article = await extract(candidate);
    if (article?.extractionStatus === "ok") return { ...article, contextBasis: "full_article" };
    return {
      ...candidate,
      ...(article ?? {}),
      title: article?.title || candidate.title,
      url: article?.url || candidate.url,
      content: String(candidate.summary ?? candidate.snippet ?? "").trim(),
      extractionStatus: article?.extractionStatus ?? "fallback_without_extraction",
      contextBasis: candidate.summary || candidate.snippet ? "rss_snippet" : "title_only",
      sourceTrusted: article?.sourceTrusted ?? candidate.sourceTrusted ?? false,
    };
  } catch (error) {
    logger.warn?.(`Fallback extraction failed: ${candidate.url}`, error);
    return {
      ...candidate,
      content: String(candidate.summary ?? candidate.snippet ?? "").trim(),
      extractionStatus: "fallback_extraction_error",
      contextBasis: candidate.summary || candidate.snippet ? "rss_snippet" : "title_only",
      sourceTrusted: candidate.sourceTrusted ?? false,
    };
  }
}

function enrichMaterialForStorage(material, aiDecision = undefined) {
  return {
    ...material,
    storyKey: material.storyKey ?? material.story_key ?? createStoryKey(material),
    sourceQuality: material.sourceQuality ?? material.source_quality ?? inferSourceQuality(material),
    contextBasis: material.contextBasis ?? material.context_basis ?? aiDecision?.contextBasis ?? (material.content ? "full_article" : "title_only"),
    professionalContextUk: material.professionalContextUk ?? factualExtract(material),
  };
}

function discoveredViaGoogleNews(candidate) {
  return candidate?.sourceId === "google_news" || String(candidate?.discoveryMethod ?? "").startsWith("google_news");
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
      Object.assign(report, candidates.diagnostics ?? {});

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

        if (shouldRunCandidateDedup(candidate)) {
          const candidateDuplicate = findDuplicate(candidate, existing);
          if (candidateDuplicate.duplicate) {
            recordDuplicate(report, candidate, candidateDuplicate);
            continue;
          }
        }

        const originalFallback = titleKeywordFallback(candidate.title);
        const fallback = originalFallback.accepted
          ? { ...originalFallback, category: null }
          : rescueTitleFallback(candidate);

        if (fallback.accepted) {
          const fallbackArticle = await extractForFallback(candidate, extract, logger);
          const decision = fallbackDecision(fallbackArticle, fallback, initialFilter.categories);
          const material = enrichMaterialForStorage(fallbackArticle, decision);
          const storyDuplicate = findDuplicate(material, resolvedDedupPool(existing, candidate));
          if (storyDuplicate.duplicate) {
            recordDuplicate(report, material, storyDuplicate);
            continue;
          }
          const acceptedMaterial = { ...material, aiDecision: decision };
          const saved = await repository.saveMaterial({
            ...acceptedMaterial,
            status: "queued",
            statusReason: `Accepted by water-sector headline rescue: ${fallback.keyword}`,
            preliminaryCategories: initialFilter.categories,
            aiDecision: decision,
          });
          existing.push(saved ?? acceptedMaterial);
          report.queued += 1;
          report.accepted_title_keyword_fallback += 1;
          recordAccepted(report, acceptedMaterial, initialFilter.categories);
          await onQueued(saved ?? acceptedMaterial);
          continue;
        }

        const deepInspectionAllowed = discoveredViaGoogleNews(candidate);
        if (!initialFilter.relevant && !deepInspectionAllowed) {
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

        if (!article.sourceTrusted && !discoveredViaGoogleNews(candidate)) {
          const reason = "Посилання не належить надійному джерелу";
          await saveRejected(repository, article, "rejected_source", reason, initialFilter.categories);
          recordRejection(report, article, "missingContentOrLink", reason);
          continue;
        }

        const duplicate = findDuplicate(article, resolvedDedupPool(existing, candidate));
        if (duplicate.duplicate) {
          recordDuplicate(report, article, duplicate);
          continue;
        }

        const contentFilter = preliminaryFilter(article);
        if (isNoiseOnly(article)) {
          await saveRejected(repository, article, "filtered_out", "Noise-only item without water-sector utility context", contentFilter.categories);
          recordRejection(report, article, "irrelevant", "Noise-only item without water-sector utility context");
          continue;
        }

        let decision;
        let aiUnavailable = false;
        try {
          decision = enrichDecisionWithProfile(await classify(article), article, contentFilter.categories);
        } catch (error) {
          if (!article.sourceTrusted && !contentFilter.relevant) {
            const reason = "OpenAI недоступний, а детермінований фільтр не підтвердив водний контекст";
            logger.error(`OpenAI classification failed for untrusted non-water source: ${article.url}`, error);
            await saveRejected(repository, article, "filtered_out", reason, contentFilter.categories);
            recordRejection(report, article, "openaiError", reason);
            continue;
          }
          logger.error(`OpenAI classification failed; deterministic fallback used: ${article.url}`, error);
          decision = aiUnavailableDecision(article, contentFilter.categories, error);
          aiUnavailable = true;
        }

        const acceptedMaterial = {
          ...enrichMaterialForStorage(article, decision),
          aiDecision: decision,
        };
        const saved = await repository.saveMaterial({
          ...acceptedMaterial,
          status: decision.relevant ? "queued" : "rejected_ai",
          statusReason: aiUnavailable
            ? "Accepted by deterministic fallback because OpenAI classification was unavailable"
            : decision.rejectionReason || null,
          preliminaryCategories: contentFilter.categories,
          aiDecision: decision,
        });

        if (decision.relevant) {
          existing.push(saved ?? acceptedMaterial);
          report.queued += 1;
          if (aiUnavailable) report.accepted_ai_unavailable_fallback += 1;
          recordAccepted(report, acceptedMaterial, contentFilter.categories);
          await onQueued(saved ?? acceptedMaterial);
        } else {
          recordRejection(report, article, "irrelevant", decision.rejectionReason || "AI визначив матеріал нерелевантним");
        }
      }

      report.story_clusters = new Set(existing.map((material) => material.storyKey ?? material.story_key ?? createStoryKey(material))).size;
      return report;
    },
  };
}
