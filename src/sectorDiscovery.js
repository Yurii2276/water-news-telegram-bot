import { parseNewsFeed } from "./news.js";

const USER_AGENT = "Mozilla/5.0 (compatible; WaterNewsEditor/0.4; +https://github.com/Yurii2276/water-news-telegram-bot)";

export const UKRAINE_WATER_SECTOR_QUERIES = [
  "водоканал водопостачання Україна",
  "водовідведення каналізація очисні споруди Україна",
  "аварія водогін відключення води Україна",
  "реконструкція водопроводу водогону Україна",
  "тариф водопостачання водовідведення Україна",
  "питна вода якість води громада Україна",
  "водна інфраструктура відновлення Україна",
  "втрати води енергоефективність водоканал Україна",
];

function googleNewsUrl(query) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", `(${query}) when:3d`);
  url.searchParams.set("hl", "uk");
  url.searchParams.set("gl", "UA");
  url.searchParams.set("ceid", "UA:uk");
  return url.toString();
}

export async function discoverUkraineWaterSector({
  fetchImpl = fetch,
  logger = console,
  limitPerQuery = 8,
} = {}) {
  const candidates = [];
  const diagnostics = {
    google_queries_executed: 0,
    source_fetch_failures: 0,
    candidates_discovered: 0,
  };

  for (const query of UKRAINE_WATER_SECTOR_QUERIES) {
    try {
      diagnostics.google_queries_executed += 1;
      const response = await fetchImpl(googleNewsUrl(query), {
        headers: {
          accept: "application/rss+xml,application/atom+xml,application/xml,text/xml",
          "user-agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Google News sector query returned HTTP ${response.status}`);
      const items = parseNewsFeed(await response.text(), limitPerQuery);
      for (const item of items) {
        candidates.push({
          ...item,
          url: item.url ?? item.link,
          sourceId: "google_news",
          sourceName: item.source || "Google News water-sector discovery",
          sourceCategory: "general_news",
          discoveryMethod: "google_news",
          sectorQuery: query,
        });
      }
    } catch (error) {
      diagnostics.source_fetch_failures += 1;
      logger.error?.(`Ukraine water-sector query failed: ${query}`, error);
    }
  }

  diagnostics.candidates_discovered = candidates.length;
  Object.defineProperty(candidates, "diagnostics", {
    value: diagnostics,
    enumerable: false,
  });
  return candidates;
}
