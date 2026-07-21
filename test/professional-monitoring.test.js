import assert from "node:assert/strict";
import test from "node:test";

import { getConfig } from "../src/config.js";
import { prepareMaterialContext } from "../src/context.js";
import { createDatabase } from "../src/db.js";
import { formatPublication } from "../src/telegram.js";
import { classifyMaterialProfile } from "../src/topics.js";
import { resolveGoogleNewsUrl } from "../src/urlResolver.js";
import { millisecondsUntilTimeUtc } from "../src/scheduler.js";

test("Telegram publication does not expose long Google News RSS URL and uses hyperlink", () => {
  const text = formatPublication({
    title: "Тариф на воду",
    url: "https://example.com/source",
    originalUrl: "https://news.google.com/rss/articles/CBMiVeryLongRedirect",
    sourceName: "Example",
    aiDecision: { materialCategory: "regulator", priorityLevel: "high" },
  });

  assert.doesNotMatch(text, /news\.google\.com\/rss\/articles/);
  assert.match(text, /<a href="https:\/\/example\.com\/source">https:\/\/example\.com\/source<\/a>/);
});

test("post suppresses generic professional context when OpenAI context generation fails", async () => {
  const material = await prepareMaterialContext(
    {
      title: "НКРЕКП схвалила тариф на централізоване водопостачання",
      sourceName: "НКРЕКП",
      aiDecision: { materialCategory: "regulator" },
    },
    {
      apiKey: "test-key",
      forceOpenAiContext: true,
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: "quota exceeded" } }),
      }),
      logger: { warn: () => {} },
    },
  );

  assert.equal(material.professionalContextUk, "");
  assert.doesNotMatch(formatPublication({ ...material, url: "https://example.com" }), /регулювання водопостачання/);
});

test("official regulatory items are normative acts and high priority", () => {
  for (const material of [
    { title: "НКРЕКП оприлюднила проєкт постанови щодо тарифів на централізоване водопостачання", sourceId: "nerc" },
    { title: "КМУ ухвалив розпорядження про відновлення водної інфраструктури", sourceId: "cabinet" },
    { title: "Верховна Рада розгляне законопроєкт щодо питної води", sourceId: "rada" },
  ]) {
    const profile = classifyMaterialProfile(material, ["legislation"]);
    assert.equal(profile.normativeAct, true);
    assert.equal(profile.priorityLevel, "high");
  }
});

test("association item is prioritized above local outage and local outage is low priority", () => {
  const association = classifyMaterialProfile({
    title: "Асоціація водоканалів обговорила інвестиційну програму підприємств",
    sourceCategory: "association",
  });
  const outage = classifyMaterialProfile({
    title: "На одній вулиці кілька годин не буде води через плановий ремонт",
    sourceCategory: "general_news",
  });

  assert.equal(association.priorityLevel, "high");
  assert.equal(outage.priorityLevel, "low");
  assert.ok(association.priorityScore > outage.priorityScore);
});

test("international smart water technology is accepted as international_tech", () => {
  const profile = classifyMaterialProfile({
    title: "Smart water leak detection cuts non-revenue water in utilities",
    sourceCategory: "general_news",
  }, ["technology"]);

  assert.equal(profile.materialCategory, "international_tech");
});

test("publication queue SQL orders normative and official items before local outage", () => {
  const source = createDatabase.toString();
  assert.match(source, /normativeAct/);
  assert.match(source, /WHEN 'regulator' THEN 1/);
  assert.match(source, /WHEN 'local_media' THEN 9/);
});

test("scheduled digest config supports 16:40 Europe/Kyiv local defaults", () => {
  const config = getConfig({
    TELEGRAM_BOT_TOKEN: "token",
    ADMIN_TELEGRAM_ID: "42",
    PUBLISH_CHAT_ID: "-1001",
    DATABASE_URL: "postgresql://localhost/test",
    OPENAI_API_KEY: "key",
  });
  const now = new Date("2026-07-15T13:39:00Z");

  assert.equal(config.dailyDigestEnabled, true);
  assert.equal(config.dailyDigestTimezone, "Europe/Kyiv");
  assert.equal(config.dailyDigestLocalHour, 16);
  assert.equal(config.dailyDigestLocalMinute, 40);
  assert.equal(millisecondsUntilTimeUtc(13, 40, now), 60_000);
});

test("Google News redirect resolver stores final publisher URL when possible", async () => {
  const result = await resolveGoogleNewsUrl("https://news.google.com/rss/articles/CBMiTest", {
    fetchImpl: async () => ({
      ok: true,
      url: "https://publisher.example/water/story",
    }),
  });

  assert.equal(result.resolved, true);
  assert.equal(result.url, "https://publisher.example/water/story");
});
