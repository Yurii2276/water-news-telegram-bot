import { isValidHttpUrl } from "./dedup.js";
import {
  publicCategoryKey,
  standalonePublicationEligibility,
} from "./editorial.js";
import { compactStandalonePublicationEligibility } from "./compactPublication.js";
import { sourceForUrl } from "./sources.js";
import { formatPublication } from "./telegram.js";

const sleepDefault = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function localDateKey(date = new Date(), timeZone = "Europe/Kyiv") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function sourceKey(material) {
  return String(
    material?.source_id ??
    material?.sourceId ??
    material?.source_name ??
    material?.sourceName ??
    "unknown",
  ).toLowerCase();
}

export async function verifyPrimarySource(
  material,
  { fetchImpl = fetch, logger = console } = {},
) {
  if (!isValidHttpUrl(material?.url)) {
    return { verified: false, reason: "Invalid source URL" };
  }

  const expectedSource = sourceForUrl(material.url);
  const response = await fetchImpl(material.url, {
    method: "GET",
    redirect: "follow",
    headers: { "user-agent": "WaterNewsEditor/0.8 source-verification" },
    signal: AbortSignal.timeout(15_000),
  });
  const resolvedUrl = response.url || material.url;

  if (!response.ok || !isValidHttpUrl(resolvedUrl)) {
    return {
      verified: false,
      reason: `Source verification failed with HTTP ${response.status}`,
    };
  }

  if (!expectedSource) {
    logger.warn("Publishing unregistered but valid source URL", resolvedUrl);
    return { verified: true, url: resolvedUrl, unregisteredSource: true };
  }

  const resolvedSource = sourceForUrl(resolvedUrl);
  if (!resolvedSource || resolvedSource.id !== expectedSource.id) {
    return {
      verified: false,
      reason: `Source verification failed with HTTP ${response.status}`,
    };
  }

  return { verified: true, url: resolvedUrl };
}

