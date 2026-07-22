import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverAllSources,
  discoverOfficialLinks,
  discoverSitemapLinks,
  OFFICIAL_GOOGLE_NEWS_QUERIES,
  selectRotatingQueries,
  selectedTargetedQueries,
  TECHNOLOGY_GOOGLE_NEWS_QUERIES,
} from "../src/collector.js";
import { GOOGLE_NEWS_ONLY_SOURCE_IDS, OFFICIAL_SOURCES } from "../src/sources.js";

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

test("query selection rotates by Europe/Kyiv date", () => {
  const first = selectRotatingQueries(OFFICIAL_GOOGLE_NEWS_QUERIES, 2, new Date("2026-07-15T20:59:00Z"));
  const second = selectRotatingQueries(OFFICIAL_GOOGLE_NEWS_QUERIES, 2, new Date("2026-07-15T21:01:00Z"));

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

test("known donor organizations are google_news_only and are not directly fetched", async () => {
  const directUrls = [];
  const emptyRss = "<?xml version=\"1.0\"?><rss><channel></channel></rss>";
  const fetchImpl = async (url) => {
    directUrls.push(url);
    return { ok: true, status: 200, url, headers: { get: () => null }, text: async () => emptyRss };
  };

  const items = await discoverAllSources({
    googleNewsRssUrl: "https://news.google.com/rss/search?q=water",
    fetchImpl,
    logger: { error: () => {}, warn: () => {}, info: () => {} },
    sleep: async () => {},
  });
  const knownFailingIds = ["unicef_ukraine", "undp_ukraine", "world_bank_ukraine", "ebrd_ukraine", "usaid_ukraine"];
  for (const sourceId of knownFailingIds) {
    const source = OFFICIAL_SOURCES.find((item) => item.id === sourceId);
    assert.ok(GOOGLE_NEWS_ONLY_SOURCE_IDS.has(sourceId));
    assert.equal(source.discoveryMode, "google_news_only");
    assert.equal(directUrls.includes(source.listingUrl), false);
  }
  assert.equal(items.diagnostics.direct_sources_skipped_google_news_only, 5);
  assert.ok(selectedTargetedQueries(new Date("2026-07-15T21:01:00Z")).some((query) => /worldbank|ebrd|eib|unicef|who|oecd|ec\.europa|unwater/i.test(query)));
});

test("repeated permanent source failure enters cooldown and skips later direct fetch", async () => {
  const health = new Map();
  const sourceHealthStore = {
    async isSourceInCooldown(sourceId, now) {
      const entry = health.get(sourceId);
      return Boolean(entry?.cooldown_until && new Date(entry.cooldown_until) > now);
    },
    async recordSourceFetchSuccess(sourceId) {
      const previous = health.get(sourceId);
      health.set(sourceId, { status: "recovered", consecutive: 0, cooldown_until: null });
      return previous && previous.status !== "recovered" ? "recovered" : "ok";
    },
    async recordSourceFetchFailure(sourceId, { status, statusCode, threshold, cooldownHours }) {
      const previous = health.get(sourceId) ?? { consecutive: 0 };
      const consecutive = status === "blocked" || status === "permanent_failure" ? previous.consecutive + 1 : 0;
      const entry = {
        status,
        last_status_code: statusCode,
        consecutive,
        cooldown_until: consecutive >= threshold ? new Date(Date.parse("2026-07-15T09:00:00Z") + cooldownHours * 60 * 60 * 1000).toISOString() : null,
      };
      health.set(sourceId, entry);
      return entry;
    },
  };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("mindev.gov.ua")) {
      return { ok: false, status: 403, url, headers: { get: () => null }, text: async () => "blocked" };
    }
    return { ok: true, status: 200, url, headers: { get: () => null }, text: async () => "<?xml version=\"1.0\"?><rss><channel></channel></rss>" };
  };

  for (let index = 0; index < 3; index += 1) {
    await discoverAllSources({
      googleNewsRssUrl: "https://news.google.com/rss/search?q=water",
      fetchImpl,
      logger: { error: () => {}, warn: () => {}, info: () => {} },
      sourceHealthStore,
      sourcePermanentFailureThreshold: 3,
      sourcePermanentFailureCooldownHours: 168,
      now: new Date("2026-07-15T09:00:00Z"),
      sleep: async () => {},
    });
  }
  const beforeCooldownCalls = calls.filter((url) => url.includes("mindev.gov.ua")).length;
  const after = await discoverAllSources({
    googleNewsRssUrl: "https://news.google.com/rss/search?q=water",
    fetchImpl,
    logger: { error: () => {}, warn: () => {}, info: () => {} },
    sourceHealthStore,
    now: new Date("2026-07-16T09:00:00Z"),
    sleep: async () => {},
  });

  assert.equal(beforeCooldownCalls, 3);
  assert.equal(calls.filter((url) => url.includes("mindev.gov.ua")).length, 3);
  assert.equal(after.diagnostics.direct_sources_skipped_cooldown, 1);
});
