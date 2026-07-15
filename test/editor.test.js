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
    sourceName: "Р”РµСЂР¶РІРѕРґР°РіРµРЅС‚СЃС‚РІРѕ",
    discoveryMethod: "official",
  };
}

test("missing and invalid candidate URLs do not crash scan", async () => {
  const withoutUrl = { title: "РњР°С‚РµСЂС–Р°Р» Р±РµР· URL", sourceId: "davr" };
  const invalidUrl = { title: "РњР°С‚РµСЂС–Р°Р» Р· invalid URL", url: "not a url", sourceId: "davr" };
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
  assert.equal(await saveRejected(repository, { title: "Р‘РµР· URL" }, "filtered_out", "missing"), null);
  assert.equal(await saveRejected(repository, { title: "Bad", url: "javascript:alert(1)" }, "filtered_out", "invalid"), null);
  assert.equal(writes, 0);
});

test("strong water-sector titles queue without extraction or OpenAI", async () => {
  const items = [
    candidate("РљСѓР± РїРѕРЅР°Рґ 100 РіСЂРёРІРµРЅСЊ: С…РѕС‡СѓС‚СЊ РїС–РґРІРёС‰РёС‚Рё С‚Р°СЂРёС„ РЅР° РІРѕРґСѓ", "tariff"),
    candidate("Р§Р°СЃС‚РёРЅР° РћРґРµСЃРё Р·Р°Р»РёС€РёР»Р°СЃСЏ Р±РµР· РІРѕРґРё", "outage"),
    candidate("РњРёРєРѕР»Р°С—РІРІРѕРґРѕРєР°РЅР°Р» С‡РµСЂРµР· Р·РЅРѕС€РµРЅС– РјРµСЂРµР¶С– РІС‚СЂР°С‡Р°С” 40% РІРѕРґРё", "losses"),
    candidate("РћР±РјС–Р»С–РЅРЅСЏ Р”РЅС–СЃС‚СЂР° Р·Р°РіСЂРѕР¶СѓС” РІРѕРґРѕРїРѕСЃС‚Р°С‡Р°РЅРЅСЋ РіСЂРѕРјР°РґРё", "dniester"),
  ];
  items[0].summary = "Р РµРіСѓР»СЏС‚РѕСЂ СЂРѕР·РіР»СЏРґР°С” Р·РјС–РЅСѓ С‚Р°СЂРёС„Сѓ.";
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
  const item = candidate("РЈ РјС–СЃС‚С– С‚РёРјС‡Р°СЃРѕРІРѕ РЅРµ Р±СѓРґРµ РіР°СЂСЏС‡РѕС— РІРѕРґРё С‡РµСЂРµР· СЂРµРјРѕРЅС‚ С‚РµРїР»РѕРјРµСЂРµР¶С–", "hot-water");
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
    title: "РўР°СЂРёС„Рё РЅР° РІРѕРґСѓ Р·РјС–РЅРёР»РёСЃСЏ",
    url: "https://example.com/water",
    sourceName: "РџСЂРёРєР»Р°Рґ РґР¶РµСЂРµР»Р°",
    content: "РљРѕСЂРѕС‚РєРёР№ РґРѕСЃС‚СѓРїРЅРёР№ РѕРїРёСЃ РјР°С‚РµСЂС–Р°Р»Сѓ.",
    aiDecision: { titleKeywordFallback: true },
  });
  assert.match(text, /РўР°СЂРёС„Рё РЅР° РІРѕРґСѓ Р·РјС–РЅРёР»РёСЃСЏ/);
  assert.match(text, /РџСЂРёРєР»Р°Рґ РґР¶РµСЂРµР»Р°/);
  assert.match(text, /https:\/\/example\.com\/water/);
  assert.match(text, /рџ’§ <b>РќРѕРІРёРЅРё СЃРµРєС‚РѕСЂСѓ<\/b>/);
  assert.match(text, /рџ”— https:\/\/example\.com\/water/);
  assert.doesNotMatch(text, /Р§РѕРјСѓ С†Рµ РІР°Р¶Р»РёРІРѕ/);
});

