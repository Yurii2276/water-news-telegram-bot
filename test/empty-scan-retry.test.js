import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmptyScanRetryController,
  shouldScheduleEmptyScanRetry,
} from "../src/emptyScanRetry.js";

function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimer(fn, delay) {
      timers.push({ fn, delay, cleared: false });
      return timers.at(-1);
    },
    clearTimer(timer) {
      timer.cleared = true;
    },
    async runNext() {
      const timer = timers.find((item) => !item.cleared);
      assert.ok(timer, "expected scheduled timer");
      timer.cleared = true;
      await timer.fn();
    },
  };
}

test("empty scheduled scan schedules retry and notifies admin", async () => {
  const sent = [];
  const timers = fakeTimers();
  const controller = createEmptyScanRetryController({
    scan: async () => ({ discovered: 0, queued: 0, duplicates: 0, rejected: 0 }),
    telegram: { sendMessage: async (...args) => sent.push(args) },
    adminTelegramId: 42,
    retryMinutes: 60,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  await controller.runScheduledScan();

  assert.equal(controller.state().retryScheduled, true);
  assert.equal(timers.timers[0].delay, 60 * 60 * 1000);
  assert.equal(sent[0][0], 42);
  assert.match(sent[0][1], /Автоматичний повтор через 60 хвилин/);
});

test("duplicate-only scan does not schedule retry", async () => {
  const timers = fakeTimers();
  const controller = createEmptyScanRetryController({
    scan: async () => ({ discovered: 10, queued: 0, duplicates: 10, rejected: 0 }),
    telegram: { sendMessage: async () => {} },
    adminTelegramId: 42,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  await controller.runScheduledScan();

  assert.equal(shouldScheduleEmptyScanRetry({ discovered: 10, queued: 0, duplicates: 10, rejected: 0 }), false);
  assert.equal(controller.state().retryScheduled, false);
});

test("successful retry clears retry state and notifies admin", async () => {
  const sent = [];
  const timers = fakeTimers();
  const reports = [
    { discovered: 0, queued: 0, duplicates: 0, rejected: 0 },
    { discovered: 5, queued: 2, duplicates: 0, rejected: 3 },
  ];
  const controller = createEmptyScanRetryController({
    scan: async () => reports.shift(),
    telegram: { sendMessage: async (...args) => sent.push(args) },
    adminTelegramId: 42,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  await controller.runScheduledScan();
  await timers.runNext();

  assert.deepEqual(controller.state(), { retryAttempt: 0, retryScheduled: false });
  assert.match(sent.at(-1)[1], /Повторний збір завершено/);
  assert.match(sent.at(-1)[1], /Знайдено: 5, поставлено в чергу: 2/);
});

test("maximum retry count is respected", async () => {
  const sent = [];
  const timers = fakeTimers();
  const controller = createEmptyScanRetryController({
    scan: async () => ({ discovered: 0, queued: 0, duplicates: 0, rejected: 0 }),
    telegram: { sendMessage: async (...args) => sent.push(args) },
    adminTelegramId: 42,
    maxRetries: 2,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  await controller.runScheduledScan();
  await timers.runNext();
  await timers.runNext();

  assert.deepEqual(controller.state(), { retryAttempt: 0, retryScheduled: false });
  assert.match(sent.at(-1)[1], /Після повторних спроб/);
});

test("technical retry notifications are admin-only", async () => {
  const sent = [];
  const timers = fakeTimers();
  const controller = createEmptyScanRetryController({
    scan: async () => ({ discovered: 0, queued: 0, duplicates: 0, rejected: 0 }),
    telegram: { sendMessage: async (...args) => sent.push(args) },
    adminTelegramId: 42,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  await controller.runScheduledScan();

  assert.deepEqual(sent.map(([chatId]) => chatId), [42]);
});
