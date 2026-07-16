import * as cheerio from "cheerio";
import { parseNewsFeed } from "./news.js";
import { OFFICIAL_SOURCES, sourceForUrl } from "./sources.js";
import { preliminaryFilter } from "./topics.js";
import { isGoogleNewsUrl, resolveGoogleNewsUrl } from "./urlResolver.js";

const USER_AGENT = "Mozilla/5.0 (compatible; WaterNewsEditor/0.3; +https://github.com/Yurii2276/water-news-telegram-bot)";
export const OFFICIAL_GOOGLE_NEWS_QUERIES = [
  "site:nerc.gov.ua водопостачання OR водовідведення OR тариф",
  "site:kmu.gov.ua водопостачання OR питна вода",
  "site:rada.gov.ua водопостачання OR водовідведення",
  "site:komekolog.rada.gov.ua питна вода OR водні ресурси",
  "НКРЕКП тариф водопостачання водовідведення",
  "законопроєкт питна вода водопостачання",
  "site:mindev.gov.ua водопостачання OR водна інфраструктура",
  "site:davr.gov.ua водні ресурси OR водопостачання",
];

export const TECHNOLOGY_GOOGLE_NEWS_QUERIES = [
  "water supply technology Ukraine",
  "wastewater treatment technology Ukraine",
  "smart water meters Ukraine",
  "leak detection water networks Ukraine",
  "non-revenue water Ukraine",
  "digital water utility Ukraine",
  "wastewater reuse Ukraine",
  "desalination technology water utility",
  "sludge treatment wastewater",
  "energy efficiency in water utilities Ukraine",
  "smart water infrastructure Ukraine",
  "AI in water utilities",
  "water infrastructure resilience",
  "digital water utility",
  "smart water",
  "wastewater treatment technology",
  "leak detection water networks",
];

const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const TRANSIENT_ERROR_CODES = new Set(["ECONNRESET", "ETIMEDOUT"]);
const RETRY_DELAYS_MS = [0, 2_000, 5_000];

function utcDayIndex(now = new Date()) {
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86_400_000);
}

export function selectRotatingQueries(queries, count, now = new Date()) {
  if (!Array.isArray(queries) || queries.length === 0 || count <= 0) return [];
  const selected = [];
  const start = utcDayIndex(now) % queries.length;
  for (let index = 0; index < Math.min(count, queries.length); index += 1) {
    selected.push(queries[(start + index) % queries.length]);
  }
  return selected;
}

function selectedTargetedQueries(now = new Date()) {
  return [
    ...selectRotatingQueries(OFFICIAL_GOOGLE_NEWS_QUERIES, 2, now),
    ...selectRotatingQueries(TECHNOLOGY_GOOGLE_NEWS_QUERIES, 2, now),
  ];
}

function retryAfterMs(response) {
  const value = response.headers?.get?.("retry-after");
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
}

function isTransientFetchError(error) {
  return error?.name === "TimeoutError" ||
    error?.code && TRANSIENT_ERROR_CODES.has(error.code) ||
    TRANSIENT_ERROR_CODES.has(error?.cause?.code);
}

function createFetchError(url, response) {
  const error = new Error(`${url} returned HTTP ${response.status}`);
  error.status = response.status;
  return error;
}

