const DEFAULT_RSS_URL =
  "https://news.google.com/rss/search?q=%D0%B2%D0%BE%D0%B4%D0%B0+OR+%D0%B2%D0%BE%D0%B4%D0%BE%D0%BF%D0%BE%D1%81%D1%82%D0%B0%D1%87%D0%B0%D0%BD%D0%BD%D1%8F&hl=uk&gl=UA&ceid=UA:uk";

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function integerInRange(value, fallback, name, minimum, maximum) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function booleanValue(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

export function loadEnvironmentFile() {
  try {
    process.loadEnvFile();
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

export function getConfig(env = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is required. Copy .env.example to .env and add the token.",
    );
  }

  const adminTelegramId = positiveInteger(
    env.ADMIN_TELEGRAM_ID,
    undefined,
    "ADMIN_TELEGRAM_ID",
  );
  if (!adminTelegramId) {
    throw new Error("ADMIN_TELEGRAM_ID is required");
  }

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const openAiApiKey = env.OPENAI_API_KEY?.trim();
  if (!openAiApiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }

  const publishChatId = env.PUBLISH_CHAT_ID?.trim();
  if (!publishChatId) {
    throw new Error("PUBLISH_CHAT_ID is required for automatic publishing");
  }

  return {
    token,
    dryRun: booleanValue(env.DRY_RUN, true, "DRY_RUN"),
    adminTelegramId,
    publishChatId,
    databaseUrl,
    openAiApiKey,
    openAiModel: env.OPENAI_MODEL?.trim() || "gpt-5.4-mini",
    newsRssUrl: env.NEWS_RSS_URL?.trim() || DEFAULT_RSS_URL,
    newsLimit: positiveInteger(env.NEWS_LIMIT, 20, "NEWS_LIMIT"),
    pollingTimeoutSeconds: positiveInteger(
      env.POLLING_TIMEOUT_SECONDS,
      30,
      "POLLING_TIMEOUT_SECONDS",
    ),
    dailyScanHourUtc: integerInRange(
      env.DAILY_SCAN_HOUR_UTC,
      5,
      "DAILY_SCAN_HOUR_UTC",
      0,
      23,
    ),
    dailyReportHourUtc: integerInRange(
      env.DAILY_REPORT_HOUR_UTC,
      18,
      "DAILY_REPORT_HOUR_UTC",
      0,
      23,
    ),
    dailyDigestEnabled: booleanValue(
      env.DAILY_DIGEST_ENABLED,
      true,
      "DAILY_DIGEST_ENABLED",
    ),
    dailyDigestHourUtc: integerInRange(
      env.DAILY_DIGEST_HOUR_UTC,
      13,
      "DAILY_DIGEST_HOUR_UTC",
      0,
      23,
    ),
    dailyDigestMinuteUtc: integerInRange(
      env.DAILY_DIGEST_MINUTE_UTC,
      40,
      "DAILY_DIGEST_MINUTE_UTC",
      0,
      59,
    ),
    dailyDigestPublishToChannel: booleanValue(
      env.DAILY_DIGEST_PUBLISH_TO_CHANNEL,
      true,
      "DAILY_DIGEST_PUBLISH_TO_CHANNEL",
    ),
    dailyDigestTimezone: env.DAILY_DIGEST_TIMEZONE?.trim() || "Europe/Kyiv",
    dailyDigestLocalHour: integerInRange(
      env.DAILY_DIGEST_LOCAL_HOUR,
      16,
      "DAILY_DIGEST_LOCAL_HOUR",
      0,
      23,
    ),
    dailyDigestLocalMinute: integerInRange(
      env.DAILY_DIGEST_LOCAL_MINUTE,
      40,
      "DAILY_DIGEST_LOCAL_MINUTE",
      0,
      59,
    ),
    weeklyAnalysisEnabled: booleanValue(
      env.WEEKLY_ANALYSIS_ENABLED,
      true,
      "WEEKLY_ANALYSIS_ENABLED",
    ),
    weeklyAnalysisTimezone: env.WEEKLY_ANALYSIS_TIMEZONE?.trim() || "Europe/Kyiv",
    weeklyAnalysisLocalWeekday: integerInRange(
      env.WEEKLY_ANALYSIS_LOCAL_WEEKDAY,
      5,
      "WEEKLY_ANALYSIS_LOCAL_WEEKDAY",
      1,
      7,
    ),
    weeklyAnalysisLocalHour: integerInRange(
      env.WEEKLY_ANALYSIS_LOCAL_HOUR,
      15,
      "WEEKLY_ANALYSIS_LOCAL_HOUR",
      0,
      23,
    ),
    weeklyAnalysisLocalMinute: integerInRange(
      env.WEEKLY_ANALYSIS_LOCAL_MINUTE,
      0,
      "WEEKLY_ANALYSIS_LOCAL_MINUTE",
      0,
      59,
    ),
    weeklyAnalysisPublishToChannel: booleanValue(
      env.WEEKLY_ANALYSIS_PUBLISH_TO_CHANNEL,
      true,
      "WEEKLY_ANALYSIS_PUBLISH_TO_CHANNEL",
    ),
    emptyScanRetryEnabled: booleanValue(
      env.EMPTY_SCAN_RETRY_ENABLED,
      true,
      "EMPTY_SCAN_RETRY_ENABLED",
    ),
    emptyScanRetryMinutes: positiveInteger(
      env.EMPTY_SCAN_RETRY_MINUTES,
      60,
      "EMPTY_SCAN_RETRY_MINUTES",
    ),
    emptyScanMaxRetries: integerInRange(
      env.EMPTY_SCAN_MAX_RETRIES,
      2,
      "EMPTY_SCAN_MAX_RETRIES",
      1,
      10,
    ),
    emptyScanAdminNotification: booleanValue(
      env.EMPTY_SCAN_ADMIN_NOTIFICATION,
      true,
      "EMPTY_SCAN_ADMIN_NOTIFICATION",
    ),
    maxDailyPublications: integerInRange(
      env.MAX_DAILY_PUBLICATIONS,
      18,
      "MAX_DAILY_PUBLICATIONS",
      1,
      50,
    ),
    publicationEditorialCap: integerInRange(
      env.PUBLICATION_EDITORIAL_CAP,
      18,
      "PUBLICATION_EDITORIAL_CAP",
      1,
      50,
    ),
    maxDailyLocalIncidents: integerInRange(
      env.MAX_DAILY_LOCAL_INCIDENTS,
      3,
      "MAX_DAILY_LOCAL_INCIDENTS",
      0,
      10,
    ),
    publicationCountTimezone: env.PUBLICATION_COUNT_TIMEZONE?.trim() || "Europe/Kyiv",
    internationalNewsEnabled: booleanValue(
      env.INTERNATIONAL_NEWS_ENABLED,
      true,
      "INTERNATIONAL_NEWS_ENABLED",
    ),
    maxDailyInternationalPosts: integerInRange(
      env.MAX_DAILY_INTERNATIONAL_POSTS,
      5,
      "MAX_DAILY_INTERNATIONAL_POSTS",
      0,
      18,
    ),
    internationalStoryMaxAgeDays: integerInRange(
      env.INTERNATIONAL_STORY_MAX_AGE_DAYS,
      7,
      "INTERNATIONAL_STORY_MAX_AGE_DAYS",
      1,
      30,
    ),
    sourcePermanentFailureThreshold: integerInRange(
      env.SOURCE_PERMANENT_FAILURE_THRESHOLD,
      3,
      "SOURCE_PERMANENT_FAILURE_THRESHOLD",
      1,
      20,
    ),
    sourcePermanentFailureCooldownHours: positiveInteger(
      env.SOURCE_PERMANENT_FAILURE_COOLDOWN_HOURS,
      168,
      "SOURCE_PERMANENT_FAILURE_COOLDOWN_HOURS",
    ),
    sourceFailureNotificationCooldownHours: positiveInteger(
      env.SOURCE_FAILURE_NOTIFICATION_COOLDOWN_HOURS,
      24,
      "SOURCE_FAILURE_NOTIFICATION_COOLDOWN_HOURS",
    ),
    postIntervalMinutes: positiveInteger(
      env.POST_INTERVAL_MINUTES,
      15,
      "POST_INTERVAL_MINUTES",
    ),
    publishMaxRetries: integerInRange(
      env.PUBLISH_MAX_RETRIES,
      3,
      "PUBLISH_MAX_RETRIES",
      1,
      10,
    ),
  };
}
