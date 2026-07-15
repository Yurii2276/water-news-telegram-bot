import * as cheerio from "cheerio";
import { parseNewsFeed } from "./news.js";
import { OFFICIAL_SOURCES, sourceForUrl } from "./sources.js";
import { preliminaryFilter } from "./topics.js";
import { isGoogleNewsUrl, resolveGoogleNewsUrl } from "./urlResolver.js";

const USER_AGENT = "Mozilla/5.0 (compatible; WaterNewsEditor/0.3; +https://github.com/Yurii2276/water-news-telegram-bot)";
const TARGETED_GOOGLE_NEWS_QUERIES = [
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

async function fetchText(url, fetchImpl, timeout = 15_000) {
  const response = await fetchImpl(url, {
    headers: { accept: "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml", "user-agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return { text: await response.text(), finalUrl: response.url || url };
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

export async function discoverAllSources({ googleNewsRssUrl, limit = 20, fetchImpl = fetch, logger = console }) {
  const candidates = [];
  for (const source of OFFICIAL_SOURCES) {
    try {
      if (source.feedUrl) {
        const { text } = await fetchText(source.feedUrl, fetchImpl);
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
        const { text } = await fetchText(source.sitemapUrl, fetchImpl);
        candidates.push(...discoverSitemapLinks(text, source, limit));
      } else {
        const { text } = await fetchText(source.listingUrl, fetchImpl);
        candidates.push(...discoverOfficialLinks(text, source, limit));
      }
    } catch (error) {
      logger.error(`Source discovery failed: ${source.id}`, error);
    }
  }
  try {
    const { text } = await fetchText(googleNewsRssUrl, fetchImpl);
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
    logger.error("Google News discovery failed", error);
  }
  const base = new URL(googleNewsRssUrl);
  for (const query of TARGETED_GOOGLE_NEWS_QUERIES) {
    try {
      const url = new URL(base);
      url.searchParams.set("q", query);
      const { text } = await fetchText(url.toString(), fetchImpl);
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
      logger.error(`Google News targeted discovery failed: ${query}`, error);
    }
  }
  return candidates;
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
