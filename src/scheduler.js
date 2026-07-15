const DAY_MS = 24 * 60 * 60 * 1000;

function millisecondsUntilTimeUtc(hour, minute = 0, now = new Date()) {
  const next = new Date(now);
  next.setUTCHours(hour, minute, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export function scheduleDaily(task, hourUtc, { minuteUtc = 0, logger = console } = {}) {
  let dailyTimer;
  const firstTimer = setTimeout(async function run() {
    try {
      await task();
    } catch (error) {
      logger.error("Scheduled scan failed", error);
    }
    dailyTimer = setInterval(async () => {
      try {
        await task();
      } catch (error) {
        logger.error("Scheduled scan failed", error);
      }
    }, DAY_MS);
  }, millisecondsUntilTimeUtc(hourUtc, minuteUtc));

  firstTimer.unref?.();
  return () => {
    clearTimeout(firstTimer);
    clearInterval(dailyTimer);
  };
}

export { millisecondsUntilTimeUtc, millisecondsUntilTimeUtc as millisecondsUntilHourUtc };
