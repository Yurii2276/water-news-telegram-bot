import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function parseNewsFeed(xml, limit = 5) {
  const document = parser.parse(xml);
  const items = asArray(document?.rss?.channel?.item);
  const seen = new Set();

  return items
    .map((item) => ({
      title: String(item?.title ?? "").trim(),
      link: String(item?.link ?? "").trim(),
      publishedAt: item?.pubDate ? new Date(item.pubDate) : null,
      source: String(item?.source?.["#text"] ?? item?.source ?? "").trim(),
    }))
    .filter((article) => {
      if (!article.title || !article.link || seen.has(article.link)) {
        return false;
      }
      seen.add(article.link);
      return true;
    })
    .slice(0, limit);
}

export async function fetchWaterNews(
  rssUrl,
  limit,
  { fetchImpl = fetch } = {},
) {
  const response = await fetchImpl(rssUrl, {
    headers: {
      accept: "application/rss+xml, application/xml, text/xml",
      "user-agent": "water-news-telegram-bot/0.1",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`News feed returned HTTP ${response.status}`);
  }

  return parseNewsFeed(await response.text(), limit);
}

