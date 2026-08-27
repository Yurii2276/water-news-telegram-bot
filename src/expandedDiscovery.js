import { normalizeUrl } from "./dedup.js";
import { discoverHighRecallSources } from "./highRecallDiscovery.js";
import { parseNewsFeed } from "./news.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const USER_AGENT = "Mozilla/5.0 (compatible; WaterNewsEditor/1.0; +https://github.com/Yurii2276/water-news-telegram-bot)";
const GOOGLE_TRANSIENT = new Set([429, 502, 503, 504]);

// Supplemental lanes are intentionally narrower than the four base queries.
// Together they cover the editorial scope without returning to the old 20+
// request burst that caused Google News 503 responses.
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

function googleNewsUrl(feed) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", feed.query);
  url.searchParams.set("hl", feed.hl);
  url.searchParams.set("gl", feed.gl);
  url.searchParams.set("ceid", feed.ceid);
  return url.toString();
}

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
  // That polluted a valid water-resources headline with unrelated obituary/DSNS
  // text and made isNoiseOnly() reject the whole candidate before extraction.
  // Keep the headline and let the article extractor fetch its own page instead.
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
  const rawBase = await discoverHighRecallSources(options);
  const diagnostics = rawBase.diagnostics ?? {};
  const base = rawBase.map(sanitizeDirectCandidate);

  diagnostics.supplemental_google_candidates = diagnostics.supplemental_google_candidates ?? 0;
  diagnostics.supplemental_google_failures = diagnostics.supplemental_google_failures ?? 0;
  diagnostics.supplemental_google_by_lane = diagnostics.supplemental_google_by_lane ?? {};
  diagnostics.supplemental_google_circuit_opened = diagnostics.supplemental_google_circuit_opened ?? 0;

  const seen = new Set(base.map((item) => normalizeUrl(item.url)).filter(Boolean));

  for (const [index, feed] of SUPPLEMENTAL_FEEDS.entries()) {
    if (diagnostics.supplemental_google_circuit_opened) break;
    if (index > 0) await wait(2300);
    diagnostics.google_queries_executed = (diagnostics.google_queries_executed ?? 0) + 1;
    try {
      const url = googleNewsUrl(feed);
      const response = await fetchImpl(url, {
        headers: {
          accept: "application/rss+xml,application/atom+xml,application/xml,text/xml",
          "user-agent": USER_AGENT,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        if (GOOGLE_TRANSIENT.has(response.status)) {
          diagnostics.supplemental_google_failures += 1;
          diagnostics.source_fetch_failures = (diagnostics.source_fetch_failures ?? 0) + 1;
          diagnostics.transient_failures = (diagnostics.transient_failures ?? 0) + 1;
          diagnostics.supplemental_google_circuit_opened = 1;
          logger.warn?.(`Supplemental Google News circuit opened after HTTP ${response.status}`);
          break;
        }
        throw new Error(`Supplemental Google News returned HTTP ${response.status}`);
      }

      const items = parseNewsFeed(await response.text(), 24);
      let added = 0;
      for (const item of items) {
        if (!item?.url || !recentEnough(item, now, maxAgeDays)) continue;
        const key = normalizeUrl(item.url);
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        base.push({
          ...item,
          sourceId: "google_news",
          sourceName: item.source || "Google News discovery",
          sourceCategory: feed.sourceCategory,
          discoveryMethod: `google_news_${feed.id}`,
          sectorQuery: feed.query,
          discoveryLane: feed.id,
        });
        added += 1;
      }
      diagnostics.supplemental_google_candidates += added;
      diagnostics.supplemental_google_by_lane[feed.id] = added;
    } catch (error) {
      diagnostics.supplemental_google_failures += 1;
      diagnostics.source_fetch_failures = (diagnostics.source_fetch_failures ?? 0) + 1;
      logger.warn?.(`Supplemental discovery failed for ${feed.id}: ${error.message}`);
    }
  }

  diagnostics.candidates_discovered = base.length;
  Object.defineProperty(base, "diagnostics", { value: diagnostics, enumerable: false });
  return base;
}
