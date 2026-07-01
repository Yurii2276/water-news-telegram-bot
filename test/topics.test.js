import assert from "node:assert/strict";
import test from "node:test";

import { preliminaryFilter } from "../src/topics.js";

test("preliminary filter accepts requested water-sector topics", () => {
  const result = preliminaryFilter({
    title: "Громада модернізує очисні споруди та систему водовідведення",
  });

  assert.equal(result.relevant, true);
  assert.ok(result.categories.includes("wastewater"));
  assert.ok(result.categories.includes("treatment"));
  assert.ok(result.categories.includes("recovery"));
});

test("preliminary filter rejects unrelated news", () => {
  const result = preliminaryFilter({
    title: "Уряд затвердив календар спортивних подій",
  });
  assert.equal(result.relevant, false);
});

test("supporting recovery keyword alone is not enough", () => {
  const result = preliminaryFilter({
    title: "Уряд представив загальний план відновлення економіки",
  });
  assert.equal(result.relevant, false);
  assert.match(result.reason, /without water/i);
});

test("generic energy tariff is not treated as a water tariff", () => {
  const result = preliminaryFilter({
    title: "НКРЕКП переглянула тариф на передачу електроенергії",
  });
  assert.equal(result.relevant, false);
});

test("NERC regulatory material reaches AI even with a broad title", () => {
  const result = preliminaryFilter({
    sourceId: "nerc",
    title: "НКРЕКП оприлюднила результати моніторингу та регулювання тарифів",
  });
  assert.equal(result.relevant, true);
});

test("community infrastructure and donor projects reach AI", () => {
  const community = preliminaryFilter({
    title: "Громади отримають фінансування для відновлення інфраструктури",
  });
  const donor = preliminaryFilter({
    title: "Міжнародні партнери запускають донорський проєкт для громад",
  });
  assert.equal(community.relevant, true);
  assert.equal(donor.relevant, true);
});
