import assert from "node:assert/strict";
import test from "node:test";
import { parseNewsFeed } from "../src/news.js";

test("RSS item link produces candidate.url", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>Перша новина</title><link>https://example.com/1</link><source>Тест</source></item>
    <item><title>GUID новина</title><guid>https://example.com/2</guid></item>
    <item><title>Дублікат</title><link>https://example.com/1</link></item>
  </channel></rss>`;
  const articles = parseNewsFeed(xml, 10);
  assert.equal(articles.length, 2);
  assert.equal(articles[0].url, "https://example.com/1");
  assert.equal(articles[0].link, articles[0].url);
  assert.equal(articles[0].source, "Тест");
  assert.equal(articles[1].url, "https://example.com/2");
});

test("Atom entry link href produces candidate.url", () => {
  const xml = `<?xml version="1.0"?><feed>
    <title>Офіційні новини</title>
    <entry><title>Питна вода для громади</title><link rel="alternate" href="https://example.com/atom-water"/></entry>
  </feed>`;
  const [article] = parseNewsFeed(xml);
  assert.equal(article.url, "https://example.com/atom-water");
  assert.equal(article.source, "Офіційні новини");
});

test("enclosure is used only when it looks like an article page", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>Article enclosure</title><enclosure url="https://example.com/news/water"/></item>
    <item><title>Image enclosure</title><enclosure url="https://example.com/photo.jpg"/></item>
  </channel></rss>`;
  const articles = parseNewsFeed(xml);
  assert.equal(articles[0].url, "https://example.com/news/water");
  assert.equal(articles[1].url, undefined);
});
