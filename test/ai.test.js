import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyArticle,
  MIN_AI_CONFIDENCE_SCORE,
  MIN_AI_RELEVANCE_SCORE,
  validateAiDecision,
} from "../src/ai.js";

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
  assert.match(request.input[0].content, /WASH/);
  assert.match(request.input[0].content, /водн.*ресурс/);
});

test("low-confidence AI acceptance is converted to rejection", () => {
  const result = validateAiDecision({
    ...acceptedDecision,
    confidence: "low",
  });
  assert.equal(result.relevant, false);
  assert.match(result.rejectionReason, /довіри/);
});

test("AI acceptance below corrected relevance threshold is rejected", () => {
  const result = validateAiDecision({
    ...acceptedDecision,
    relevanceScore: MIN_AI_RELEVANCE_SCORE - 1,
  });
  assert.equal(result.relevant, false);
  assert.match(result.rejectionReason, /Релевантність/);
});

test("medium-confidence water-sector article above 70 percent is accepted", () => {
  const result = validateAiDecision({
    ...acceptedDecision,
    relevanceScore: Math.max(MIN_AI_RELEVANCE_SCORE, 78),
    confidence: "medium",
    confidenceScore: Math.max(MIN_AI_CONFIDENCE_SCORE, 76),
  });
  assert.equal(result.relevant, true);
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
