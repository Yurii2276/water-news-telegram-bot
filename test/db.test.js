import assert from "node:assert/strict";
import test from "node:test";

import { isRetryableFailedPublication } from "../src/db.js";

const NOW = new Date("2026-07-03T09:00:00.000Z");

function material(overrides = {}) {
  return {
    id: 1,
    status: "rejected_publish",
    url: "https://example.com/water-news",
    ai_decision: { relevant: true },
    published_at: null,
    updated_at: new Date(NOW.getTime() - 60 * 60 * 1000),
    ...overrides,
  };
}

test("publication failures from the last 48 hours are retryable", () => {
  assert.equal(isRetryableFailedPublication(material(), { now: NOW }), true);
  assert.equal(
    isRetryableFailedPublication(material({ status: "publish_failed" }), { now: NOW }),
    true,
  );
});

test("AI and topic/content rejections are never retryable", () => {
  for (const status of ["rejected_ai_error", "rejected_ai", "filtered_out", "rejected_source", "duplicate"]) {
    assert.equal(
      isRetryableFailedPublication(material({ status }), { now: NOW }),
      false,
      status,
    );
  }
  assert.equal(
    isRetryableFailedPublication(material({ ai_decision: { relevant: false } }), { now: NOW }),
    false,
  );
  assert.equal(
    isRetryableFailedPublication(material({ ai_decision: null }), { now: NOW }),
    false,
  );
});

test("missing, invalid and non-HTTP URLs are never retryable", () => {
  for (const url of [undefined, "", "not a url", "javascript:alert(1)", "mailto:news@example.com"]) {
    assert.equal(
      isRetryableFailedPublication(material({ url }), { now: NOW }),
      false,
    );
  }
});

test("published and queued materials are not requeued", () => {
  assert.equal(
    isRetryableFailedPublication(material({ published_at: NOW }), { now: NOW }),
    false,
  );
  assert.equal(
    isRetryableFailedPublication(material({ status: "published" }), { now: NOW }),
    false,
  );
  assert.equal(
    isRetryableFailedPublication(material({ status: "queued" }), { now: NOW }),
    false,
  );
});

test("publication failures older than 48 hours are not retryable", () => {
  const old = new Date(NOW.getTime() - 49 * 60 * 60 * 1000);
  assert.equal(
    isRetryableFailedPublication(material({ updated_at: old }), { now: NOW }),
    false,
  );
});
