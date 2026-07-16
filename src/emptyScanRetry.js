const EMPTY_SCAN_MESSAGE =
  "⚠️ Ранковий збір не отримав нових матеріалів. Частина джерел тимчасово недоступна. Автоматичний повтор через {minutes} хвилин.";

const RETRY_SUCCESS_MESSAGE =
  "✅ Повторний збір завершено. Знайдено: {discovered}, поставлено в чергу: {queued}.";

const RETRY_EXHAUSTED_MESSAGE =
  "⚠️ Після повторних спроб нових матеріалів не отримано. Щоденний підсумок буде сформовано з доступних даних.";

export function isEmptyScanReport(report) {
  return report?.discovered === 0 ||
    (report?.queued === 0 && report?.duplicates === 0 && report?.rejected === 0);
}

export function shouldScheduleEmptyScanRetry(report) {
  if (!isEmptyScanReport(report)) return false;
  if (report?.duplicates > 0) return false;
  return true;
}

function format(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

export function createEmptyScanRetryController({
  scan,
  onQueued = async () => {},
  telegram,
  adminTelegramId,
  enabled = true,
  retryMinutes = 60,
  maxRetries = 2,
  adminNotification = true,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  logger = console,
}) {
  let retryTimer = null;
  let retryAttempt = 0;

  function reset() {
    if (retryTimer) clearTimer(retryTimer);
    retryTimer = null;
    retryAttempt = 0;
  }

  async function notify(text) {
    if (!adminNotification || !telegram || !adminTelegramId) return;
    await telegram.sendMessage(adminTelegramId, text);
  }

  function scheduleRetry() {
    if (!enabled || retryTimer || retryAttempt >= maxRetries) return false;
    retryAttempt += 1;
    retryTimer = setTimer(async () => {
      retryTimer = null;
      try {
        const report = await scan();
        report.scheduled_retry_attempt = retryAttempt;
        if (shouldScheduleEmptyScanRetry(report)) {
          if (retryAttempt >= maxRetries) {
            await notify(RETRY_EXHAUSTED_MESSAGE);
            reset();
          } else {
            scheduleRetry();
          }
          return;
        }
        reset();
        await notify(format(RETRY_SUCCESS_MESSAGE, report));
        await onQueued(report);
      } catch (error) {
        logger.error("Scheduled empty-scan retry failed", error);
        if (retryAttempt >= maxRetries) {
          await notify(RETRY_EXHAUSTED_MESSAGE);
          reset();
        } else {
          scheduleRetry();
        }
      }
    }, retryMinutes * 60 * 1000);
    retryTimer.unref?.();
    return true;
  }

  async function runScheduledScan() {
    const report = await scan();
    if (shouldScheduleEmptyScanRetry(report)) {
      if (scheduleRetry()) {
        await notify(format(EMPTY_SCAN_MESSAGE, { minutes: retryMinutes }));
      }
    } else {
      reset();
      await onQueued(report);
    }
    return report;
  }

  return {
    runScheduledScan,
    reset,
    state: () => ({ retryAttempt, retryScheduled: Boolean(retryTimer) }),
  };
}
