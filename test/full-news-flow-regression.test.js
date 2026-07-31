import assert from "node:assert/strict";
import test from "node:test";

import { buildCompactPublicDescription } from "../src/compactPublication.js";
import { createEditorPipeline } from "../src/editor.js";
import { rescueTitleFallback } from "../src/relevanceRescue.js";

const rescuedTitles = [
  ["Скільки коштує вода у Києві сьогодні і як може зрости тариф", "tariffs"],
  ["У Києві та Львові вода подорожчає більш ніж удвічі", "tariffs"],
  ["Якість води під контролем. Результати лабораторних перевірок у липні", "drinking_water"],
  ["У спальному районі Запоріжжя перекрили воду", "outages"],
  ["Вода у річці забруднена: зафіксовано перевищення хлоридів", "drinking_water"],
  ["Зафіксовано отруєння колодязною водою", "drinking_water"],
];

test("rescues the missed Ukrainian water-sector headline forms", () => {
  for (const [title, category] of rescuedTitles) {
    const result = rescueTitleFallback({ title });
    assert.equal(result.accepted, true, title);
    assert.equal(result.category, category, title);
  }
});

test("does not rescue hot-water and heating-only noise", () => {
  const result = rescueTitleFallback({
    title: "У місті не буде гарячої води через ремонт тепломережі",
  });
  assert.equal(result.accepted, false);
});

test("rescued relevant headline is queued without waiting for OpenAI classification", async () => {
  const item = {
    title: "Якість води під контролем. Результати лабораторних перевірок у липні",
    url: "https://example.gov.ua/news/water-quality",
    sourceId: "google_news",
    sourceName: "Міська рада",
    discoveryMethod: "google_news",
    summary: "Лабораторія перевірила показники води у громаді та оприлюднила результати контролю.",
  };
  const saved = [];
  let classifications = 0;
  const pipeline = createEditorPipeline({
    discover: async () => [item],
    extract: async () => ({
      ...item,
      content: [
        "Міська рада оприлюднила результати лабораторних перевірок якості води у громаді.",
        "Фахівці відібрали проби у визначених контрольних точках системи водопостачання.",
        "Дослідження охопило показники, які використовуються для регулярного контролю безпечності води.",
      ].join(" "),
      extractionStatus: "ok",
      sourceTrusted: true,
      contextBasis: "full_article",
    }),
    classify: async () => {
      classifications += 1;
      throw new Error("classification must not run for headline rescue");
    },
    repository: {
      listForDedup: async () => [],
      saveMaterial: async (material) => {
        const stored = { id: saved.length + 1, ...material };
        saved.push(stored);
        return stored;
      },
    },
  });

  const report = await pipeline.scan();
  assert.equal(report.queued, 1);
  assert.equal(report.accepted_title_keyword_fallback, 1);
  assert.equal(report.rejected, 0);
  assert.equal(classifications, 0);
  assert.equal(saved[0].status, "queued");
});

test("compact fallback builds a grounded multi-sentence publication description", () => {
  const content = [
    "Водоканал повідомив про аварійне пошкодження магістральної мережі водопостачання у місті.",
    "Ремонтні бригади локалізували витік і розпочали відновлення пошкодженої ділянки трубопроводу.",
    "Підприємство попередило мешканців про тимчасове обмеження подачі води на час виконання робіт.",
    "Після завершення ремонту систему промиють, а водопостачання відновлюватимуть поетапно.",
  ].join(" ");
  const material = {
    title: "Водоканал ремонтує магістральну мережу після аварії",
    content,
    contextBasis: "full_article",
    aiDecision: {
      summary: "Водоканал повідомив про аварійне пошкодження магістральної мережі водопостачання у місті. Ремонтні бригади локалізували витік і розпочали відновлення пошкодженої ділянки трубопроводу.",
      whyImportant: "Підприємство попередило мешканців про тимчасове обмеження подачі води на час виконання робіт.",
    },
  };

  const description = buildCompactPublicDescription(material);
  assert.ok(description.length >= 180);
  assert.match(description, /Водоканал повідомив/);
  assert.match(description, /Ремонтні бригади/);
});
