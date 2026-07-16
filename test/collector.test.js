import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverAllSources,
  discoverOfficialLinks,
  discoverSitemapLinks,
  OFFICIAL_GOOGLE_NEWS_QUERIES,
  selectRotatingQueries,
  TECHNOLOGY_GOOGLE_NEWS_QUERIES,
} from "../src/collector.js";

const source = {
  id: "official",
  name: "Official",
  listingUrl: "https://example.gov.ua/news",
  hosts: ["example.gov.ua"],
  articlePathPattern: /^\/news\//,
};

test("relative HTML href resolves to absolute article URL", () => {
  const html = `
    <a href="/about">Водопостачання у структурі установи</a>
    <a href="/news/economy">Загальний план відновлення економіки України</a>
    <a href="/news/water">Модернізація системи питного водопостачання громади</a>`;
  const items = discoverOfficialLinks(html, source);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://example.gov.ua/news/water");
});

test("sitemap discovery accepts only thematic news URLs", () => {
  const xml = `<?xml version="1.0"?><urlset>
    <url><loc>https://example.gov.ua/news/novij-vodogin-dlya-pitnogo-vodopostachannya</loc></url>
    <url><loc>https://example.gov.ua/news/vidnovlennya-ekonomiki</loc></url>
    <url><loc>https://example.gov.ua/about/vodopostachannya</loc></url>
  </urlset>`;
  const items = discoverSitemapLinks(xml, source);
  assert.equal(items.length, 1);
  assert.match(items[0].title, /vodogin/);
});

test("Google RSS link is mapped to candidate.url and missing links are logged", async () => {
  const warnings = [];
  const emptyRss = "<?xml version=\"1.0\"?><rss><channel></channel></rss>";
  const googleRss = `<?xml version="1.0"?><rss><channel>
    <item><title>Новий водогін для громади</title><link>https://news.google.com/articles/1</link><source>Тест</source></item>
    <item><title>Питна вода без посилання</title><source>Тест</source></item>
  </channel></rss>`;
  const fetchImpl = async (url) => ({
    ok: !url.includes("mindev.gov.ua"),
    status: url.includes("mindev.gov.ua") ? 403 : 200,
    url,
    text: async () => url.includes("news.google.com") ? googleRss : url.includes("rss") || url.includes("sitemap") ? emptyRss : "<html></html>",
  });
  const items = await discoverAllSources({
    googleNewsRssUrl: "https://news.google.com/rss/test",
    fetchImpl,
    logger: { error: () => {}, warn: (message) => warnings.push(message) },
  });
  assert.equal(items[0].url, "https://news.google.com/articles/1");
  assert.equal(items[1].url, undefined);
  assert.ok(warnings.some((message) => message.includes("Питна вода без посилання")));
});

test("targeted Google News queries are limited to four per scan", async () => {
  const googleQueries = [];
  const emptyRss = "<?xml version=\"1.0\"?><rss><channel></channel></rss>";
  const fetchImpl = async (url) => {
    if (url.includes("news.google.com")) {
      const query = new URL(url).searchParams.get("q");
      if (query) googleQueries.push(query);
      return { ok: true, status: 200, url, headers: { get: () => null }, text: async () => emptyRss };
    }
    return { ok: false, status: 403, url, headers: { get: () => null }, text: async () => "Forbidden" };
  };

  const items = await discoverAllSources({
    googleNewsRssUrl: "https://news.google.com/rss/search?q=водопостачання",
    fetchImpl,
    logger: { error: () => {}, warn: () => {} },
    sleep: async () => {},
  });

  assert.equal(googleQueries.length, 5);
  assert.equal(items.diagnostics.google_queries_executed, 5);
});

test("query selection rotates by UTC date", () => {
  const first = selectRotatingQueries(OFFICIAL_GOOGLE_NEWS_QUERIES, 2, new Date("2026-07-15T23:59:00Z"));
  const second = selectRotatingQueries(OFFICIAL_GOOGLE_NEWS_QUERIES, 2, new Date("2026-07-16T00:01:00Z"));

  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.notDeepEqual(first, second);
  assert.equal(selectRotatingQueries(TECHNOLOGY_GOOGLE_NEWS_QUERIES, 2, new Date("2026-07-16T00:01:00Z")).length, 2);
});

test("HTTP 503 is retried and recorded", async () => {
  const calls = new Map();
  const fetchImpl = async (url) => {
    const count = (calls.get(url) ?? 0) + 1;
    calls.set(url, count);
    if (url.includes("news.google.com/rss/search") && !new URL(url).searchParams.get("q")?.startsWith("site:")) {
      return {
        ok: count >= 3,
        status: count >= 3 ? 200 : 503,
        url,
        headers: { get: () => null },
        text: async () => "<?xml version=\"1.0\"?><rss><channel></channel></rss>",
      };
    }
    return { ok: false, status: 403, url, headers: { get: () => null }, text: async () => "Forbidden" };
  };

  const items = await discoverAllSources({
    googleNewsRssUrl: "https://news.google.com/rss/search?q=водопостачання",
    fetchImpl,
    logger: { error: () => {}, warn: () => {} },
    sleep: async () => {},
  });

  assert.ok(items.diagnostics.transient_retries >= 2);
});

test("HTTP 403 and 404 are not retried", async () => {
  const calls = new Map();
  const fetchImpl = async (url) => {
    calls.set(url, (calls.get(url) ?? 0) + 1);
    return {
      ok: false,
      status: url.includes("news.google.com") ? 404 : 403,
      url,
      headers: { get: () => null },
      text: async () => "blocked",
    };
  };

  await discoverAllSources({
    googleNewsRssUrl: "https://news.google.com/rss/search?q=водопостачання",
    fetchImpl,
    logger: { error: () => {}, warn: () => {} },
    sleep: async () => {},
  });

  assert.ok([...calls.values()].every((count) => count === 1));
});

test("a failed source does not abort discovery", async () => {
  const rss = `<?xml version="1.0"?><rss><channel>
    <item><title>Питна вода для громади</title><link>https://publisher.example/water</link></item>
  </channel></rss>`;
  const fetchImpl = async (url) => {
    if (url.includes("nerc.gov.ua")) throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
    if (url.includes("news.google.com")) return { ok: true, status: 200, url, headers: { get: () => null }, text: async () => rss };
    return { ok: false, status: 403, url, headers: { get: () => null }, text: async () => "Forbidden" };
  };

  const items = await discoverAllSources({
    googleNewsRssUrl: "https://news.google.com/rss/search?q=водопостачання",
    fetchImpl,
    logger: { error: () => {}, warn: () => {} },
    sleep: async () => {},
  });

  assert.ok(items.some((item) => item.url === "https://publisher.example/water"));
  assert.ok(items.diagnostics.source_fetch_failures > 0);
});
