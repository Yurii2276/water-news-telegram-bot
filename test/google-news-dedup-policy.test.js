import assert from "node:assert/strict";
import test from "node:test";

import { resolvedDedupPool, shouldRunCandidateDedup } from "../src/dedupPolicy.js";

test("Google News candidates are resolved before candidate-level dedup", () => {
  const candidate = {
    sourceId: "google_news",
    url: "https://news.google.com/rss/articles/example",
  };
  assert.equal(shouldRunCandidateDedup(candidate), false);
});

test("raw Google News database rows do not block a resolved primary source", () => {
  const candidate = {
    sourceId: "google_news",
    url: "https://news.google.com/rss/articles/example",
  };
  const existing = [
    { url: "https://news.google.com/rss/articles/example", title: "Нова водна новина" },
    { url: "https://suspilne.media/example", title: "Інша новина" },
  ];
  assert.deepEqual(resolvedDedupPool(existing, candidate), [existing[1]]);
});

test("direct-source candidates keep normal duplicate checking", () => {
  const candidate = { sourceId: "nerc", url: "https://www.nerc.gov.ua/news/example" };
  assert.equal(shouldRunCandidateDedup(candidate), true);
  const existing = [{ url: candidate.url }];
  assert.equal(resolvedDedupPool(existing, candidate), existing);
});
