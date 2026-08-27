import assert from "node:assert/strict";
import test from "node:test";

import { discoverExpandedSources } from "../src/expandedDiscovery.js";

function rss(title, link, source = "Water Tech News") {
  return `<?xml version="1.0"?><rss><channel><item><title>${title}</title><link>${link}</link><pubDate>Thu, 27 Aug 2026 06:00:00 GMT</pubDate><description>Fresh water-sector development with concrete operational information for utilities.</description><source url="https://example.com">${source}</source></item></channel></rss>`;
}

test("expanded discovery adds international technology and donor lanes", async () => {
  let supplementalCalls = 0;
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes("news.google.com") && (value.includes("US%3Aen") || value.includes("US%253Aen"))) {
      supplementalCalls += 1;
      const technology = value.includes("water+utility") || value.includes("water%20utility") || value.includes("digital+water") || value.includes("digital%20water");
      return {
        ok: true,
        status: 200,
        url,
        text: async () => technology
          ? rss("Digital twin cuts water losses at utility", `https://news.google.com/rss/articles/tech-${supplementalCalls}`)
          : rss("EBRD finances wastewater reconstruction in Ukraine", `https://news.google.com/rss/articles/donor-${supplementalCalls}`, "EBRD"),
      };
    }
    if (value.includes("news.google.com")) {
      return { ok: true, status: 200, url, text: async () => "<?xml version=\"1.0\"?><rss><channel></channel></rss>" };
    }
    return { ok: false, status: 404, url, text: async () => "" };
  };

  const items = await discoverExpandedSources({
    now: new Date("2026-08-27T08:00:00Z"),
    fetchImpl,
    sleep: async () => {},
    logger: { warn: () => {} },
    sourceHealthStore: {
      isSourceInCooldown: async () => false,
      recordSourceFetchFailure: async () => ({}),
      recordSourceFetchSuccess: async () => "ok",
    },
    sourcePermanentFailureThreshold: 3,
    sourcePermanentFailureCooldownHours: 168,
    maxAgeDays: 7,
  });

  assert.ok(items.some((item) => item.discoveryLane === "international_donors"));
  assert.ok(items.some((item) => item.discoveryLane === "international_technology"));
  assert.ok((items.diagnostics?.google_queries_executed ?? 0) >= 7);
  assert.ok((items.diagnostics?.supplemental_google_candidates ?? 0) >= 2);
});
