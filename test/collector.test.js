import assert from "node:assert/strict";
import test from "node:test";
import { discoverAllSources, discoverOfficialLinks, discoverSitemapLinks } from "../src/collector.js";

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
