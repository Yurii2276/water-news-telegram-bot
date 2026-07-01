import assert from "node:assert/strict";
import test from "node:test";

import { createEditorPipeline } from "../src/editor.js";

function candidate(title, suffix) {
  return {
    title,
    url: `https://www.davr.gov.ua/news/${suffix}`,
    sourceId: "davr",
    sourceName: "Держводагентство",
    discoveryMethod: "official",
  };
}

test("pipeline categorizes rejection reasons and journals OpenAI errors", async () => {
  const irrelevant = candidate("Спортивний календар на рік", "sport");
  const missing = candidate("Новий водогін для громади", "missing");
  const aiFailure = candidate("Питна вода для громади", "ai-error");
  const saved = [];

  const pipeline = createEditorPipeline({
    discover: async () => [irrelevant, missing, aiFailure],
    extract: async (item) => {
      if (item === missing) {
        return {
          ...item,
          content: "",
          sourceTrusted: false,
          extractionStatus: "unresolved_primary_source",
        };
      }
      return {
        ...item,
        content: "Підтверджений текст про питне водопостачання. ".repeat(20),
        sourceTrusted: true,
        extractionStatus: "ok",
      };
    },
    classify: async () => {
      throw new Error("quota exceeded");
    },
    repository: {
      listForDedup: async () => [],
      saveMaterial: async (material) => {
        saved.push(material);
        return material;
      },
    },
    logger: { error: () => {} },
  });

  const report = await pipeline.scan();

  assert.deepEqual(report.rejectedBy, {
    irrelevant: 1,
    openaiError: 1,
    missingContentOrLink: 1,
    other: 0,
  });
  assert.equal(report.rejectedItems.length, 3);
  assert.ok(saved.some((item) => item.status === "rejected_ai_error"));
});
