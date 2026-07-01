import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  return String(value?.["#text"] ?? "").trim();
}

function validHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function articleUrl(value) {
  const url = validHttpUrl(value);
  if (!url) return null;
  return /\.(?:jpe?g|png|gif|webp|svg|mp3|mp4|mov|avi|pdf|zip)(?:$|[?#])/i.test(url)
    ? null
    : url;
}

function linkCandidates(item) {
  const links = asArray(item?.link);
  const preferred = links.filter((link) => !link?.["@_rel"] || link?.["@_rel"] === "alternate");
  const values = [...preferred, ...links].flatMap((link) => [
    typeof link === "string" ? link : null,
    link?.["@_href"],
    link?.href,
    link?.["#text"],
  ]);
  values.push(textOf(item?.guid));
  const enclosure = item?.enclosure;
  values.push(enclosure?.["@_url"], enclosure?.url);
  return values.filter(Boolean);
}

function extractItemUrl(item) {
  for (const value of linkCandidates(item)) {
    const url = articleUrl(value);
    if (url) return url;
  }
  return null;
}

export function parseNewsFeed(xml, limit = 5) {
  const document = parser.parse(xml);
  const rssItems = asArray(document?.rss?.channel?.item);
  const atomItems = asArray(document?.feed?.entry);
  const feedSource = textOf(document?.feed?.title);
  const seen = new Set();

  return [...rssItems, ...atomItems]
    .map((item) => {
      const url = extractItemUrl(item);
      return {
        title: textOf(item?.title),
        url: url ?? undefined,
        link: url ?? undefined,
        publishedAt: item?.pubDate || item?.published || item?.updated
          ? new Date(item.pubDate ?? item.published ?? item.updated)
          : null,
        source: textOf(item?.source) || feedSource,
      };
    })
    .filter((article) => {
      if (!article.title) return false;
      if (article.url && seen.has(article.url)) return false;
      if (article.url) seen.add(article.url);
      return true;
    })
    .slice(0, limit);
}

export async function fetchWaterNews(rssUrl, limit, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(rssUrl, {
    headers: {
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      "user-agent": "water-news-telegram-bot/0.1",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`News feed returned HTTP ${response.status}`);
  return parseNewsFeed(await response.text(), limit);
}
