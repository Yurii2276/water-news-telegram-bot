import { parseNewsFeed } from "./news.js";

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const USER_AGENT = "Mozilla/5.0 (compatible; WaterNewsEditor/1.1; +https://github.com/Yurii2276/water-news-telegram-bot)";

function sleepDefault(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripGoogleRecency(query) {
  return String(query ?? "")
    .replace(/\s+when:\d+d\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function bingNewsUrl(query, { locale = "uk-UA", country = "UA" } = {}) {
  const url = new URL("https://www.bing.com/news/search");
  url.searchParams.set("q", stripGoogleRecency(query));
  url.searchParams.set("format", "RSS");
  url.searchParams.set("qft", 'sortbydate="1"');
  url.searchParams.set("setlang", locale);
  url.searchParams.set("cc", country);
  return url.toString();
}

async function fetchRss(url, {
  fetchImpl,
  sleep,
  maxAttempts,
  timeoutMs,
  diagnostics,
  backend,
}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          accept: "application/rss+xml,application/atom+xml,application/xml,text/xml",
          "accept-language": backend === "bing" ? "uk-UA,uk;q=0.9,en;q=0.8" : "uk-UA,uk;q=0.9,en;q=0.8",
          "user-agent": USER_AGENT,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return await response.text();
      const error = new Error(`${backend} news returned HTTP ${response.status}`);
      error.status = response.status;
      if (!TRANSIENT_STATUS.has(response.status) || attempt === maxAttempts) throw error;
      diagnostics.transient_retries = (diagnostics.transient_retries ?? 0) + 1;
      await sleep(attempt * 2_000);
    } catch (error) {
      lastError = error;
      const transientNetwork = error?.name === "TimeoutError" ||
        ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(error?.code ?? error?.cause?.code);
      if ((!transientNetwork && !TRANSIENT_STATUS.has(error?.status)) || attempt === maxAttempts) throw error;
      diagnostics.transient_retries = (diagnostics.transient_retries ?? 0) + 1;
      await sleep(attempt * 2_000);
    }
  }
  throw lastError;
}

export async function fetchNewsSearchItems({
  query,
  googleUrl,
  locale = "uk-UA",
  country = "UA",
  limit = 24,
  fetchImpl = fetch,
  sleep = sleepDefault,
  diagnostics = {},
  logger = console,
  preferGoogle = true,
} = {}) {
  if (preferGoogle && googleUrl) {
    diagnostics.google_queries_executed = (diagnostics.google_queries_executed ?? 0) + 1;
    try {
      const xml = await fetchRss(googleUrl, {
        fetchImpl,
        sleep,
        maxAttempts: 2,
        timeoutMs: 15_000,
        diagnostics,
        backend: "google",
      });
      return { items: parseNewsFeed(xml, limit), backend: "google" };
    } catch (error) {
      diagnostics.google_degraded_mode = 1;
      diagnostics.google_failures = (diagnostics.google_failures ?? 0) + 1;
      diagnostics.transient_failures = (diagnostics.transient_failures ?? 0) + 1;
      logger.warn?.(`Google News unavailable for lane; switching to Bing RSS: ${error.message}`);
    }
  }

  diagnostics.bing_queries_executed = (diagnostics.bing_queries_executed ?? 0) + 1;
  try {
    const xml = await fetchRss(bingNewsUrl(query, { locale, country }), {
      fetchImpl,
      sleep,
      maxAttempts: 2,
      timeoutMs: 18_000,
      diagnostics,
      backend: "bing",
    });
    diagnostics.bing_fallback_successes = (diagnostics.bing_fallback_successes ?? 0) + 1;
    return { items: parseNewsFeed(xml, limit), backend: "bing" };
  } catch (error) {
    diagnostics.bing_failures = (diagnostics.bing_failures ?? 0) + 1;
    diagnostics.source_fetch_failures = (diagnostics.source_fetch_failures ?? 0) + 1;
    diagnostics.transient_failures = (diagnostics.transient_failures ?? 0) + 1;
    logger.warn?.(`Bing News fallback failed: ${error.message}`);
    return { items: [], backend: "failed", error };
  }
}