test("professional sector titles are categorized and prioritized for daily monitoring", async () => {
  const items = [
    {
      ...candidate("РќРљР Р•РљРџ СЃС…РІР°Р»РёР»Р° С‚Р°СЂРёС„Рё РЅР° С†РµРЅС‚СЂР°Р»С–Р·РѕРІР°РЅРµ РІРѕРґРѕРїРѕСЃС‚Р°С‡Р°РЅРЅСЏ РґР»СЏ Р»С–С†РµРЅР·С–Р°С‚С–РІ", "nerc-tariff"),
      sourceId: "nerc",
      sourceCategory: "regulator",
    },
    {
      ...candidate("РњС–РЅС–СЃС‚РµСЂСЃС‚РІРѕ РѕРіРѕР»РѕСЃРёР»Рѕ РІС–РґРЅРѕРІР»РµРЅРЅСЏ РІРѕРґРЅРѕС— С–РЅС„СЂР°СЃС‚СЂСѓРєС‚СѓСЂРё РіСЂРѕРјР°Рґ", "ministry-recovery"),
      sourceId: "mindev",
      sourceCategory: "government",
    },
    {
      ...candidate("Р’РµСЂС…РѕРІРЅР° Р Р°РґР° СЂРѕР·РіР»СЏРЅРµ Р·Р°РєРѕРЅРѕРїСЂРѕС”РєС‚ С‰РѕРґРѕ РїРёС‚РЅРѕС— РІРѕРґРё", "rada-bill"),
      sourceId: "rada",
      sourceCategory: "parliament",
    },
    {
      ...candidate("РђСЃРѕС†С–Р°С†С–СЏ РІРѕРґРѕРєР°РЅР°Р»С–РІ РѕР±РіРѕРІРѕСЂРёР»Р° С–РЅРІРµСЃС‚РёС†С–Р№РЅР° РїСЂРѕРіСЂР°РјР° РІРѕРґРѕРєР°РЅР°Р»Сѓ", "association"),
      sourceId: "auc",
      sourceCategory: "association",
    },
    {
      ...candidate("UNICEF Р·Р°РїСѓСЃРєР°С” WASH РґРѕРЅРѕСЂСЃСЊРєРёР№ РїСЂРѕС”РєС‚ РґР»СЏ РІРѕРґРЅРѕС— С–РЅС„СЂР°СЃС‚СЂСѓРєС‚СѓСЂРё", "wash"),
      sourceId: "unicef_ukraine",
      sourceCategory: "donor",
    },
    {
      ...candidate("Global smart water leak detection technology cuts non-revenue water", "smart-water"),
      sourceId: "google_news",
      sourceCategory: "international_tech",
    },
    {
      ...candidate("Р§Р°СЃС‚РёРЅР° РјС–СЃС‚Р° Р·Р°Р»РёС€РёР»Р°СЃСЏ Р±РµР· РІРѕРґРё С‡РµСЂРµР· Р°РІР°СЂС–СЋ", "local-outage"),
      sourceId: "google_news",
      sourceCategory: "general_news",
    },
    {
      ...candidate("РќР° РѕРґРЅС–Р№ РІСѓР»РёС†С– РєС–Р»СЊРєР° РіРѕРґРёРЅ РЅРµ Р±СѓРґРµ РІРѕРґРё С‡РµСЂРµР· РїР»Р°РЅРѕРІРёР№ СЂРµРјРѕРЅС‚", "one-street"),
      sourceId: "google_news",
      sourceCategory: "general_news",
    },
  ];
  const saved = [];
  const pipeline = createEditorPipeline({
    discover: async () => items,
    extract: async () => { throw new Error("must not run"); },
    classify: async () => { throw new Error("must not run"); },
    repository: {
      listForDedup: async () => [],
      saveMaterial: async (material) => { saved.push(material); return material; },
    },
  });

  const report = await pipeline.scan();

  assert.equal(report.queued, items.length);
  assert.equal(report.categories.regulator, 1);
  assert.equal(report.categories.government, 1);
  assert.equal(report.categories.parliament, 1);
  assert.equal(report.categories.association, 1);
  assert.equal(report.categories.donor, 1);
  assert.equal(report.categories.international_tech, 1);
  assert.equal(report.categories.local_media, 2);
  assert.equal(report.priorities.high, 5);
  assert.equal(report.priorities.medium, 2);
  assert.equal(report.priorities.low, 1);
  assert.equal(saved.find((material) => material.url.endsWith("nerc-tariff")).aiDecision.priorityLevel, "high");
  assert.equal(saved.find((material) => material.url.endsWith("smart-water")).aiDecision.materialCategory, "international_tech");
  assert.equal(saved.find((material) => material.url.endsWith("one-street")).aiDecision.priorityLevel, "low");
});

test("international smart water and wastewater technology title is accepted without OpenAI", async () => {
  const items = [
    {
      ...candidate("International wastewater technology improves water supply infrastructure", "wastewater-tech"),
      sourceId: "google_news",
      sourceCategory: "international_tech",
      sourceName: "WaterWorld",
    },
  ];
  let classifications = 0;
  const saved = [];
  const pipeline = createEditorPipeline({
    discover: async () => items,
    extract: async () => { throw new Error("must not run"); },
    classify: async () => {
      classifications += 1;
      throw new Error("must not run");
    },
    repository: {
      listForDedup: async () => [],
      saveMaterial: async (material) => { saved.push(material); return material; },
    },
  });

  const report = await pipeline.scan();

  assert.equal(report.queued, 1);
  assert.equal(report.accepted_title_keyword_fallback, 1);
  assert.equal(report.categories.international_tech, 1);
  assert.equal(classifications, 0);
  assert.equal(saved[0].aiDecision.materialCategory, "international_tech");
});

test("pipeline still journals OpenAI errors for valid articles", async () => {
  const item = candidate("РЎС‚Р°РЅ РІРѕРґРѕРїСЂРѕРІС–РґРЅРѕС— РјРµСЂРµР¶С– РіСЂРѕРјР°РґРё", "ai-error");
  const saved = [];
  const pipeline = createEditorPipeline({
    discover: async () => [item],
    extract: async () => ({ ...item, content: "РџРёС‚РЅРµ РІРѕРґРѕРїРѕСЃС‚Р°С‡Р°РЅРЅСЏ. ".repeat(30), sourceTrusted: true, extractionStatus: "ok" }),
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
