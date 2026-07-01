import assert from "node:assert/strict";
import test from "node:test";

import { getConfig } from "../src/config.js";

const required = {
  TELEGRAM_BOT_TOKEN: "token",
  ADMIN_TELEGRAM_ID: "42",
  PUBLISH_CHAT_ID: "-1001",
  DATABASE_URL: "postgresql://localhost/test",
  OPENAI_API_KEY: "key",
};

test("DRY_RUN defaults to true and requires explicit false", () => {
  assert.equal(getConfig(required).dryRun, true);
  assert.equal(getConfig({ ...required, DRY_RUN: "false" }).dryRun, false);
});

test("invalid DRY_RUN value is rejected", () => {
  assert.throws(
    () => getConfig({ ...required, DRY_RUN: "yes" }),
    /DRY_RUN must be true or false/,
  );
});
