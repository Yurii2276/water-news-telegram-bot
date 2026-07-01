import assert from "node:assert/strict";
import test from "node:test";

import { parseNewsFeed } from "../src/news.js";

test("parseNewsFeed reads, deduplicates and limits RSS items", () => {
  const xml = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>Перша новина</title>
          <link>https://example.com/1</link>
          <source>Тест</source>
        </item>
        <item>
          <title>Дублікат</title>
          <link>https://example.com/1</link>
        </item>
        <item>
          <title>Друга новина</title>
          <link>https://example.com/2</link>
        </item>
      </channel>
    </rss>`;

  const articles = parseNewsFeed(xml, 2);

  assert.equal(articles.length, 2);
  assert.equal(articles[0].title, "Перша новина");
  assert.equal(articles[0].source, "Тест");
  assert.equal(articles[1].link, "https://example.com/2");
});

