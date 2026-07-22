import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanTitle,
  createStoryKey,
  factualExtract,
  inferSourceQuality,
  isSignificantLocalIncident,
  publicCategoryEmoji,
  publicCategoryLabel,
  uniqueStoryMaterials,
  validatePublicContext,
  validatePublicMessage,
  visibleTextFromHtml,
} from "../src/editorial.js";
import { prepareMaterialContext } from "../src/context.js";
import { formatDailyDigest } from "../src/bot.js";
import { formatPublication } from "../src/telegram.js";
import { createEditorPipeline } from "../src/editor.js";

test("cleanTitle removes repeated source suffixes", () => {
  assert.equal(cleanTitle("Частина Одеси залишилася без води — Суспільне | Новини", "Суспільне"), "Частина Одеси залишилася без води");
});

test("generic professional context is suppressed", () => {
  const material = {
    title: "НКРЕКП схвалила тариф на воду для водоканалу",
    content: "НКРЕКП схвалила тариф на воду для водоканалу у відкритому рішенні.",
  };
  assert.equal(validatePublicContext("Матеріал стосується регулювання водопостачання та може впливати на тарифи.", material), "");
});

test("factual context is extracted only from snippet/content", async () => {
  const material = {
    title: "Миколаївводоканал через зношені мережі втрачає 40% води",
    summary: "Миколаївводоканал повідомив, що через зношені мережі підприємство втрачає 40% води.",
    aiDecision: { titleKeywordFallback: true, materialCategory: "vodokanal" },
  };
  const prepared = await prepareMaterialContext(material);
  assert.match(prepared.professionalContextUk, /40% води/);
});

test("title-only material does not invent professional context", async () => {
  const prepared = await prepareMaterialContext({
    title: "У місті тимчасово не буде води",
    aiDecision: { titleKeywordFallback: true, materialCategory: "local_media" },
  });
  assert.equal(prepared.professionalContextUk, "");
});

test("story-level clustering keeps strongest source", () => {
  const low = {
    id: 1,
    title: "Тариф на воду у громаді зросте до 100 грн",
    source_name: "Local site",
    sourceQuality: "local_media",
    ai_decision: { priorityScore: 50 },
  };
  const official = {
    id: 2,
    title: "Тариф на воду у громаді зросте до 100 грн",
    source_name: "НКРЕКП",
    sourceQuality: "official_regulator",
    ai_decision: { priorityScore: 90 },
  };
  assert.equal(uniqueStoryMaterials([low, official]).length, 1);
  assert.equal(uniqueStoryMaterials([low, official])[0].id, 2);
});

test("source quality classification recognizes official regulator and aggregator", () => {
  assert.equal(inferSourceQuality({ sourceName: "НКРЕКП", url: "https://www.nerc.gov.ua/news/1" }), "official_regulator");
  assert.equal(inferSourceQuality({ sourceName: "Google News discovery", sourceId: "google_news" }), "aggregator");
});

test("personnel category uses separate icon and label", () => {
  const material = { aiDecision: { materialCategory: "personnel_change" } };
  assert.equal(publicCategoryEmoji(material), "👤");
  assert.equal(publicCategoryLabel(material), "Кадрові рішення");
});

test("routine local incidents can be capped while significant incidents pass", () => {
  assert.equal(isSignificantLocalIncident({
    title: "На одній вулиці кілька годин не буде води",
    aiDecision: { materialCategory: "local_media" },
  }), false);
  assert.equal(isSignificantLocalIncident({
    title: "Частина міста залишилася без питної води через аварію на магістральному водогоні",
    aiDecision: { materialCategory: "local_media" },
  }), true);
});

