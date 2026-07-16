import { createUpdateHandler, runPolling, sendDailyDigest } from "./bot.js";
import { classifyArticle } from "./ai.js";
import { discoverAllSources, extractArticle } from "./collector.js";
import { getConfig, loadEnvironmentFile } from "./config.js";
import { createDatabase } from "./db.js";
import { createEditorPipeline } from "./editor.js";
import { createEmptyScanRetryController } from "./emptyScanRetry.js";
import {
  createAutoPublisher,
  sendDailyTechnicalReport,
} from "./publisher.js";
import { scheduleDaily } from "./scheduler.js";
import { createTelegramClient } from "./telegram.js";
import { prepareMaterialDisplayTitle } from "./translation.js";
import { prepareMaterialContext } from "./context.js";

loadEnvironmentFile();
const config = getConfig();
const telegram = createTelegramClient(config.token);
const repository = createDatabase(config.databaseUrl);
await repository.migrate();
if (!config.dryRun) {
  await repository.releaseDryRunMaterials();
}

const publisher = createAutoPublisher({
  repository,
  telegram,
  channelId: config.publishChatId,
  maxDaily: config.maxDailyPublications,
  intervalMs: config.postIntervalMinutes * 60 * 1000,
  maxRetries: config.publishMaxRetries,
  dryRun: config.dryRun,
  prepareDisplayTitle: (material) =>
    prepareMaterialDisplayTitle(material, {
      apiKey: config.openAiApiKey,
      model: config.openAiModel,
    }),
  prepareContext: (material) =>
    prepareMaterialContext(material, {
      apiKey: config.openAiApiKey,
      model: config.openAiModel,
    }),
});

const pipeline = createEditorPipeline({
  discover: () =>
    discoverAllSources({
      googleNewsRssUrl: config.newsRssUrl,
      limit: config.newsLimit,
    }),
  extract: (candidate) => extractArticle(candidate),
  classify: (article) =>
    classifyArticle(article, {
      apiKey: config.openAiApiKey,
      model: config.openAiModel,
  }),
  repository,
  onQueued: () => publisher.kick(),
});

const handleUpdate = createUpdateHandler({
  telegram,
  repository,
  pipeline,
  publisher,
  adminTelegramId: config.adminTelegramId,
  prepareDisplayTitle: (material) =>
    prepareMaterialDisplayTitle(material, {
      apiKey: config.openAiApiKey,
      model: config.openAiModel,
    }),
  prepareContext: (material) =>
    prepareMaterialContext(material, {
      apiKey: config.openAiApiKey,
      model: config.openAiModel,
    }),
});

const controller = new AbortController();
const morningScan = createEmptyScanRetryController({
  scan: () => pipeline.scan(),
  onQueued: () => publisher.kick(),
  telegram,
  adminTelegramId: config.adminTelegramId,
  enabled: config.emptyScanRetryEnabled,
  retryMinutes: config.emptyScanRetryMinutes,
  maxRetries: config.emptyScanMaxRetries,
  adminNotification: config.emptyScanAdminNotification,
});
const stopScheduler = scheduleDaily(
  () => morningScan.runScheduledScan(),
  config.dailyScanHourUtc,
);
const stopReportScheduler = scheduleDaily(
  () =>
    sendDailyTechnicalReport({
      repository,
      telegram,
      adminTelegramId: config.adminTelegramId,
      maxDaily: config.maxDailyPublications,
    }),
  config.dailyReportHourUtc,
);
const stopDigestScheduler = config.dailyDigestEnabled
  ? scheduleDaily(
    () =>
      sendDailyDigest({
        repository,
        telegram,
        channelId: config.dailyDigestPublishToChannel
          ? config.publishChatId
          : config.adminTelegramId,
        prepareDisplayTitle: (material) =>
          prepareMaterialDisplayTitle(material, {
            apiKey: config.openAiApiKey,
            model: config.openAiModel,
          }),
        prepareContext: (material) =>
          prepareMaterialContext(material, {
            apiKey: config.openAiApiKey,
            model: config.openAiModel,
          }),
      }),
    config.dailyDigestHourUtc,
    { minuteUtc: config.dailyDigestMinuteUtc },
  )
  : () => {};
publisher.kick();

for (const event of ["SIGINT", "SIGTERM"]) {
  process.once(event, () => {
    stopScheduler();
    stopReportScheduler();
    stopDigestScheduler();
    morningScan.reset();
    controller.abort();
  });
}

console.log("Water News intelligent editor started");

try {
  await runPolling({
    telegram,
    handleUpdate,
    timeoutSeconds: config.pollingTimeoutSeconds,
    signal: controller.signal,
  });
} finally {
  await repository.close();
}
