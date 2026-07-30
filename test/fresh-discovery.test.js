import assert from "node:assert/strict";
import test from "node:test";

import { discoverFreshSources } from "../src/freshDiscovery.js";

function rss(title, url, date) {
  return `<?xml version="1.0"?><rss><channel><item><title>${title}</title><link>${url}</link><pubDate>${date}</pubDate><source>Test</source></item></channel></rss>`;
}

test("fresh discovery merges rotating passes and removes stale/duplicate items", async () => {
  const calls = [];
  const freshDate = "Wed, 29 Jul 2026 10:00:00 GMT";
  const staleDate = "Wed, 01 Jul 2026 10:00:00 GMT";
  const fetchImpl = async (url) => {
    calls.push(url);
    const body = String(url).includes("stale")
      ? rss("Стара новина про водопостачання", "https://example.com/stale", staleDate)
      : rss("Свіжа новина про водопостачання", "https://example.com/fresh", freshDate);
    return {
      ok: true,
      status: 200,
      url,
      headers: { get: () => null },
      text: async () => body,
    };
  };

  const items = await discoverFreshSources({
    googleNewsRssUrl: "https://news.google.com/rss/search?q=water",
    fetchImpl,
    logger: { error: () => {}, warn: () => {}, info: () => {} },
    sleep: async () => {},
    now: new Date("2026-07-30T12:00:00Z"),
    maxAgeDays: 5,
    passes: 3,
  });

  assert.equal(items.filter((item) => item.url === "https://example.com/fresh").length, 1);
  assert.equal(items.some((item) => item.url === "https://example.com/stale"), false);
  assert.ok(calls.length > 3);
});
