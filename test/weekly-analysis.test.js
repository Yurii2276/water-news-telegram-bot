import assert from "node:assert/strict";
import test from "node:test";

import { formatWeeklyAnalysis } from "../src/weeklyAnalysis.js";

test("weekly analysis formats sector sections without internal scores", () => {
  const text = formatWeeklyAnalysis([
    {
      id: 1,
      title: "НКРЕКП схвалила тариф на воду",
      sourceName: "НКРЕКП",
      url: "https://www.nerc.gov.ua/news/tariff",
      summary: "НКРЕКП схвалила тариф на воду для водоканалу.",
      aiDecision: { materialCategory: "regulator", priorityScore: 98 },
    },
    {
      id: 2,
      title: "Smart water leak detection reduces losses",
      displayTitleUk: "Технології smart water скорочують втрати води",
      sourceName: "WaterWorld",
      url: "https://example.com/smart",
      summary: "WaterWorld повідомляє про smart water leak detection для скорочення втрат води.",
      aiDecision: { materialCategory: "international_tech", priorityScore: 70 },
    },
  ], { now: new Date("2026-07-17T12:00:00Z") });

  assert.match(text, /Вода UA: тижневий аналіз сектору/);
  assert.match(text, /Регулювання, тарифи та законодавство/);
  assert.match(text, /Відновлення, донори та технології/);
  assert.match(text, /Технології smart water скорочують втрати води/);
  assert.doesNotMatch(text, /priorityScore|high|medium|low/);
});
