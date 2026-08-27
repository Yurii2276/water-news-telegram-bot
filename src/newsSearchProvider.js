import { parseNewsFeed } from "./news.js";

const GOOGLE_TRANSIENT = new Set([429, 502, 503, 504]);
const NETWORK_TRANSIENT = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH"]);
const USER_AGENT = "Mozilla/5.0 (compatible; WaterNewsEditor/1.1; +https://github.com/Yurii2276/water-news-telegram-bot)";

export function createNewsSearchState() {
  return {
    googleDisabled: false,
    googleTransientStreak: 0,
  };
}

function ensureDiagnostics(diagnostics) {
  diagnostics.google_queries_executed ??= 0;
  diagnostics.bing_fallback_queries ??= 0;
  diagnostics.news_search_fallback_successes ??= 0;
  diagnostics.news_search_failures ??= 0;
  diagnostics.google_rate_limited ??= 0;
  diagnostics.google_transient_failures ??= 0;
  diagnostics.google_circuit_opened ??= 0;
  diagnostics.transient_retries ??= 0;
  diagnostics.transient_failures ??= 0;
  diagnostics.source_fetch_failures ??= 0;
}

function googleNewsUrl({ query, hl = "uk", gl = "UA", ceid = "UA:uk" }) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", hl);
  url.searchParams.set("gl", gl);
  url.searchParams.set("ceid", ceid);
  return url.toString();
}

function queryWithoutGoogleRecency(query) {
  return String(query ?? "")
    .replace(/\s+when:\d+d\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bingNewsUrl({ query, hl = "uk", gl = "UA" }) {
  const url = new URL("https://www.bing.com/news/search");
  url.searchParams.set("q", queryWithoutGoogleRecency(query));
  url.searchParams.set("qft", 'sortbydate="1"');
  url.searchParams.set("format", "RSS");
  if (hl) url.searchParams.set("setlang", hl);
  if (gl) url.searchParams.set("cc", gl);
  return url.toString();
}

function isTransientNetworkError(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return true;
  const code = error?.code ?? error?.cause?.code;
  return NETWORK_TRANSIENT.has(code);
}

function unwrapBingUrl(value) {
  if (!value) return value;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "bing.com" && /\/news\/apiclick\.aspx$/i.test(url.pathname)) {
      const target = url.searchParams.get("url");
      if (target) {
        const parsed = new URL(target);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
      }
    }
  } catch {
    return value;
  }
  return value;
}

function normalizeProviderItems(items, provider) {
  if (provider !== "bing") return items;
  return items.map((item) => {
    const url = unwrapBingUrl(item.url ?? item.link);
    return {
      ...item,
      url,
      link: url,
      searchProvider: "bing",
    };
  });
}

async function requestFeed(url, { fetchImpl, timeoutMs = 16_000 } = {}) {
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/rss+xml,application/atom+xml,application/xml,text/xml",
      "accept-language": "uk-UA,uk;q=0.9,en;q=0.8",
      "user-agent": USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return response;
}

async function fetchGoogle({ lane, fetchImpl, sleep, diagnostics, state, logger, limit }) {
  if (state.googleDisabled) return null;
  const url = googleNewsUrl(lane);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    diagnostics.google_queries_executed += 1;
    try {
      const response = await requestFeed(url, { fetchImpl });
      if (response.ok) {
        state.googleTransientStreak = 0;
        return normalizeProviderItems(parseNewsFeed(await response.text(), limit), "google");
      }

      if (!GOOGLE_TRANSIENT.has(response.status)) {
        diagnostics.news_search_failures += 1;
        diagnostics.source_fetch_failures += 1;
        logger.warn?.(`Google News search failed permanently for lane ${lane.id ?? "base"}: HTTP ${response.status}`);
        return null;
      }

      diagnostics.google_transient_failures += 1;
      diagnostics.transient_failures += 1;
      diagnostics.source_fetch_failures += 1;
      state.googleTransientStreak += 1;
      if (response.status === 429) diagnostics.google_rate_limited += 1;

      if (attempt === 1 && response.status !== 429) {
        diagnostics.transient_retries += 1;
        await sleep(4_000);
        continue;
      }

      state.googleDisabled = true;
      diagnostics.google_circuit_opened = 1;
      logger.warn?.(`Google News temporarily unavailable for this scan after HTTP ${response.status}; switching remaining lanes to Bing RSS fallback`);
      return null;
    } catch (error) {
      if (!isTransientNetworkError(error)) {
        diagnostics.news_search_failures += 1;
        diagnostics.source_fetch_failures += 1;
        logger.warn?.(`Google News search failed for lane ${lane.id ?? "base"}: ${error.message}`);
        return null;
      }

      diagnostics.google_transient_failures += 1;
      diagnostics.transient_failures += 1;
      diagnostics.source_fetch_failures += 1;
      state.googleTransientStreak += 1;
      if (attempt === 1) {
        diagnostics.transient_retries += 1;
        await sleep(4_000);
        continue;
      }
      state.googleDisabled = true;
      diagnostics.google_circuit_opened = 1;
      logger.warn?.(`Google News network access failed twice; switching remaining lanes to Bing RSS fallback: ${error.message}`);
      return null;
    }
  }

  return null;
}

async function fetchBing({ lane, fetchImpl, diagnostics, logger, limit }) {
  diagnostics.bing_fallback_queries += 1;
  const url = bingNewsUrl(lane);
  try {
    const response = await requestFeed(url, { fetchImpl, timeoutMs: 18_000 });
    if (!response.ok) {
      diagnostics.news_search_failures += 1;
      diagnostics.source_fetch_failures += 1;
      logger.warn?.(`Bing News RSS fallback failed for lane ${lane.id ?? "base"}: HTTP ${response.status}`);
      return [];
    }
    diagnostics.news_search_fallback_successes += 1;
    return normalizeProviderItems(parseNewsFeed(await response.text(), limit), "bing");
  } catch (error) {
    diagnostics.news_search_failures += 1;
    diagnostics.source_fetch_failures += 1;
    if (isTransientNetworkError(error)) diagnostics.transient_failures += 1;
    logger.warn?.(`Bing News RSS fallback failed for lane ${lane.id ?? "base"}: ${error.message}`);
    return [];
  }
}

export async function fetchNewsSearchLane({
  lane,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  diagnostics = {},
  state = createNewsSearchState(),
  logger = console,
  limit = 24,
} = {}) {
  ensureDiagnostics(diagnostics);

  const googleItems = await fetchGoogle({
    lane,
    fetchImpl,
    sleep,
    diagnostics,
    state,
    logger,
    limit,
  });
  if (googleItems) {
    return googleItems.map((item) => ({ ...item, searchProvider: "google" }));
  }

  return fetchBing({ lane, fetchImpl, diagnostics, logger, limit });
}
