import assert from "node:assert/strict";
import test from "node:test";

import { createUpdateHandler, formatDailyDigest, formatScanReport } from "../src/bot.js";

test("/scan starts collection and auto-publisher", async () => {
  const sent = [];
  let kicks = 0;
  const handleUpdate = createUpdateHandler({
    telegram: { sendMessage: async (...args) => sent.push(args) },
    repository: {},
    pipeline: {
      scan: async () => ({
        discovered: 4,
        queued: 1,
        duplicates: 1,
        rejected: 2,
      }),
    },
    publisher: { kick: () => kicks++ },
    adminTelegramId: 42,
  });

  await handleUpdate({
    message: { chat: { id: 42 }, from: { id: 42 }, text: "/scan" },
  });

  assert.equal(kicks, 1);
  assert.match(sent.at(-1)[1], /у черзі 1/);
});

test("admin can requeue failed publications without immediately draining queue", async () => {
  const sent = [];
  const requestedWindows = [];
  let kicks = 0;
  const handleUpdate = createUpdateHandler({
    telegram: { sendMessage: async (...args) => sent.push(args) },
    repository: {
      retryFailedPublications: async (hours) => {
        requestedWindows.push(hours);
        return 3;
      },
    },
    pipeline: {},
    publisher: { kick: () => kicks++ },
    adminTelegramId: 42,
  });

  await handleUpdate({
    message: {
      chat: { id: 42 },
      from: { id: 42 },
      text: "/retry_failed_publish",
    },
  });

  assert.deepEqual(requestedWindows, [48]);
  assert.equal(kicks, 0);
  assert.equal(sent[0][1], "Повторно поставлено в чергу: 3");
});

test("non-admin cannot run /retry_failed_publish", async () => {
  const sent = [];
  let retries = 0;
  const handleUpdate = createUpdateHandler({
    telegram: { sendMessage: async (...args) => sent.push(args) },
    repository: {
      retryFailedPublications: async () => {
        retries += 1;
        return 1;
      },
    },
    pipeline: {},
    publisher: {},
    adminTelegramId: 42,
  });

  await handleUpdate({
    message: {
      chat: { id: 10 },
      from: { id: 10 },
      text: "/retry_failed_publish",
    },
  });

  assert.equal(retries, 0);
  assert.match(sent[0][1], /лише адміну/);
});

test("scan report includes rejection diagnostics and first titles", () => {
  const text = formatScanReport({
    discovered: 41,
    queued: 0,
    duplicates: 0,
    rejected: 41,
    rejectedBy: {
      irrelevant: 12,
      openaiError: 9,
      missingContentOrLink: 20,
      other: 0,
    },
    rejectedItems: [
      { title: "Матеріал <1>", reason: "OpenAI error: timeout" },
    ],
  });

  assert.match(text, /Нерелевантність: 12/);
  assert.match(text, /Помилки OpenAI: 9/);
  assert.match(text, /Немає тексту\/посилання: 20/);
  assert.match(text, /Матеріал &lt;1&gt;/);
});

test("scan report includes category and priority counters", () => {
  const text = formatScanReport({
    discovered: 5,
    queued: 3,
    duplicates: 0,
    rejected: 2,
    accepted_title_keyword_fallback: 1,
    categories: {
      regulator: 1,
      government: 0,
      parliament: 1,
      association: 0,
      vodokanal: 0,
      local_media: 1,
      donor: 0,
      international_tech: 0,
      general_news: 0,
    },
    priorities: { high: 2, medium: 0, low: 1 },
    rejectedBy: {},
  });

  assert.match(text, /regulator: 1/);
  assert.match(text, /parliament: 1/);
  assert.match(text, /local_media: 1/);
  assert.match(text, /High priority: 2/);
  assert.match(text, /Low priority: 1/);
});

