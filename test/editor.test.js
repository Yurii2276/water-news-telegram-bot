import assert from "node:assert/strict";
import test from "node:test";

import { discoverAllSources } from "../src/collector.js";
import { createEditorPipeline, saveRejected } from "../src/editor.js";
import { formatPublication } from "../src/telegram.js";

function candidate(title, suffix) {
  return {
    title,
    url: `https://www.davr.gov.ua/news/${suffix}`,
    sourceId: "davr",
    sourceName: "Держводагентство",
    discoveryMethod: "official",
  };
}

test("missing and invalid candidate URLs do not crash scan", async () => {
  const withoutUrl = { title: "Матеріал без URL", sourceId: "davr" };
  const invalidUrl = { title: "Матеріал з invalid URL", url: "not a url", sourceId: "davr" };
  let extracts = 0;
  let writes = 0;
  const pipeline = createEditorPipeline({
    discover: async () => [withoutUrl, invalidUrl],
    extract: async () => { extracts += 1; },
    classify: async () => { throw new Error("must not run"); },
    repository: {
      listForDedup: async () => [],
      saveMaterial: async () => { writes += 1; },
    },
  });

  const report = await pipeline.scan();
  assert.equal(report.rejectedBy.rejected_missing_url, 1);
  assert.equal(report.rejectedBy.rejected_invalid_url, 1);
  assert.equal(report.rejectedItems.length, 2);
  assert.equal(extracts, 0);
  assert.equal(writes, 0);
});

test("saveRejected skips database write without valid URL", async () => {
  let writes = 0;
  const repository = { saveMaterial: async () => { writes += 1; } };
  assert.equal(await saveRejected(repository, { title: "Без URL" }, "filtered_out", "missing"), null);
  assert.equal(await saveRejected(repository, { title: "Bad", url: "javascript:alert(1)" }, "filtered_out", "invalid"), null);
  assert.equal(writes, 0);
});

test("strong water-sector titles queue without extraction or OpenAI", async () => {
  const items = [
    candidate("Куб понад 100 гривень: хочуть підвищити тариф на воду", "tariff"),
    candidate("Частина Одеси залишилася без води", "outage"),
    candidate("Миколаївводоканал через зношені мережі втрачає 40% води", "losses"),
    candidate("Обміління Дністра загрожує водопостачанню громади", "dniester"),
  ];
  items[0].summary = "Регулятор розглядає зміну тарифу.";
  const saved = [];
  let extracts = 0;
  let classifications = 0;
  const pipeline = createEditorPipeline({
    discover: async () => items,
    extract: async () => { extracts += 1; throw new Error("must not run"); },
    classify: async () => { classifications += 1; throw new Error("must not run"); },
    repository: {
      listForDedup: async () => [],
      saveMaterial: async (material) => { saved.push(material); return material; },
    },
  });

  const report = await pipeline.scan();
  assert.equal(report.queued, 4);
  assert.equal(report.accepted_title_keyword_fallback, 4);
  assert.equal(report.rejected, 0);
  assert.equal(extracts, 0);
  assert.equal(classifications, 0);
  assert.ok(saved.every((material) => material.status === "queued"));
  assert.ok(saved.every((material) => material.aiDecision.titleKeywordFallback));
});

test("pure hot-water-only title remains rejected", async () => {
  const item = candidate("У місті тимчасово не буде гарячої води через ремонт тепломережі", "hot-water");
  const saved = [];
  const pipeline = createEditorPipeline({
    discover: async () => [item],
    extract: async () => { throw new Error("must not run"); },
    classify: async () => { throw new Error("must not run"); },
    repository: {
      listForDedup: async () => [],
      saveMaterial: async (material) => { saved.push(material); return material; },
    },
  });

  const report = await pipeline.scan();
  assert.equal(report.queued, 0);
  assert.equal(report.accepted_title_keyword_fallback, 0);
  assert.equal(report.rejectedBy.irrelevant, 1);
  assert.equal(saved[0].status, "filtered_out");
});

test("fallback Telegram post uses title, source, URL and optional snippet", () => {
  const text = formatPublication({
    title: "Тарифи на воду змінилися",
    url: "https://example.com/water",
    sourceName: "Приклад джерела",
    content: "Короткий доступний опис матеріалу.",
    aiDecision: { titleKeywordFallback: true },
  });
  assert.match(text, /Тарифи на воду змінилися/);
  assert.match(text, /Приклад джерела/);
  assert.match(text, /https:\/\/example\.com\/water/);
  assert.match(text, /Короткий доступний опис матеріалу/);
  assert.doesNotMatch(text, /Чому це важливо/);
});

test("pipeline still journals OpenAI errors for valid articles", async () => {
  const item = candidate("Питна вода для громади", "ai-error");
  const saved = [];
  const pipeline = createEditorPipeline({
    discover: async () => [item],
    extract: async () => ({ ...item, content: "Питне водопостачання. ".repeat(30), sourceTrusted: true, extractionStatus: "ok" }),
    classify: async () => { throw new Error("quota exceeded"); },
    repository: {
      listForDedup: async () => [],
      saveMaterial: async (material) => { saved.push(material); return material; },
    },
    logger: { error: () => {} },
  });
  const report = await pipeline.scan();
  assert.equal(report.rejectedBy.openaiError, 1);
  assert.ok(saved.some((material) => material.status === "rejected_ai_error"));
});

test("mindev HTTP 403 is logged and discovery continues", async () => {
  const errors = [];
  const emptyRss = "<?xml version=\"1.0\"?><rss><channel></channel></rss>";
  const fetchImpl = async (url) => {
    if (url.includes("mindev.gov.ua")) {
      return { ok: false, status: 403, url, text: async () => "Forbidden" };
    }
    const xml = url.includes("rss") || url.includes("sitemap");
    return { ok: true, status: 200, url, text: async () => (xml ? emptyRss : "<html></html>") };
  };
  const result = await discoverAllSources({
    googleNewsRssUrl: "https://news.google.com/rss/test",
    fetchImpl,
    logger: { error: (...args) => errors.push(args) },
  });
  assert.deepEqual(result, []);
  assert.ok(errors.some(([message]) => message.includes("mindev")));
});