test("daily digest uses public labels and Ukrainian display titles without empty sections", () => {
  const text = formatDailyDigest([
    {
      id: 1,
      title: "Smart water leak detection cuts losses",
      displayTitleUk: "Технології smart water скорочують втрати води",
      sourceName: "WaterWorld",
      url: "https://example.com/smart-water",
      summary: "WaterWorld повідомляє про технології smart water для скорочення втрат води.",
      aiDecision: { materialCategory: "international_tech", priorityLevel: "medium" },
    },
  ]);
  assert.match(text, /Вода UA: головне за день/);
  assert.match(text, /Технології smart water скорочують втрати води/);
  assert.doesNotMatch(text, /high|medium|low/);
  assert.doesNotMatch(text, /Немає важливих повідомлень/);
});

test("Telegram publication omits generic context and uses public URL", () => {
  const text = formatPublication({
    title: "НКРЕКП схвалила тариф на воду",
    url: "https://www.nerc.gov.ua/news/tariff",
    sourceName: "НКРЕКП",
    aiDecision: {
      materialCategory: "regulator",
      whyImportant: "Матеріал стосується регулювання водопостачання та може впливати на тарифи.",
    },
  });
  assert.match(text, /💰 <b>Тарифи<\/b>/);
  assert.match(text, /<a href="https:\/\/www\.nerc\.gov\.ua\/news\/tariff">Читати джерело<\/a>/);
  assert.doesNotMatch(visibleTextFromHtml(text), /https:\/\/www\.nerc\.gov\.ua\/news\/tariff/);
  assert.doesNotMatch(text, /Матеріал стосується/);
});

test("public message validator rejects visible URLs but preserves href URLs", () => {
  const safe = 'Джерело: Example\n🔗 <a href="https://example.com/source">Читати джерело</a>';
  assert.equal(validatePublicMessage(safe), safe);
  assert.equal(visibleTextFromHtml(safe), "Джерело: Example 🔗 Читати джерело");
  assert.throws(
    () => validatePublicMessage("Джерело: Example\nhttps://example.com/source"),
    /visible raw URL/,
  );
});

test("strong keyword fallback does not call OpenAI classifier", async () => {
  let classifyCalls = 0;
  const saved = [];
  const pipeline = createEditorPipeline({
    discover: async () => [{
      title: "Миколаївводоканал через зношені мережі втрачає 40% води",
      url: "https://example.com/vodokanal-losses",
      sourceName: "Укрінформ",
      sourceId: "ukrinform",
      discoveryMethod: "rss",
      summary: "Миколаївводоканал повідомив про втрати води через зношені мережі.",
    }],
    extract: async (candidate) => ({ ...candidate, extractionStatus: "insufficient_content", content: "" }),
    classify: async () => {
      classifyCalls += 1;
      return { relevant: false };
    },
    repository: {
      listForDedup: async () => [],
      saveMaterial: async (material) => {
        saved.push(material);
        return { id: saved.length, ...material };
      },
    },
  });
  const report = await pipeline.scan();
  assert.equal(classifyCalls, 0);
  assert.equal(report.queued, 1);
  assert.equal(saved[0].aiDecision.titleKeywordFallback, true);
});

test("international smart water title is accepted and prepared for Ukrainian publication", async () => {
  const saved = [];
  const pipeline = createEditorPipeline({
    discover: async () => [{
      title: "Smart water leak detection reduces non-revenue water",
      url: "https://example.com/smart-water",
      sourceName: "WaterWorld",
      sourceId: "waterworld",
      sourceCategory: "international_tech",
      discoveryMethod: "google_news_targeted",
      summary: "Smart water leak detection reduces non-revenue water in utilities.",
    }],
    extract: async (candidate) => ({ ...candidate, extractionStatus: "insufficient_content", content: "" }),
    classify: async () => {
      throw new Error("classifier should not be called");
    },
    repository: {
      listForDedup: async () => [],
      saveMaterial: async (material) => {
        saved.push(material);
        return material;
      },
    },
  });
  const report = await pipeline.scan();
  assert.equal(report.queued, 1);
  assert.equal(saved[0].aiDecision.materialCategory, "international_tech");
});