const sleepDefault = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchText(url, fetchImpl, timeout = 15_000, {
  logger = console,
  diagnostics = { transient_retries: 0 },
  sleep = sleepDefault,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { accept: "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml", "user-agent": USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
      });
      if (response.ok) return { text: await response.text(), finalUrl: response.url || url };
      if (!TRANSIENT_HTTP_STATUSES.has(response.status) || attempt === 3) {
        throw createFetchError(url, response);
      }
      const delayMs = retryAfterMs(response) ?? RETRY_DELAYS_MS[attempt];
      diagnostics.transient_retries += 1;
      logger.warn?.(`Retrying transient source fetch (${attempt + 1}/3): HTTP ${response.status} ${url}`);
      await sleep(delayMs);
    } catch (error) {
      lastError = error;
      if (!isTransientFetchError(error) || attempt === 3) throw error;
      const delayMs = RETRY_DELAYS_MS[attempt];
      diagnostics.transient_retries += 1;
      logger.warn?.(`Retrying transient source fetch (${attempt + 1}/3): ${error.code ?? error.name ?? "fetch error"} ${url}`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

function feedCandidate(item, metadata, logger) {
  const candidate = {
    ...item,
    url: item.url ?? item.link,
    ...metadata,
    sourceName: item.source || metadata.sourceName,
  };
  if (!candidate.url) {
    logger.warn?.(`Source item has no URL: ${candidate.sourceName} — ${candidate.title || "(без заголовка)"}`);
  }
  return candidate;
}

async function resolveGoogleCandidate(candidate, fetchImpl, logger) {
  if (!isGoogleNewsUrl(candidate.url)) return candidate;
  const result = await resolveGoogleNewsUrl(candidate.url, { fetchImpl, logger });
  return {
    ...candidate,
    originalUrl: candidate.url,
    url: result.url,
    googleNewsUrlResolved: result.resolved,
    googleNewsUrlUnresolved: result.failed,
  };
}

async function feedCandidates(items, metadata, logger, fetchImpl, { resolveGoogleUrls = false } = {}) {
  const candidates = items.map((item) => feedCandidate(item, metadata, logger));
  if (!resolveGoogleUrls) return candidates;
  const resolved = [];
  for (const candidate of candidates) {
    resolved.push(await resolveGoogleCandidate(candidate, fetchImpl, logger));
  }
  return resolved;
}

export function discoverOfficialLinks(html, source, limit = 30) {
  const $ = cheerio.load(html);
  const candidates = [];
  const seen = new Set();
  $("a[href]").each((_, element) => {
    const title = $(element).text().replace(/\s+/g, " ").trim();
    if (title.length < 20) return;
    let url;
    try {
      url = new URL($(element).attr("href"), source.listingUrl).toString();
    } catch {
      return;
    }
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const allowed = source.hosts.some((value) => host === value || host.endsWith(`.${value}`));
    if (!allowed || seen.has(url)) return;
    if (source.articlePathPattern && !source.articlePathPattern.test(new URL(url).pathname)) return;
    if (!preliminaryFilter({ title }).relevant) return;
    seen.add(url);
    candidates.push({ title, url, sourceId: source.id, sourceName: source.name, sourceCategory: source.category, discoveryMethod: "official" });
  });
  return candidates.slice(0, limit);
}

export function discoverSitemapLinks(xml, source, limit = 30) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];
  $("url").each((_, element) => {
    const url = $(element).find("loc").first().text().trim();
    if (!url) return;
    let pathname;
    try { pathname = new URL(url).pathname; } catch { return; }
    if (source.articlePathPattern && !source.articlePathPattern.test(pathname)) return;
    const title = decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? "").replaceAll("-", " ").trim();
    if (!preliminaryFilter({ title }).relevant) return;
    items.push({
      title,
      url,
      sourceId: source.id,
      sourceName: source.name,
      sourceCategory: source.category,
      discoveryMethod: "official_sitemap",
      publishedAt: $(element).find("lastmod").first().text().trim() || null,
    });
  });
  return items.reverse().slice(0, limit);
}

function attachDiagnostics(candidates, diagnostics) {
  Object.defineProperty(candidates, "diagnostics", {
    value: diagnostics,
    enumerable: false,
  });
  return candidates;
}