test("/publish_queue_now is admin-only and calls publisher drain", async () => {
  const sent = [];
  let drains = 0;
  const handleUpdate = createUpdateHandler({
    telegram: { sendMessage: async (...args) => sent.push(args) },
    repository: {},
    pipeline: {},
    publisher: {
      drain: async () => {
        drains += 1;
        return { publishedNow: 2, dryRun: false, limit: 10 };
      },
    },
    adminTelegramId: 42,
  });

  await handleUpdate({
    message: { chat: { id: 42 }, from: { id: 42 }, text: "/publish_queue_now" },
  });

  assert.equal(drains, 1);
  assert.equal(sent[0][1], "Публікація запущена. Опубліковано: 2. DRY_RUN: false. Ліміт: 10.");

  await handleUpdate({
    message: { chat: { id: 7 }, from: { id: 7 }, text: "/publish_queue_now" },
  });

  assert.equal(drains, 1);
  assert.match(sent.at(-1)[1], /лише адміну/);
});

test("/daily_digest is admin-only and returns concise editorial summary", async () => {
  const sent = [];
  let reads = 0;
  const handleUpdate = createUpdateHandler({
    telegram: { sendMessage: async (...args) => sent.push(args) },
    repository: {
      getDailyDigestMaterials: async () => {
        reads += 1;
        return [
          {
            id: 1,
            title: "НКРЕКП затвердила тариф на воду",
            source_name: "НКРЕКП",
            ai_decision: { materialCategory: "regulator", category: "tariffs", priorityLevel: "high" },
          },
          {
            id: 2,
            title: "UNICEF WASH проєкт для водної інфраструктури",
            source_name: "UNICEF",
            ai_decision: { materialCategory: "donor", category: "donors", priorityLevel: "high" },
          },
        ];
      },
    },
    pipeline: {},
    publisher: {},
    adminTelegramId: 42,
  });

  await handleUpdate({
    message: { chat: { id: 42 }, from: { id: 42 }, text: "/daily_digest" },
  });

  assert.equal(reads, 1);
  assert.match(sent[0][1], /Вода UA: головне за день/);
  assert.match(sent[0][1], /Регулювання/);
  assert.match(sent[0][1], /Міжнародна співпраця/);
  assert.doesNotMatch(sent[0][1], /high|medium|low/);

  await handleUpdate({
    message: { chat: { id: 7 }, from: { id: 7 }, text: "/daily_digest" },
  });
  assert.equal(reads, 1);
});

test("/daily_digest uses Ukrainian display titles", async () => {
  const sent = [];
  const handleUpdate = createUpdateHandler({
    telegram: { sendMessage: async (...args) => sent.push(args) },
    repository: {
      getDailyDigestMaterials: async () => [
        {
          id: 1,
          title: "Global smart water leak detection technology cuts non-revenue water",
          source_name: "WaterWorld",
          ai_decision: { materialCategory: "international_tech", category: "technology", priorityLevel: "medium" },
        },
      ],
    },
    pipeline: {},
    publisher: {},
    adminTelegramId: 42,
    prepareDisplayTitle: async (material) => ({
      ...material,
      displayTitleUk: "Технологія smart water для виявлення витоків скорочує втрати води",
    }),
  });

  await handleUpdate({
    message: { chat: { id: 42 }, from: { id: 42 }, text: "/daily_digest" },
  });

  assert.match(sent[0][1], /Технологія smart water для виявлення витоків скорочує втрати води/);
  assert.doesNotMatch(sent[0][1], /Global smart water leak detection/);
  assert.match(sent[0][1], /WaterWorld/);
});

test("daily digest formatter emits concise empty fallback", () => {
  const text = formatDailyDigest([]);
  assert.match(text, /немає достатньо підтверджених матеріалів/);
  assert.doesNotMatch(text, /Немає важливих повідомлень/);
});

test("daily digest does not expose long raw Google News URLs", () => {
  const longUrl = "https://news.google.com/rss/articles/CBMiVeryLongGoogleRedirect";
  const text = formatDailyDigest([
    {
      id: 1,
      title: "Smart water technology",
      url: longUrl,
      source_name: "Google News",
      ai_decision: { materialCategory: "international_tech", priorityLevel: "medium" },
    },
  ]);

  assert.doesNotMatch(text, /news\.google\.com\/rss\/articles/);
  assert.match(text, /Технології/);
});
