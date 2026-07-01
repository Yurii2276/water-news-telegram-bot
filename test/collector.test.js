import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverOfficialLinks,
  discoverSitemapLinks,
} from "../src/collector.js";

const source = {
  id: "official",
  name: "Official",
  listingUrl: "https://example.gov.ua/news",
  hosts: ["example.gov.ua"],
  articlePathPattern: /^\/news\//,
};

test("official HTML discovery excludes navigation and unrelated recovery", () => {
  const html = `
    <a href="/about">Водопостачання у структурі установи</a>
    <a href="/news/economy">Загальний план відновлення економіки України</a>
    <a href="/news/water">Модернізація системи питного водопостачання громади</a>
  `;

  const items = discoverOfficialLinks(html, source);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://example.gov.ua/news/water");
});

test("sitemap discovery accepts only thematic news URLs", () => {
  const xml = `<?xml version="1.0"?>
    <urlset>
      <url><loc>https://example.gov.ua/news/novij-vodogin-dlya-pitnogo-vodopostachannya</loc></url>
      <url><loc>https://example.gov.ua/news/vidnovlennya-ekonomiki</loc></url>
      <url><loc>https://example.gov.ua/about/vodopostachannya</loc></url>
    </urlset>`;

  const items = discoverSitemapLinks(xml, source);
  assert.equal(items.length, 1);
  assert.match(items[0].title, /vodogin/);
});
