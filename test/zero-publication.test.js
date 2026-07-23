import assert from "node:assert/strict";
import test from "node:test";

import { generatePublicDescription, prepareMaterialContext } from "../src/context.js";
import {
  standalonePublicationEligibility,
  validatePublicDescription,
} from "../src/editorial.js";
import { createAutoPublisher } from "../src/publisher.js";

const sourceArticle = [
  "Миколаївводоканал повідомив про програму заміни зношених мереж водопостачання у місті.",
  "Підприємство пояснило, що частина трубопроводів працює понад нормативний строк і спричиняє втрати води.",
  "У повідомленні зазначено, що роботи мають зменшити аварійність і стабілізувати централізоване водопостачання для споживачів.",
  "Міська рада координує підготовку ділянок, де комунальні служби виконуватимуть першочергові ремонти.",
  "Водоканал наголосив, що графіки робіт публікуватимуться окремо після погодження технічних рішень.",
].join(" ");

const validGeneratedDescription = [
  "Миколаївводоканал повідомив про програму заміни зношених мереж водопостачання у місті.",
  "Підприємство пояснило, що частина трубопроводів працює понад нормативний строк і спричиняє втрати води.",
  "За даними джерела, роботи мають зменшити аварійність і стабілізувати централізоване водопостачання для споживачів.",
  "Міська рада координує підготовку ділянок, де комунальні служби виконуватимуть першочергові ремонти.",
  "Водоканал зазначив, що графіки робіт публікуватимуться окремо після погодження технічних рішень.",
].join(" ");

function material(overrides = {}) {
  return {
    id: 10,
    title: "Миколаївводоканал замінює зношені мережі водопостачання",
    sourceName: "Миколаївводоканал",
    source_name: "Миколаївводоканал",
    url: "https://example.com/water-networks",
    content: sourceArticle,
    summary: "Миколаївводоканал повідомив про заміну зношених мереж водопостачання.",
    contextBasis: "full_article",
    aiDecision: { materialCategory: "vodokanal", priorityLevel: "high" },
    ...overrides,
  };
}

function response(text) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      output: [{ content: [{ type: "output_text", text }] }],
    }),
  };
}

test("one-paragraph full article can produce a validated 5-sentence public description", async () => {
  const prepared = await prepareMaterialContext(material({
    content: sourceArticle.replaceAll(". ", " "),
  }), {
    forPublication: true,
    apiKey: "test-key",
    fetchImpl: async () => response(validGeneratedDescription),
  });

  const validation = validatePublicDescription(prepared.publicDescriptionUk, prepared);
  assert.equal(validation.valid, true);
  assert.equal(validation.sentenceCount, 5);
  assert.equal(standalonePublicationEligibility(prepared).eligible, true);
});

test("generated public description may summarize source facts without verbatim sentence copying", () => {
  const description = validGeneratedDescription.replace(
    "повідомив про програму заміни",
    "повідомив про детальний план заміни",
  );

  assert.equal(validatePublicDescription(description, material()).valid, true);
  assert.equal(sourceArticle.includes(description.split(". ")[0]), false);
});

test("unsupported numbers and dates are rejected in public descriptions", () => {
  const withNumber = `${validGeneratedDescription} Додатково підприємство нібито замінить 999 кілометрів мереж.`;
  assert.equal(validatePublicDescription(withNumber, material()).reason, "unsupported_numbers");

  const withDate = `${validGeneratedDescription} Роботи нібито почнуться 31 грудня 2026 року.`;
  assert.equal(validatePublicDescription(withDate, material()).reason, "unsupported_dates");
});

test("generic filler is rejected in public descriptions", () => {
  const filler = [
    "Матеріал стосується водного сектору та може мати значення для розуміння ситуації.",
    "Миколаївводоканал повідомив про програму заміни зношених мереж водопостачання у місті.",
    "Підприємство пояснило, що частина трубопроводів працює понад нормативний строк і спричиняє втрати води.",
    "Міська рада координує підготовку ділянок, де комунальні служби виконуватимуть першочергові ремонти.",
    "Водоканал зазначив, що графіки робіт публікуватимуться окремо після погодження технічних рішень.",
  ].join(" ");
  assert.equal(validatePublicDescription(filler, material()).valid, false);
});

test("public description generation performs one correction attempt after validation failure", async () => {
  const calls = [];
  const result = await generatePublicDescription(material(), {
    apiKey: "test-key",
    fetchImpl: async (_url, request) => {
      calls.push(JSON.parse(request.body));
      return response(calls.length === 1 ? "Занадто коротко. Лише два речення." : validGeneratedDescription);
    },
  });

  assert.equal(result.failed, false);
  assert.equal(result.generated, true);
  assert.equal(result.attempts, 2);
  assert.equal(calls.length, 2);
});

test("valid publicDescriptionUk restores standalone publication for short RSS-style material", async () => {
  const sent = [];
  const statuses = [];
  const queue = [material({ id: 22, content: "Короткий RSS snippet.", contextBasis: "rss_snippet" })];
  const publisher = createAutoPublisher({
    repository: {
      countPublishedToday: async () => 0,
      getQueue: async () => queue.splice(0, 1),
      setStatus: async (...args) => statuses.push(args),
      setPublicDescription: async (...args) => statuses.push(["publicDescription", ...args]),
      recordPublishFailure: async () => {},
    },
    telegram: { sendMessage: async (...args) => sent.push(args) },
    channelId: "-1001",
    intervalMs: 0,
    dryRun: false,
    verifySource: async () => ({ verified: true }),
    prepareContext: async (item) => ({ ...item, content: sourceArticle, contextBasis: "full_article", publicDescriptionUk: validGeneratedDescription }),
    sleep: async () => {},
    logger: { error: () => {}, info: () => {} },
  });

  const result = await publisher.drain();
  assert.equal(result.publishedNow, 1);
  assert.match(sent[0][1], /Миколаївводоканал повідомив про програму/);
  assert.equal(statuses.some((entry) => entry[0] === "publicDescription"), true);
  assert.deepEqual(statuses.at(-1).slice(0, 2), [22, "published"]);
});

test("invalid editor_text cannot bypass standalone eligibility", async () => {
  const sent = [];
  const statuses = [];
  const queue = [material({
    id: 33,
    content: "Коротко.",
    contextBasis: "rss_snippet",
    editor_text: "<b>Короткий заголовок</b>\n\nДжерело: Test",
  })];
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
    sleep: async () => {},
    logger: { error: () => {}, info: () => {} },
  });

  const result = await publisher.drain();
  assert.equal(result.publishedNow, 0);
  assert.equal(result.digestOnlyNow, 1);
  assert.equal(sent.length, 0);
  assert.deepEqual(statuses[0].slice(0, 2), [33, "digest_only"]);
});
