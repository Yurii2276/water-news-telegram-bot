import assert from "node:assert/strict";
import test from "node:test";

import {
  createAutoPublisher,
  verifyPrimarySource,
} from "../src/publisher.js";
import { prepareMaterialDisplayTitle } from "../src/translation.js";

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

test("Telegram publication uses Ukrainian display title and keeps source and URL", async () => {
  const sent = [];
  const statuses = [];
  const queue = [{
    ...queuedMaterial(),
    title: "Global smart water leak detection technology cuts non-revenue water",
    source_name: "WaterWorld",
    url: "https://example.com/smart-water",
  }];
  const publisher = createAutoPublisher({
    repository: {
      countPublishedToday: async () => 0,
      getQueue: async () => queue.splice(0, 1),
      setStatus: async (...args) => statuses.push(args),
      recordPublishFailure: async () => {},
    },
    telegram: { sendMessage: async (...args) => sent.push(args) },
    channelId: "-1001",
    intervalMs: 0,
    dryRun: false,
    verifySource: async () => ({ verified: true }),
    prepareDisplayTitle: async (material) => ({
      ...material,
      displayTitleUk: "Технологія smart water для виявлення витоків скорочує втрати води",
    }),
    sleep: async () => {},
  });

  await publisher.drain();

  assert.match(sent[0][1], /Технологія smart water для виявлення витоків скорочує втрати води/);
  assert.doesNotMatch(sent[0][1], /Global smart water leak detection/);
  assert.match(sent[0][1], /Джерело: WaterWorld/);
  assert.match(sent[0][1], /🔗 <a href="https:\/\/example\.com\/smart-water">Читати джерело<\/a>/);
  assert.equal(statuses[0][1], "published");
});

test("OpenAI translation failure does not crash publishing", async () => {
  const sent = [];
  const queue = [{
    ...queuedMaterial(),
    title: "Smart water infrastructure funding announced",
    url: "https://example.com/funding",
  }];
  const publisher = createAutoPublisher({
    repository: {
      countPublishedToday: async () => 0,
      getQueue: async () => queue.splice(0, 1),
      setStatus: async () => {},
      recordPublishFailure: async () => {},
    },
    telegram: { sendMessage: async (...args) => sent.push(args) },
    channelId: "-1001",
    intervalMs: 0,
    dryRun: false,
    verifySource: async () => ({ verified: true }),
    prepareDisplayTitle: (material) =>
      prepareMaterialDisplayTitle(material, {
        apiKey: "test-key",
        fetchImpl: async () => ({
          ok: false,
          status: 429,
          json: async () => ({ error: { message: "quota exceeded" } }),
        }),
        logger: { warn: () => {} },
      }),
    sleep: async () => {},
    logger: { error: () => {} },
  });

  const result = await publisher.drain();

  assert.equal(result.publishedNow, 1);
  assert.match(sent[0][1], /Smart water infrastructure funding announced/);
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

test("valid unregistered HTTPS URL is publishable with warning", async () => {
  const warnings = [];
  const url = "https://regional-news.example/water/outage";
  const result = await verifyPrimarySource(
    { url },
    {
      fetchImpl: async () => ({ ok: true, status: 200, url }),
      logger: { warn: (...args) => warnings.push(args) },
    },
  );

  assert.equal(result.verified, true);
  assert.equal(result.unregisteredSource, true);
  assert.equal(result.url, url);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], "Publishing unregistered but valid source URL");
});

test("invalid source URLs are rejected without fetching", async () => {
  let fetches = 0;
  for (const url of [undefined, "", "not a url", "javascript:alert(1)", "mailto:news@example.com"]) {
    const result = await verifyPrimarySource(
      { url },
      { fetchImpl: async () => { fetches += 1; } },
    );
    assert.equal(result.verified, false);
    assert.equal(result.reason, "Invalid source URL");
  }
  assert.equal(fetches, 0);
});

test("broken unregistered URL is rejected", async () => {
  const result = await verifyPrimarySource(
    { url: "https://regional-news.example/missing" },
    {
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        url: "https://regional-news.example/missing",
      }),
    },
  );
  assert.equal(result.verified, false);
  assert.match(result.reason, /HTTP 404/);
});

test("registered source verification still accepts the same source", async () => {
  const result = await verifyPrimarySource(
    { url: "https://www.davr.gov.ua/news/test" },
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        url: "https://www.davr.gov.ua/news/test",
      }),
    },
  );
  assert.equal(result.verified, true);
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
