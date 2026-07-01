import * as cheerio from "cheerio";

import { parseNewsFeed } from "./news.js";
import { OFFICIAL_SOURCES, sourceForUrl } from "./sources.js";
import { preliminaryFilter } from "./topics.js";

const USER_AGENT =
  "Mozilla/5.0 (compatible; WaterNewsEditor/0.2; +https://github.com/Yurii2276/water-news-telegram-bot)";

async function fetchText(url, fetchImpl, timeout = 15_000) {
  const response = await fetchImpl(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/rss+xml",
      "user-agent": USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return { text: await response.text(), finalUrl: response.url || url };
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
    const allowedHost = source.hosts.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
    if (!allowedHost || seen.has(url)) return;
    if (
      source.articlePathPattern &&
      !source.articlePathPattern.test(new URL(url).pathname)
    ) {
      return;
    }
    if (!preliminaryFilter({ title }).relevant) return;

    seen.add(url);
    candidates.push({
      title,
      url,
      sourceId: source.id,
      sourceName: source.name,
      discoveryMethod: "official",
    });
  });

  return candidates.slice(0, limit);
}

export function discoverSitemapLinks(xml, source, limit = 30) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];

  $("url").each((_, element) => {
    const url = $(element).find("loc").first().text().trim();
    if (!url) return;
    const pathname = new URL(url).pathname;
    if (source.articlePathPattern && !source.articlePathPattern.test(pathname)) {
      return;
    }
    const title = decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? "")
      .replaceAll("-", " ")
      .trim();
    const filter = preliminaryFilter({ title });
    if (!filter.relevant) return;
    items.push({
      title,
      url,
      sourceId: source.id,
      sourceName: source.name,
      discoveryMethod: "official_sitemap",
      publishedAt: $(element).find("lastmod").first().text().trim() || null,
    });
  });

  return items.reverse().slice(0, limit);
}

export async function discoverAllSources({
  googleNewsRssUrl,
  limit = 20,
  fetchImpl = fetch,
  logger = console,
}) {
  const candidates = [];

  for (const source of OFFICIAL_SOURCES) {
    try {
      if (source.feedUrl) {
        const { text } = await fetchText(source.feedUrl, fetchImpl);
        candidates.push(
          ...parseNewsFeed(text, limit)
            .filter((item) => preliminaryFilter(item).relevant)
            .map((item) => ({
              ...item,
              sourceId: source.id,
              sourceName: source.name,
              discoveryMethod: "official_rss",
            })),
        );
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
    candidates.push(
      ...parseNewsFeed(text, limit).map((item) => ({
        ...item,
        sourceId: "google_news",
        sourceName: item.source || "Google News discovery",
        discoveryMethod: "google_news",
      })),
    );
  } catch (error) {
    logger.error("Google News discovery failed", error);
  }

  return candidates;
}

export async function extractArticle(candidate, { fetchImpl = fetch } = {}) {
  const { text: html, finalUrl } = await fetchText(candidate.url, fetchImpl);
  const source = sourceForUrl(finalUrl);

  if (candidate.discoveryMethod === "google_news" && !source) {
    return {
      ...candidate,
      url: finalUrl,
      content: "",
      extractionStatus: "unresolved_primary_source",
    };
  }

  const $ = cheerio.load(html);
  $("script,style,noscript,nav,footer,header,aside,form").remove();
  const root = $("article").first().length
    ? $("article").first()
    : $("main").first().length
      ? $("main").first()
      : $("body");
  const content = root.text().replace(/\s+/g, " ").trim().slice(0, 20_000);
  const title =
    $("h1").first().text().replace(/\s+/g, " ").trim() || candidate.title;

  return {
    ...candidate,
    title,
    url: finalUrl,
    sourceId: source?.id ?? candidate.sourceId,
    sourceName: source?.name ?? candidate.sourceName,
    sourceTrusted: Boolean(source),
    content,
    extractionStatus: content.length >= 300 ? "ok" : "insufficient_content",
  };
}
