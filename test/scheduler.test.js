import assert from "node:assert/strict";
import test from "node:test";

import { millisecondsUntilLocalTime, timeZoneParts } from "../src/scheduler.js";

test("Europe/Kyiv local scheduler respects summer UTC offset", () => {
  const now = new Date("2026-07-17T11:30:00Z"); // 14:30 Kyiv
  const delay = millisecondsUntilLocalTime("Europe/Kyiv", 15, 0, now);
  assert.equal(delay, 30 * 60 * 1000);
});

test("Europe/Kyiv local scheduler respects winter UTC offset", () => {
  const now = new Date("2026-12-18T12:30:00Z"); // 14:30 Kyiv
  const delay = millisecondsUntilLocalTime("Europe/Kyiv", 15, 0, now);
  assert.equal(delay, 30 * 60 * 1000);
});

test("weekly scheduler targets Friday 15:00 Kyiv", () => {
  const now = new Date("2026-07-16T12:00:00Z"); // Thursday
  const delay = millisecondsUntilLocalTime("Europe/Kyiv", 15, 0, now, 5);
  assert.equal(delay, 24 * 60 * 60 * 1000);
});

test("timeZoneParts exposes local date and weekday", () => {
  const parts = timeZoneParts(new Date("2026-07-17T12:00:00Z"), "Europe/Kyiv");
  assert.equal(parts.weekday, 5);
  assert.equal(parts.hour, 15);
  assert.equal(parts.dateKey, "2026-07-17");
});
