import assert from "node:assert/strict";
import test from "node:test";

import {
  contentSimilarity,
  findDuplicate,
  normalizeTitle,
  normalizeUrl,
} from "../src/dedup.js";

test("URL normalization removes tracking and cosmetic differences", () => {
  assert.equal(
    normalizeUrl("https://www.example.com/news/?utm_source=test#part"),
    "https://example.com/news",
  );
});

test("deduplication detects normalized titles", () => {
  const result = findDuplicate(
    {
      url: "https://example.com/new",
      title: "Новий водогін: проєкт!",
      content: "Інший текст",
    },
    [
      {
        url: "https://example.com/old",
        title: "Новий водогін — проєкт",
        content: "Попередній текст",
      },
    ],
  );
  assert.equal(normalizeTitle("Тест — новина"), "тест новина");
  assert.equal(result.reason, "title");
});

test("content similarity catches near-identical material", () => {
  const left =
    "Громада завершила будівництво нового водогону для стабільного постачання питної води";
  const right =
    "Громада завершила будівництво нового водогону для стабільного постачання якісної питної води";
  assert.ok(contentSimilarity(left, right) > 0.82);
});

