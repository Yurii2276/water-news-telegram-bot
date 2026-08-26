import * as cheerio from "cheerio";

import { sourceForUrl } from "./sources.js";
import { isGoogleNewsUrl, resolveGoogleNewsUrl } from "./urlResolver.js";

const USER_AGENT = "Mozilla/5.0 (compatible; WaterNewsEditor/0.7; +https://github.com/Yurii2276/water-news-telegram-bot)";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function snippetFallback(candidate, overrides = {}) {
  const content = clean(candidate.summary ?? candidate.snippet ?? "");
  return {
    ...candidate,
    ...overrides,
    content,
    contextBasis: content ? "rss_snippet" : "title_only",
    extractionStatus: content.length >= 180 ? "ok" : "insufficient_content",
  };
}

function publishedAtFromHtml($) {
  return clean(
    $('meta[property="article:published_time"]').attr("content") ||
    $('meta[name="date"]').attr("content") ||
    $("time[datetime]").first().attr("datetime") ||
    "",
  ) || null;
}

export async function extractHighRecallArticle(candidate, {
  fetchImpl = fetch,
  logger = console,
} = {}) {
  let working = { ...candidate };

  if (isGoogleNewsUrl(working.url)) {
    const resolved = await resolveGoogleNewsUrl(working.url, { fetchImpl, logger, timeoutMs: 12_000 });
    working = {
      ...working,
      originalUrl: working.originalUrl ?? working.url,
      url: resolved.url,
      googleNewsUrlResolved: resolved.resolved,
      googleNewsUrlUnresolved: resolved.failed,
    };
    if (!resolved.resolved && isGoogleNewsUrl(working.url)) {
      return {
        ...snippetFallback(working),
        extractionStatus: "unresolved_primary_source",
      };
    }
  }

  try {
    const response = await fetchImpl(working.url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "uk-UA,uk;q=0.9,en;q=0.8",
        "user-agent": USER_AGENT,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    const finalUrl = response.url || working.url;
    if (!response.ok) {
      logger.warn?.(`Article fetch returned HTTP ${response.status}; trying RSS/snippet fallback: ${finalUrl}`);
      return snippetFallback(working, { url: finalUrl });
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    $("script,style,noscript,nav,footer,header,aside,form,svg").remove();
    const root = $("article").first().length
      ? $("article").first()
      : $("main").first().length
        ? $("main").first()
        : $("body");
    const content = clean(root.text()).slice(0, 24_000);
    const title = clean($("h1").first().text()) || working.title;
    const source = sourceForUrl(finalUrl);
    const publishedAt = working.publishedAt ?? working.published_at ?? publishedAtFromHtml($);

    if (content.length < 220) {
      return snippetFallback(working, {
        title,
        url: finalUrl,
        publishedAt,
        sourceId: source?.id ?? working.sourceId,
        sourceName: source?.name ?? working.sourceName,
        sourceCategory: source?.category ?? working.sourceCategory,
        sourceTrusted: Boolean(source),
      });
    }

    return {
      ...working,
      title,
      url: finalUrl,
      publishedAt,
      sourceId: source?.id ?? working.sourceId,
      sourceName: source?.name ?? working.sourceName,
      sourceCategory: source?.category ?? working.sourceCategory,
      sourceTrusted: Boolean(source),
      content,
      contextBasis: "full_article",
      extractionStatus: "ok",
    };
  } catch (error) {
    logger.warn?.(`Article extraction failed; trying RSS/snippet fallback: ${working.url}`, error);
    return snippetFallback(working);
  }
}
