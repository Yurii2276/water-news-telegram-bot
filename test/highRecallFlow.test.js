import assert from "node:assert/strict";
import test from "node:test";

import { isBroadWaterSectorCandidate } from "../src/discoveryPolicy.js";
import {
  discoverHighRecallSources,
  selectedHighRecallQueries,
} from "../src/highRecallDiscovery.js";
import { parseNewsFeed } from "../src/news.js";
import { createAutoPublisher } from "../src/publisher.js";

function longDescription(label) {
  return [
    `${label} стосується централізованого водопостачання та роботи комунальної інфраструктури громади.`,
    `У повідомленні наведено конкретні дані про стан мережі, виконання робіт і подачу води споживачам.`,
    `Водоканал повідомив про організаційні та технічні заходи, необхідні для стабільної роботи системи.`,
    `Матеріал також описує наслідки для мешканців та подальші дії відповідальних комунальних служб.`,
    `Інформація оприлюднена як актуальне повідомлення про функціонування системи водопостачання громади.`,
  ].join(" ");
}

function queuedMaterial(id, materialCategory, title) {
  const description = longDescription(title);
  return {
    id,
    title,
    url: `https://example.com/water/${id}`,
    source_name: "Тестове джерело",
    content: description,
    public_description_uk: description,
    context_basis: "full_article",
    ai_decision: {
      relevant: true,
      relevanceScore: 90,
      confidence: "high",
      confidenceScore: 90,
      importance: 70,
      category: "water_supply",
      materialCategory,
      summary: "Актуальне повідомлення про водопостачання.",
      whyImportant: "Інформація стосується роботи системи водопостачання.",
      hashtags: ["#вода"],
    },
  };
}

test("broad discovery policy keeps planned water-sector topics", () => {
  const accepted = [
    "Скільки коштує вода у Києві сьогодні і як може зрости тариф",
    "Якість води під контролем: результати лабораторних перевірок у липні",
    "У районі перекрили воду через аварію на водогоні",
    "Вода у річці забруднена: зафіксовано перевищення хлоридів",
    "Водоканал модернізує очисні споруди та скорочує втрати води",
    "World Bank фінансує відновлення water infrastructure in Ukraine",
  ];

  for (const title of accepted) {
    assert.equal(isBroadWaterSectorCandidate({ title }), true, title);
  }

  assert.equal(
    isBroadWaterSectorCandidate({ title: "У місті відновили подачу гарячої води після ремонту тепломережі" }),
    false,
  );
  assert.equal(
    isBroadWaterSectorCandidate({ title: "Через сильну зливу підтопило кілька вулиць" }),
    false,
  );
});

test("high-recall Google discovery is capped at four queries per scan", () => {
  const queries = selectedHighRecallQueries(new Date("2026-08-26T12:00:00Z"));
  assert.equal(queries.length, 4);
  assert.match(queries[0], /водоканал|водопостачання/iu);
  assert.match(queries[1], /тариф|якість води|відключення води/iu);
});

test("Google 503 opens a circuit instead of hammering all queries", async () => {
  let googleCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("news.google.com")) {
      googleCalls += 1;
      return {
        ok: false,
        status: 503,
        url,
        text: async () => "",
      };
    }
    return {
      ok: false,
      status: 403,
      url,
      text: async () => "",
    };
  };

  const items = await discoverHighRecallSources({
    fetchImpl,
    sleep: async () => {},
    logger: { warn: () => {} },
    sourceHealthStore: {
      isSourceInCooldown: async () => false,
      recordSourceFetchFailure: async () => ({}),
      recordSourceFetchSuccess: async () => "ok",
    },
  });

  assert.equal(googleCalls, 1);
  assert.equal(items.diagnostics.google_queries_executed, 1);
  assert.equal(items.diagnostics.google_circuit_opened, 1);
});

test("RSS parser preserves useful summary text for fallback processing", () => {
  const xml = `<?xml version="1.0"?><rss><channel><item>
    <title>Водоканал модернізує мережу</title>
    <link>https://news.google.com/rss/articles/example</link>
    <description><![CDATA[Водоканал повідомив про реконструкцію мережі питного водопостачання, заміну аварійних ділянок та заходи зі скорочення втрат води у громаді.]]></description>
    <source url="https://example.com">Приклад</source>
  </item></channel></rss>`;

  const [item] = parseNewsFeed(xml, 5);
  assert.ok(item);
  assert.match(item.summary ?? "", /реконструкцію мережі питного водопостачання/iu);
  assert.equal(item.source, "Приклад");
  assert.equal(item.sourceUrl, "https://example.com/");
});

test("local incident cap does not block regulator, government, utility and tariff news", async () => {
  const queue = [
    queuedMaterial(1, "local_media", "Аварія на водогоні у районі"),
    queuedMaterial(2, "local_media", "Друге локальне відключення води"),
    queuedMaterial(3, "regulator", "НКРЕКП ухвалила рішення щодо водопостачання"),
    queuedMaterial(4, "government", "Уряд схвалив проєкт відновлення водної інфраструктури"),
    queuedMaterial(5, "vodokanal", "Водоканал завершив модернізацію мережі"),
    queuedMaterial(6, "tariffs", "Змінено тариф на централізоване водопостачання"),
  ];
  const published = [];

  const publisher = createAutoPublisher({
    repository: {
      countPublishedToday: async () => 0,
      getQueue: async () => [...queue],
      setPublicDescription: async () => {},
      setStatus: async (id, status) => {
        if (status === "published") published.push(id);
        const index = queue.findIndex((item) => item.id === id);
        if (index >= 0) queue.splice(index, 1);
      },
      recordPublishFailure: async () => {},
    },
    telegram: { sendMessage: async () => {} },
    channelId: "-1001",
    maxDaily: 18,
    editorialCap: 18,
    maxLocalIncidents: 1,
    maxDailyInternational: 5,
    intervalMs: 0,
    dryRun: false,
    verifySource: async (material) => ({ verified: true, url: material.url }),
    prepareDisplayTitle: async (material) => material,
    prepareContext: async (material) => material,
    sleep: async () => {},
  });

  const result = await publisher.drain();

  assert.equal(result.publishedNow, 5);
  assert.deepEqual(published.sort((a, b) => a - b), [1, 3, 4, 5, 6]);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, 2);
});
