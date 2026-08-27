import assert from "node:assert/strict";
import test from "node:test";
import { rescueTitleFallback } from "../src/relevanceRescue.js";

test("water resources headlines pass deterministic rescue", () => {
  for (const title of [
    "Держводагентство встановлює тимчасові обмеження водокористування",
    "Держводагентство розглядає законопроєкти зі збереження водності річок і охорони вод від забруднення",
    "Уряд затвердив план управління водними ресурсами басейну річки",
  ]) {
    assert.equal(rescueTitleFallback({ title }).accepted, true, title);
  }
});

test("generic ceremonial headline is not rescued", () => {
  assert.equal(rescueTitleFallback({ title: "З Днем Державного Прапора України" }).accepted, false);
});
