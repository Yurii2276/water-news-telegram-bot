import assert from "node:assert/strict";
import test from "node:test";

import { discoverExpandedSources } from "../src/expandedDiscovery.js";

function rss(title, link, source = "Water Tech News") {
  return `<?xml version="1.0"?><rss><channel><item><title>${title}</title><link>${link}</link><pubDate>Thu, 27 Aug 2026 06:00:00 GMT</pubDate><description>Fresh water-sector development with concrete operational information for utilities.</description><source url="https://example.com">${source}</source></item></channel></rss>`;
}

test("expanded discovery adds broad donor, utility, technology and cyber lanes", async () => {
  let googleCalls = 0;
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes("news.google.com")) {
      googleCalls += 1;
      let title = "Digital twin cuts water losses at utility";
      let source = "Water Tech News";
      if (value.includes("EBRD") || value.includes("World+Bank") || value.includes("World%20Bank")) {
        title = "EBRD finances wastewater reconstruction in Ukraine";
        source = "EBRD";
      } else if (value.includes("cybersecurity") || value.includes("SCADA")) {
        title = "Water utility strengthens SCADA cybersecurity";
      } else if (value.includes("%D0%B2%D0%BE%D0%B4%D0%BE%D0%BA%D0%B0%D0%BD%D0%B0%D0%BB") || value.includes("vodokanal")) {
        title = "Водоканал модернізує мережі водопостачання";
        source = "Водоканал";
      }
      return {
        ok: true,
        status: 200,
        url,
        text: async () => rss(title, `https://news.google.com/rss/articles/item-${googleCalls}`, source),
      };
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
  assert.ok(items.some((item) => item.discoveryLane === "international_cyber_ot"));
  assert.ok(items.some((item) => item.discoveryLane === "international_treatment_innovation"));
  assert.ok(items.some((item) => item.discoveryLane === "ua_water_utilities"));
  assert.ok((items.diagnostics?.google_queries_executed ?? 0) >= 10);
  assert.ok((items.diagnostics?.supplemental_google_candidates ?? 0) >= 5);
});
