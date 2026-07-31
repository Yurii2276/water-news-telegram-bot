import assert from "node:assert/strict";
import test from "node:test";

import { createEditorPipeline } from "../src/editor.js";
import { rescueTitleFallback } from "../src/relevanceRescue.js";
import { compactStandalonePublicationEligibility } from "../src/compactPublication.js";

const relevantTitles = [
  ["Скільки коштує вода у Києві сьогодні і як може зрости тариф", "tariffs"],
  ["У Києві та Львові вода подорожчає більш ніж удвічі", "tariffs"],
  ["Якість води під контролем. Результати лабораторних перевірок у липні", "drinking_water"],
  ["У спальному районі Запоріжжя перекрили воду", "outages"],
  ["П’ятий випадок отруєння колодязною водою у громаді", "drinking_water"],
];

for (const [title, category] of relevantTitles) {
  test(`relevance rescue accepts: ${title}`, () => {
    const result = rescueTitleFallback({ title });
    assert.equal(result.accepted, true);
    assert.equal(result.category, category);
  });
}

test("relevance rescue keeps unrelated personnel news rejected", () => {
  const result = rescueTitleFallback({
    title: "Голова Держагентства відновлення пояснив причини своєї відставки",
  });
  assert.equal(result.accepted, false);
});

test("relevance rescue does not accept hot-water-only maintenance", () => {
  const result = rescueTitleFallback({
    title: "У місті не буде гарячої води через ремонт тепломережі",
  });
  assert.equal(result.accepted, false);
});

test("duplicate candidates are reported but are not written back to the database", async () => {
  const item = {
    title: "НКРЕКП схвалила тариф на воду",
    url: "https://www.nerc.gov.ua/news/tariff-water",
    sourceId: "nerc",
    sourceName: "НКРЕКП",
    sourceCategory: "regulator",
    discoveryMethod: "official",
  };
  let writes = 0;
  const pipeline = createEditorPipeline({
    discover: async () => [item],
    extract: async () => { throw new Error("must not extract duplicate"); },
    classify: async () => { throw new Error("must not classify duplicate"); },
    repository: {
      listForDedup: async () => [{ id: 1, ...item, story_key: "existing" }],
      saveMaterial: async () => { writes += 1; },
    },
  });

  const report = await pipeline.scan();
  assert.equal(report.duplicates, 1);
  assert.equal(report.duplicateBy.url, 1);
  assert.equal(report.queued, 0);
  assert.equal(writes, 0);
});

test("compact grounded fallback permits a factual standalone post", () => {
  const material = {
    title: "Водоканал замінює аварійну ділянку водогону",
    sourceName: "Міський водоканал",
    contextBasis: "full_article",
    content: [
      "Міський водоканал повідомив про заміну аварійної ділянки магістрального водогону.",
      "Роботи виконують для стабілізації централізованого водопостачання у громаді.",
      "Підприємство зазначило, що після завершення ремонту подачу води відновлять у штатному режимі.",
    ].join(" "),
    aiDecision: {
      relevant: true,
      summary: "Міський водоканал повідомив про заміну аварійної ділянки магістрального водогону.",
      materialCategory: "vodokanal",
    },
  };

  const result = compactStandalonePublicationEligibility(material);
  assert.equal(result.eligible, true);
  assert.match(result.description, /водоканал/i);
});
