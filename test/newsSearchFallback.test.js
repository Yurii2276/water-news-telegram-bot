import assert from "node:assert/strict";
import test from "node:test";

import { bingNewsUrl, fetchNewsSearchItems } from "../src/newsSearchFallback.js";

function rss() {
  return `<?xml version="1.0"?><rss><channel><item><title>Smart water utility deploys leak detection</title><link>https://example.com/water-tech</link><pubDate>Thu, 27 Aug 2026 06:00:00 GMT</pubDate><description>Utility deploys digital leak detection across the drinking-water network.</description><source url="https://example.com">Water Tech</source></item></channel></rss>`;
}

test("Bing URL strips Google when: recency syntax", () => {
  const url = bingNewsUrl('"smart water" when:7d', { locale: "en-US", country: "US" });
  assert.ok(url.includes("bing.com/news/search"));
  assert.ok(!decodeURIComponent(url).includes("when:7d"));
  assert.ok(url.includes("format=RSS"));
});

test("Google transient failure switches the lane to Bing RSS", async () => {
  const calls = [];
  const diagnostics = {};
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("news.google.com")) {
      return { ok: false, status: 503, url, text: async () => "" };
    }
    return { ok: true, status: 200, url, text: async () => rss() };
  };

  const result = await fetchNewsSearchItems({
    query: '"smart water" OR "leak detection" when:7d',
    googleUrl: "https://news.google.com/rss/search?q=smart-water",
    locale: "en-US",
    country: "US",
    fetchImpl,
    sleep: async () => {},
    diagnostics,
    logger: { warn: () => {} },
  });

  assert.equal(result.backend, "bing");
  assert.equal(result.items.length, 1);
  assert.equal(diagnostics.google_degraded_mode, 1);
  assert.equal(diagnostics.google_failures, 1);
  assert.equal(diagnostics.bing_queries_executed, 1);
  assert.equal(diagnostics.bing_fallback_successes, 1);
  assert.ok(calls.some((url) => url.includes("news.google.com")));
  assert.ok(calls.some((url) => url.includes("bing.com/news/search")));
});
