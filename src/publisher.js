import { sourceForUrl } from "./sources.js";
import { formatPublication } from "./telegram.js";

const sleepDefault = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function verifyPrimarySource(
  material,
  { fetchImpl = fetch } = {},
) {
  const expectedSource = sourceForUrl(material.url);
  if (!expectedSource) {
    return { verified: false, reason: "URL is outside the trusted-source registry" };
  }

  const response = await fetchImpl(material.url, {
    method: "GET",
    redirect: "follow",
    headers: { "user-agent": "WaterNewsEditor/0.3 source-verification" },
    signal: AbortSignal.timeout(15_000),
  });
  const resolvedSource = sourceForUrl(response.url || material.url);
  if (!response.ok || !resolvedSource || resolvedSource.id !== expectedSource.id) {
    return {
      verified: false,
      reason: `Source verification failed with HTTP ${response.status}`,
    };
  }

  return { verified: true, url: response.url || material.url };
}

export function createAutoPublisher({
  repository,
  telegram,
  channelId,
  maxDaily = 10,
  intervalMs = 15 * 60 * 1000,
  maxRetries = 3,
  dryRun = true,
  verifySource = verifyPrimarySource,
  sleep = sleepDefault,
  logger = console,
}) {
  let activePromise = null;

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

        await telegram.sendMessage(channelId, formatPublication(material));
        await repository.setStatus(material.id, "published", "Automatically published");
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
    return "failed";
  }

  async function drain() {
    let publishedToday = await repository.countPublishedToday();
    let publishedNow = 0;
    let simulatedNow = 0;

    while (publishedToday < maxDaily) {
      const [material] = await repository.getQueue(1);
      if (!material) break;

      const outcome = await publishWithRetries(material);
      if (outcome === "published") {
        publishedToday += 1;
        publishedNow += 1;
        if (publishedToday < maxDaily) await sleep(intervalMs);
      } else if (outcome === "dry_run") {
        simulatedNow += 1;
      }
    }

    return {
      publishedNow,
      simulatedNow,
      publishedToday,
      limit: maxDaily,
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
  maxDaily = 10,
}) {
  const stats = await repository.getDailyStats();
  const publishedToday = await repository.countPublishedToday();
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
