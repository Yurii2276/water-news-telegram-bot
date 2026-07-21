const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

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

export function timeZoneParts(date, timeZone = "Europe/Kyiv") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[map.weekday];
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday,
    dateKey: `${map.year}-${map.month}-${map.day}`,
  };
}

function localTimeDifferenceMs(candidateUtc, timeZone, hour, minute, targetWeekday = null) {
  const parts = timeZoneParts(candidateUtc, timeZone);
  const minuteDelta = (hour * 60 + minute) - (parts.hour * 60 + parts.minute);
  const weekdayDelta = targetWeekday === null ? 0 : (targetWeekday - parts.weekday + 7) % 7;
  return (weekdayDelta * DAY_MS) + (minuteDelta * 60 * 1000) - (parts.second * 1000) - candidateUtc.getMilliseconds();
}

export function millisecondsUntilLocalTime(timeZone, hour, minute = 0, now = new Date(), targetWeekday = null) {
  let delay = localTimeDifferenceMs(now, timeZone, hour, minute, targetWeekday);
  const cycle = targetWeekday === null ? DAY_MS : WEEK_MS;
  if (delay <= 0) delay += cycle;
  return delay;
}

export function scheduleDailyLocal(task, {
  timeZone = "Europe/Kyiv",
  hour = 9,
  minute = 0,
  logger = console,
} = {}) {
  let timer;
  const run = async () => {
    try {
      await task();
    } catch (error) {
      logger.error("Scheduled daily task failed", error);
    } finally {
      timer = setTimeout(run, millisecondsUntilLocalTime(timeZone, hour, minute));
      timer.unref?.();
    }
  };
  timer = setTimeout(run, millisecondsUntilLocalTime(timeZone, hour, minute));
  timer.unref?.();
  return () => clearTimeout(timer);
}

export function scheduleWeeklyLocal(task, {
  timeZone = "Europe/Kyiv",
  weekday = 5,
  hour = 15,
  minute = 0,
  logger = console,
} = {}) {
  let timer;
  const run = async () => {
    try {
      await task();
    } catch (error) {
      logger.error("Scheduled weekly task failed", error);
    } finally {
      timer = setTimeout(run, millisecondsUntilLocalTime(timeZone, hour, minute, new Date(), weekday));
      timer.unref?.();
    }
  };
  timer = setTimeout(run, millisecondsUntilLocalTime(timeZone, hour, minute, new Date(), weekday));
  timer.unref?.();
  return () => clearTimeout(timer);
}

export { millisecondsUntilTimeUtc, millisecondsUntilTimeUtc as millisecondsUntilHourUtc };