export async function discoverAllSources({ googleNewsRssUrl, limit = 20, fetchImpl = fetch, logger = console, now = new Date(), sleep = sleepDefault } = {}) {
  const candidates = [];
  const diagnostics = {
    source_fetch_failures: 0,
    transient_retries: 0,
    google_queries_executed: 0,
  };
  const fetchOptions = { logger, diagnostics, sleep };
  for (const source of OFFICIAL_SOURCES) {
    try {
      if (source.feedUrl) {
        const { text } = await fetchText(source.feedUrl, fetchImpl, 15_000, fetchOptions);
        const items = await feedCandidates(
          parseNewsFeed(text, limit).filter((item) => preliminaryFilter(item).relevant),
          {
            sourceId: source.id,
            sourceName: source.name,
            sourceCategory: source.category,
            discoveryMethod: "official_rss",
          },
          logger,
          fetchImpl,
        );
        candidates.push(...items);
      } else if (source.sitemapUrl) {
        const { text } = await fetchText(source.sitemapUrl, fetchImpl, 15_000, fetchOptions);
        candidates.push(...discoverSitemapLinks(text, source, limit));
      } else {
        const { text } = await fetchText(source.listingUrl, fetchImpl, 15_000, fetchOptions);
        candidates.push(...discoverOfficialLinks(text, source, limit));
      }
    } catch (error) {
      diagnostics.source_fetch_failures += 1;
      logger.error(`Source discovery failed: ${source.id}`, error);
    }
  }
  try {
    diagnostics.google_queries_executed += 1;
    const { text } = await fetchText(googleNewsRssUrl, fetchImpl, 15_000, fetchOptions);
    candidates.push(...await feedCandidates(
      parseNewsFeed(text, limit),
      {
        sourceId: "google_news",
        sourceName: "Google News discovery",
        sourceCategory: "general_news",
        discoveryMethod: "google_news",
      },
      logger,
      fetchImpl,
      { resolveGoogleUrls: true },
    ));
  } catch (error) {
    diagnostics.source_fetch_failures += 1;
    logger.error("Google News discovery failed", error);
  }
  const base = new URL(googleNewsRssUrl);
  for (const query of selectedTargetedQueries(now)) {
    try {
      const url = new URL(base);
      url.searchParams.set("q", query);
      diagnostics.google_queries_executed += 1;
      const { text } = await fetchText(url.toString(), fetchImpl, 15_000, fetchOptions);
      candidates.push(...await feedCandidates(
        parseNewsFeed(text, Math.max(3, Math.ceil(limit / 4))),
        {
          sourceId: "google_news",
          sourceName: "Google News targeted discovery",
          sourceCategory: "international_tech",
          discoveryMethod: "google_news_targeted",
        },
        logger,
        fetchImpl,
        { resolveGoogleUrls: true },
      ));
    } catch (error) {
      diagnostics.source_fetch_failures += 1;
      logger.error(`Google News targeted discovery failed: ${query}`, error);
    }
  }
  return attachDiagnostics(candidates, diagnostics);
}

export async function extractArticle(candidate, { fetchImpl = fetch } = {}) {
  if (isGoogleNewsUrl(candidate.url)) {
    const resolved = await resolveGoogleNewsUrl(candidate.url, { fetchImpl });
    candidate = {
      ...candidate,
      originalUrl: candidate.originalUrl ?? candidate.url,
      url: resolved.url,
      googleNewsUrlResolved: resolved.resolved,
      googleNewsUrlUnresolved: resolved.failed,
    };
  }
  const { text: html, finalUrl } = await fetchText(candidate.url, fetchImpl);
  const source = sourceForUrl(finalUrl);
  if (candidate.discoveryMethod === "google_news" && !source) {
    return { ...candidate, url: finalUrl, content: "", extractionStatus: "unresolved_primary_source" };
  }
  const $ = cheerio.load(html);
  $("script,style,noscript,nav,footer,header,aside,form").remove();
  const root = $("article").first().length ? $("article").first() : $("main").first().length ? $("main").first() : $("body");
  const content = root.text().replace(/\s+/g, " ").trim().slice(0, 20_000);
  const title = $("h1").first().text().replace(/\s+/g, " ").trim() || candidate.title;
  return {
    ...candidate,
    title,
    url: finalUrl,
    sourceId: source?.id ?? candidate.sourceId,
    sourceName: source?.name ?? candidate.sourceName,
    sourceCategory: source?.category ?? candidate.sourceCategory,
    sourceTrusted: Boolean(source),
    content,
    extractionStatus: content.length >= 300 ? "ok" : "insufficient_content",
  };
}
