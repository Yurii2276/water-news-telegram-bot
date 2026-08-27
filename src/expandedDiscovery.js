import { normalizeUrl } from "./dedup.js";
import { discoverHighRecallSources } from "./highRecallDiscovery.js";
import { createNewsSearchState, fetchNewsSearchLane } from "./newsSearchProvider.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Supplemental lanes are intentionally narrower than the four base queries.
// Together they cover the editorial scope without returning to the old 20+
// burst pattern. If Google News is unavailable, the shared provider state
// switches the remaining lanes to Bing RSS for the rest of the scan.
const SUPPLEMENTAL_FEEDS = [
  {
    id: "ua_water_resources",
    query: '(Держводагентство OR "водні ресурси" OR водокористування OR "водність річок" OR "забруднення вод" OR "охорона вод" OR "водна безпека") Україна when:5d',
    hl: "uk",
    gl: "UA",
    ceid: "UA:uk",
    sourceCategory: "government",
  },
  {
    id: "ua_water_utilities",
    query: '(водоканал OR "Київводоканал" OR "Харківводоканал" OR "Львівводоканал" OR "Дніпроводоканал" OR "Миколаївводоканал" OR "Черкасиводоканал" OR "Полтававодоканал" OR "Рівнеоблводоканал" OR "Житомирводоканал") (водопостачання OR водовідведення OR аварія OR ремонт OR реконструкція OR модернізація OR мережі) when:3d',
    hl: "uk",
    gl: "UA",
    ceid: "UA:uk",
    sourceCategory: "vodokanal",
  },
  {
    id: "international_donors",
    query: '(Ukraine OR Ukrainian) (water OR wastewater OR WASH OR "water infrastructure") ("World Bank" OR EBRD OR EIB OR UNICEF OR UNDP OR "European Union" OR grant OR financing OR reconstruction) when:7d',
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
    sourceCategory: "donor",
  },
  {
    id: "international_technology",
    query: '("water utility" OR "water utilities" OR wastewater OR "drinking water") ("smart water" OR "digital water" OR "non-revenue water" OR "leak detection" OR "smart metering" OR "digital twin" OR AI OR "predictive maintenance") when:7d',
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
    sourceCategory: "international_tech",
  },
  {
    id: "international_cyber_ot",
    query: '("water utility" OR wastewater OR "water treatment") (cybersecurity OR ransomware OR SCADA OR PLC OR "operational technology" OR "critical infrastructure") when:7d',
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
    sourceCategory: "international_tech",
  },
  {
    id: "international_treatment_innovation",
    query: '("water treatment" OR "wastewater treatment" OR "drinking water") (innovation OR membrane OR "membrane bioreactor" OR PFAS OR reuse OR desalination OR "nutrient removal" OR ozonation) when:7d',
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
    sourceCategory: "international_tech",
  },
];

function recentEnough(item, now, maxAgeDays) {
  if (!item?.publishedAt) return true;
  const timestamp = new Date(item.publishedAt).getTime();
  return Number.isFinite(timestamp) && timestamp >= now.getTime() - maxAgeDays * DAY_MS;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeDirectCandidate(candidate) {
  // Some DAVR listing templates wrap several neighbouring cards inside one <li>.
  // Keep only the headline before editorial noise checks and fetch the article page
  // itself later in the extraction stage.
  if (candidate?.sourceId === "davr" && candidate?.discoveryMethod === "official") {
    return { ...candidate, summary: undefined, snippet: undefined };
  }
  return candidate;
}

export async function discoverExpandedSources(options = {}) {
  const now = options.now ?? new Date();
  const maxAgeDays = options.maxAgeDays ?? 7;
  const fetchImpl = options.fetchImpl ?? fetch;
  const logger = options.logger ?? console;
  const sleep = options.sleep ?? wait;
  const newsSearchState = options.newsSearchState ?? createNewsSearchState();

  const rawBase = await discoverHighRecallSources({
    ...options,
    now,
    maxAgeDays,
    fetchImpl,
    logger,
    sleep,
    newsSearchState,
  });
  const diagnostics = rawBase.diagnostics ?? {};
  const base = rawBase.map(sanitizeDirectCandidate);

  diagnostics.supplemental_search_candidates ??= 0;
  diagnostics.supplemental_search_by_lane ??= {};
  diagnostics.supplemental_google_candidates ??= 0;
  diagnostics.supplemental_google_failures ??= 0;
  diagnostics.supplemental_google_circuit_opened ??= 0;

  const seen = new Set(base.map((item) => normalizeUrl(item.url)).filter(Boolean));

  for (const [index, feed] of SUPPLEMENTAL_FEEDS.entries()) {
    if (index > 0) await sleep(2_300);
    const beforeGoogleFailures = diagnostics.google_transient_failures ?? 0;
    const items = await fetchNewsSearchLane({
      lane: feed,
      fetchImpl,
      sleep,
      diagnostics,
      state: newsSearchState,
      logger,
      limit: 24,
    });

    let added = 0;
    for (const item of items) {
      if (!item?.url || !recentEnough(item, now, maxAgeDays)) continue;
      const key = normalizeUrl(item.url);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      base.push({
        ...item,
        sourceId: "google_news",
        sourceName: item.source || "News search discovery",
        sourceCategory: feed.sourceCategory,
        discoveryMethod: item.searchProvider === "bing"
          ? `google_news_bing_${feed.id}`
          : `google_news_${feed.id}`,
        sectorQuery: feed.query,
        discoveryLane: feed.id,
      });
      added += 1;
    }

    diagnostics.supplemental_search_candidates += added;
    diagnostics.supplemental_search_by_lane[feed.id] = added;
    if (items.some((item) => item.searchProvider === "google")) {
      diagnostics.supplemental_google_candidates += added;
    }
    if ((diagnostics.google_transient_failures ?? 0) > beforeGoogleFailures) {
      diagnostics.supplemental_google_failures += 1;
    }
  }

  diagnostics.supplemental_google_circuit_opened = diagnostics.google_circuit_opened ?? 0;
  diagnostics.candidates_discovered = base.length;
  Object.defineProperty(base, "diagnostics", { value: diagnostics, enumerable: false });
  return base;
}
