import assert from "node:assert/strict";
import test from "node:test";

import { classifyArticle, validateAiDecision } from "../src/ai.js";

const acceptedDecision = {
  relevant: true,
  relevanceScore: 96,
  category: "water_supply",
  importance: 84,
  confidence: "high",
  confidenceScore: 91,
  summary: "Завершено будівництво водогону.",
  whyImportant: "Громада отримує стабільне питне водопостачання.",
  hashtags: ["#водопостачання"],
  rejectionReason: "",
};

test("AI response is parsed from strict Responses API output", async () => {
  let request;
  const fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        output: [
          {
            content: [
              { type: "output_text", text: JSON.stringify(acceptedDecision) },
            ],
          },
        ],
      }),
    };
  };

  const result = await classifyArticle(
    {
      title: "Новий водогін",
      url: "https://example.com",
      sourceName: "Офіційне джерело",
      content: "Факт про завершене будівництво водогону. ".repeat(20),
    },
    { apiKey: "test-key", fetchImpl },
  );

  assert.deepEqual(result, acceptedDecision);
  assert.equal(request.text.format.type, "json_schema");
  assert.match(request.input[0].content, /ВИКЛЮЧНО/);
});

test("low-confidence AI acceptance is converted to rejection", () => {
  const result = validateAiDecision({
    ...acceptedDecision,
    confidence: "low",
  });
  assert.equal(result.relevant, false);
  assert.match(result.rejectionReason, /довіри/);
});

test("AI acceptance below 85 percent relevance is rejected", () => {
  const result = validateAiDecision({
    ...acceptedDecision,
    relevanceScore: 84,
  });
  assert.equal(result.relevant, false);
  assert.match(result.rejectionReason, /Релевантність/);
});

test("article without source content is rejected without AI call", async () => {
  const result = await classifyArticle(
    { title: "Коротко", content: "Замало" },
    {
      apiKey: "test",
      fetchImpl: async () => {
        throw new Error("must not be called");
      },
    },
  );
  assert.equal(result.relevant, false);
  assert.match(result.rejectionReason, /Недостатньо/);
});