export function createAutoPublisher({
  repository,
  telegram,
  channelId,
  maxDaily = 18,
  editorialCap = 18,
  maxLocalIncidents = 3,
  maxDailyInternational = 5,
  publicationCountTimezone = "Europe/Kyiv",
  intervalMs = 15 * 60 * 1000,
  maxRetries = 3,
  dryRun = true,
  verifySource = verifyPrimarySource,
  prepareDisplayTitle = async (material) => material,
  prepareContext = async (material) => material,
  sleep = sleepDefault,
  logger = console,
}) {
  let activePromise = null;
  let diversityDate = null;
  const categoryCounts = new Map();
  const sourceCounts = new Map();

  function isInternationalMaterial(material) {
    return ["donor", "international_tech", "technology"].includes(publicCategoryKey(material));
  }

  function isLocalIncidentMaterial(material) {
    const decision = material?.ai_decision ?? material?.aiDecision ?? {};
    const explicitCategory =
      decision.materialCategory ??
      decision.sourceCategory ??
      material?.sourceCategory ??
      material?.source_category ??
      null;
    return explicitCategory === "local_media";
  }

  function sourceDailyCap(material) {
    const key = sourceKey(material);
    if (key === "ukrvodokanal" || key.includes("ukrainian water utilities association")) return 3;
    return 6;
  }

  function incrementDiversity(material) {
    const category = publicCategoryKey(material);
    const source = sourceKey(material);
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
  }

  async function refreshDiversityCounters() {
    const today = localDateKey(new Date(), publicationCountTimezone);
    if (today === diversityDate) return;
    diversityDate = today;
    categoryCounts.clear();
    sourceCounts.clear();

    const recent = await repository.getPublished?.(100) ?? [];
    for (const material of recent) {
      if (!material?.published_at) continue;
      if (localDateKey(new Date(material.published_at), publicationCountTimezone) !== today) continue;
      incrementDiversity(material);
    }
  }

  function chooseDiverseMaterial(queue, { localIncidentsNow, internationalNow }) {
    const eligible = queue.filter((item) => {
      if (isInternationalMaterial(item) && internationalNow >= maxDailyInternational) return false;
      if (isLocalIncidentMaterial(item) && localIncidentsNow >= maxLocalIncidents) return false;
      if ((sourceCounts.get(sourceKey(item)) ?? 0) >= sourceDailyCap(item)) return false;
      return true;
    });
    if (eligible.length === 0) return null;

    // getQueue already returns editorial priority order. Use that order as the
    // tie-breaker, but prefer a category that has appeared less often today.
    let best = eligible[0];
    let bestCount = categoryCounts.get(publicCategoryKey(best)) ?? 0;
    for (const item of eligible.slice(1)) {
      const count = categoryCounts.get(publicCategoryKey(item)) ?? 0;
      if (count < bestCount) {
        best = item;
        bestCount = count;
      }
    }
    return best;
  }

  async function publishWithRetries(material) {
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const verification = await verifySource(material);
        if (!verification.verified) throw new Error(verification.reason);

        if (dryRun) {
          await repository.setStatus(
            material.id,
            "dry_run",
            "Validated in DRY_RUN; Telegram publication suppressed",
          );
          return "dry_run";
        }

        const verifiedMaterial = verification.url
          ? { ...material, url: verification.url, resolvedUrl: verification.url }
          : material;
        const titledMaterial = await prepareDisplayTitle(verifiedMaterial);
        let publicationMaterial = await prepareContext(titledMaterial);
        let eligibility = standalonePublicationEligibility(publicationMaterial);

        if (!eligibility.eligible) {
          const compactEligibility = compactStandalonePublicationEligibility(publicationMaterial);
          if (compactEligibility.eligible) {
            publicationMaterial = {
              ...publicationMaterial,
              publicDescriptionUk: compactEligibility.description,
              compactDescriptionFallback: true,
            };
            eligibility = compactEligibility;
            logger.info?.(`Publication outcome for #${material.id}: compact_fallback`);
          }
        }

        if (!eligibility.eligible) {
          await repository.setStatus(
            material.id,
            "digest_only",
            eligibility.reason ?? "insufficient_public_context",
          );
          logger.info?.(`Publication outcome for #${material.id}: digest_only (${eligibility.reason ?? "insufficient_public_context"})`);
          return "digest_only";
        }
        if (publicationMaterial.publicDescriptionUk) {
          await repository.setPublicDescription?.(material.id, publicationMaterial.publicDescriptionUk);
        }
        await telegram.sendMessage(channelId, formatPublication(publicationMaterial));
        await repository.setStatus(material.id, "published", "Automatically published");
        logger.info?.(`Publication outcome for #${material.id}: published`);
        return "published";
      } catch (error) {
        const terminal = attempt === maxRetries;
        const delayMs = 2 ** (attempt - 1) * 2_000;
        const retryAt = terminal ? null : new Date(Date.now() + delayMs);
        await repository.recordPublishFailure(
          material.id,
          error.message,
          retryAt,
          terminal,
        );
        logger.error(`Publish attempt ${attempt} failed for #${material.id}`, error);
        if (!terminal) await sleep(delayMs);
      }
    }
    logger.info?.(`Publication outcome for #${material.id}: failed`);
    return "failed";
  }

  async function drain() {
    await refreshDiversityCounters();
    let publishedToday = await repository.countPublishedToday(publicationCountTimezone);
    let publishedNow = 0;
    let simulatedNow = 0;
    let digestOnlyNow = 0;
    let localIncidentsNow = 0;
    let internationalNow = 0;
    const effectiveLimit = Math.min(maxDaily, editorialCap);

    while (publishedToday < effectiveLimit) {
      const queue = await repository.getQueue(50);
      const material = chooseDiverseMaterial(queue, { localIncidentsNow, internationalNow });
      if (!material) break;

      const outcome = await publishWithRetries(material);
      if (outcome === "published") {
        publishedToday += 1;
        publishedNow += 1;
        incrementDiversity(material);
        if (isLocalIncidentMaterial(material)) localIncidentsNow += 1;
        if (isInternationalMaterial(material)) internationalNow += 1;
        if (publishedToday < effectiveLimit) await sleep(intervalMs);
      } else if (outcome === "dry_run") {
        simulatedNow += 1;
        incrementDiversity(material);
        if (isLocalIncidentMaterial(material)) localIncidentsNow += 1;
        if (isInternationalMaterial(material)) internationalNow += 1;
        logger.info?.(`Publication outcome for #${material.id}: dry_run`);
      } else if (outcome === "digest_only") {
        digestOnlyNow += 1;
      }
    }

    return {
      publishedNow,
      simulatedNow,
      publishedToday,
      limit: effectiveLimit,
      configuredMaxDaily: maxDaily,
      editorialCap,
      maxDailyInternational,
      maxLocalIncidents,
      digestOnlyNow,
      dryRun,
    };
  }

  return {
    drain,
    kick() {
      if (!activePromise) {
        activePromise = drain()
          .catch((error) => logger.error("Auto-publisher failed", error))
          .finally(() => {
            activePromise = null;
          });
      }
    },
  };
}

export async function sendDailyTechnicalReport({
  repository,
  telegram,
  adminTelegramId,
  maxDaily = 18,
  publicationCountTimezone = "Europe/Kyiv",
}) {
  const stats = await repository.getDailyStats();
  const publishedToday = await repository.countPublishedToday(publicationCountTimezone);
  const rows = Object.entries(stats).map(([status, count]) => `${status}: ${count}`);
  await telegram.sendMessage(
    adminTelegramId,
    [
      "<b>Щоденний технічний звіт</b>",
      `Опубліковано сьогодні: <b>${publishedToday}/${maxDaily}</b>`,
      "",
      rows.length ? rows.join("\n") : "За останні 24 години змін не було.",
    ].join("\n"),
  );
}
