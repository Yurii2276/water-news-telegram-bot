import assert from "node:assert/strict";
import test from "node:test";

import { createNewsSearchState, fetchNewsSearchLane } from "../src/newsSearchProvider.js";

const RSS = `<?xml version="1.0"?><rss><channel><item><title>Smart water utility deploys leak detection</title><link>https://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3A%2F%2Fexample.com%2Fwater-news</link><pubDate>Thu, 27 Aug 2026 06:00:00 GMT</pubDate><description>Utility deploys smart metering and leak detection across the network.</description><source>Water Technology</source></item></channel></rss>`;

test("Google transient failure switches remaining lanes to Bing instead of aborting the scan", async () => {
  let googleCalls = 0;
  let bingCalls = 0;
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes("news.google.com")) {
      googleCalls += 1;
      return { ok: false, status: 503, url, text: async () => "" };
    }
    if (value.includes("bing.com/news/search")) {
      bingCalls += 1;
      return { ok: true, status: 200, url, text: async () => RSS };
    }
    throw new Error(`Unexpected URL: ${value}`);
  };

  const diagnostics = {};
  const state = createNewsSearchState();
  const common = {
    fetchImpl,
    sleep: async () => {},
    diagnostics,
    state,
    logger: { warn: () => {} },
    limit: 10,
  };

  const first = await fetchNewsSearchLane({
    ...common,
    lane: { id: "technology", query: '"smart water" when:7d', hl: "en-US", gl: "US", ceid: "US:en" },
  });
  const second = await fetchNewsSearchLane({
    ...common,
    lane: { id: "cyber", query: '"water utility" SCADA when:7d', hl: "en-US", gl: "US", ceid: "US:en" },
  });

  assert.equal(googleCalls, 2, "only the first lane retries Google before the circuit switches provider");
  assert.equal(bingCalls, 2, "both lanes are still searched through the fallback provider");
  assert.equal(diagnostics.google_queries_executed, 2, "diagnostic counts coverage lanes, not HTTP retries");
  assert.equal(diagnostics.google_http_requests, 2);
  assert.equal(diagnostics.bing_fallback_queries, 2);
  assert.equal(diagnostics.news_search_fallback_successes, 2);
  assert.equal(diagnostics.google_circuit_opened, 1);
  assert.equal(first[0].searchProvider, "bing");
  assert.equal(first[0].url, "https://example.com/water-news");
  assert.equal(second[0].url, "https://example.com/water-news");
});
