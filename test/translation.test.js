import assert from "node:assert/strict";
import test from "node:test";

import {
  isMostlyCyrillicTitle,
  needsUkrainianTitle,
  prepareMaterialDisplayTitle,
  titleForDisplay,
  translateTitleToUkrainian,
} from "../src/translation.js";

function openAiTitleResponse(title) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: title,
            },
          ],
        },
      ],
    }),
  };
}

test("Ukrainian/Cyrillic title is not translated", async () => {
  let calls = 0;
  const title = "НКРЕКП схвалила тарифи на водопостачання";
  const result = await translateTitleToUkrainian(title, {
    apiKey: "test-key",
    fetchImpl: async () => {
      calls += 1;
      return openAiTitleResponse("must not be used");
    },
  });

  assert.equal(isMostlyCyrillicTitle(title), true);
  assert.equal(needsUkrainianTitle(title), false);
  assert.equal(result.title, title);
  assert.equal(result.translated, false);
  assert.equal(calls, 0);
});

test("English/Latin title gets Ukrainian display title", async () => {
  const material = {
    title: "Global smart water leak detection technology cuts non-revenue water",
    sourceName: "WaterWorld",
    url: "https://example.com/smart-water",
  };

  const prepared = await prepareMaterialDisplayTitle(material, {
    apiKey: "test-key",
    fetchImpl: async () => openAiTitleResponse("Технологія smart water для виявлення витоків скорочує втрати води"),
  });

  assert.equal(prepared.displayTitleUk, "Технологія smart water для виявлення витоків скорочує втрати води");
  assert.equal(prepared.sourceName, "WaterWorld");
  assert.equal(prepared.url, "https://example.com/smart-water");
  assert.equal(titleForDisplay(prepared), prepared.displayTitleUk);
});

test("OpenAI translation failure falls back to original title", async () => {
  const warnings = [];
  const result = await translateTitleToUkrainian("Smart water infrastructure funding announced", {
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: "quota exceeded" } }),
    }),
    logger: { warn: (...args) => warnings.push(args) },
  });

  assert.equal(result.title, "Smart water infrastructure funding announced");
  assert.equal(result.translated, false);
  assert.equal(result.failed, true);
  assert.equal(warnings[0][0], "Title translation failed");
});
