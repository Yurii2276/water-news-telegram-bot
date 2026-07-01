import assert from "node:assert/strict";
import test from "node:test";

import {
  createAutoPublisher,
  verifyPrimarySource,
} from "../src/publisher.js";

function queuedMaterial(id = 1) {
  return {
    id,
    title: "Перевірена новина",
    url: "https://www.davr.gov.ua/news/test",
    source_name: "Держводагентство",
    ai_decision: {
      relevant: true,
      relevanceScore: 95,
      confidence: "high",
      confidenceScore: 92,
      category: "water_supply",
      importance: 80,
      summary: "Перевірене резюме.",
      whyImportant: "Перевірене пояснення.",
      hashtags: ["#вода"],
    },
  };
}

test("auto-publisher sends verified queued material without buttons", async () => {
  const sent = [];
  const statuses = [];
  const queue = [queuedMaterial()];
  const publisher = createAutoPublisher({
    repository: {
      countPublishedToday: async () => 0,
      getQueue: async () => queue.splice(0, 1),
      setStatus: async (...args) => statuses.push(args),
      recordPublishFailure: async () => {},
    },
    telegram: {
      sendMessage: async (...args) => sent.push(args),
    },
    channelId: "-1001",
    intervalMs: 0,
    dryRun: false,
    verifySource: async () => ({ verified: true }),
    sleep: async () => {},
  });

  const result = await publisher.drain();

  assert.equal(result.publishedNow, 1);
  assert.equal(sent[0].length, 2);
  assert.deepEqual(statuses[0].slice(0, 2), [1, "published"]);
});

test("publisher retries and journals terminal failure", async () => {
  const failures = [];
  const queue = [queuedMaterial()];
  const publisher = createAutoPublisher({
    repository: {
      countPublishedToday: async () => 0,
      getQueue: async () => queue.splice(0, 1),
      setStatus: async () => {},
      recordPublishFailure: async (...args) => failures.push(args),
    },
    telegram: { sendMessage: async () => {} },
    channelId: "-1001",
    maxRetries: 3,
    dryRun: false,
    verifySource: async () => ({ verified: false, reason: "bad source" }),
    sleep: async () => {},
    logger: { error: () => {} },
  });

  await publisher.drain();

  assert.equal(failures.length, 3);
  assert.equal(failures.at(-1)[3], true);
});

test("daily limit prevents an eleventh publication", async () => {
  let queueReads = 0;
  const publisher = createAutoPublisher({
    repository: {
      countPublishedToday: async () => 10,
      getQueue: async () => {
        queueReads += 1;
        return [queuedMaterial()];
      },
    },
    telegram: { sendMessage: async () => {} },
    channelId: "-1001",
    maxDaily: 10,
  });

  const result = await publisher.drain();
  assert.equal(result.publishedNow, 0);
  assert.equal(queueReads, 0);
});

test("source verification rejects redirects outside trusted registry", async () => {
  const result = await verifyPrimarySource(
    { url: "https://www.davr.gov.ua/news/test" },
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        url: "https://untrusted.example/article",
      }),
    },
  );
  assert.equal(result.verified, false);
});

test("DRY_RUN verifies and journals material without Telegram send", async () => {
  const statuses = [];
  let sends = 0;
  const queue = [queuedMaterial()];
  const publisher = createAutoPublisher({
    repository: {
      countPublishedToday: async () => 0,
      getQueue: async () => queue.splice(0, 1),
      setStatus: async (...args) => statuses.push(args),
      recordPublishFailure: async () => {},
    },
    telegram: { sendMessage: async () => sends++ },
    channelId: "-1001",
    dryRun: true,
    verifySource: async () => ({ verified: true }),
    sleep: async () => {},
  });

  const result = await publisher.drain();

  assert.equal(sends, 0);
  assert.equal(result.simulatedNow, 1);
  assert.equal(result.publishedNow, 0);
  assert.deepEqual(statuses[0].slice(0, 2), [1, "dry_run"]);
});
