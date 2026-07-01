import assert from "node:assert/strict";
import test from "node:test";

import { createUpdateHandler, formatScanReport } from "../src/bot.js";

test("/scan starts collection and auto-publisher", async () => {
  const sent = [];
  let kicks = 0;
  const handleUpdate = createUpdateHandler({
    telegram: { sendMessage: async (...args) => sent.push(args) },
    repository: {},
    pipeline: {
      scan: async () => ({
        discovered: 4,
        queued: 1,
        duplicates: 1,
        rejected: 2,
      }),
    },
    publisher: { kick: () => kicks++ },
    adminTelegramId: 42,
  });

  await handleUpdate({
    message: { chat: { id: 42 }, from: { id: 42 }, text: "/scan" },
  });

  assert.equal(kicks, 1);
  assert.match(sent.at(-1)[1], /у черзі 1/);
});

test("non-admin commands are denied", async () => {
  const sent = [];
  const handleUpdate = createUpdateHandler({
    telegram: { sendMessage: async (...args) => sent.push(args) },
    repository: {},
    pipeline: {},
    publisher: {},
    adminTelegramId: 42,
  });

  await handleUpdate({
    message: { chat: { id: 10 }, from: { id: 10 }, text: "/queue" },
  });

  assert.match(sent[0][1], /лише адміну/);
});

test("scan report includes rejection diagnostics and first titles", () => {
  const text = formatScanReport({
    discovered: 41,
    queued: 0,
    duplicates: 0,
    rejected: 41,
    rejectedBy: {
      irrelevant: 12,
      openaiError: 9,
      missingContentOrLink: 20,
      other: 0,
    },
    rejectedItems: [
      { title: "Матеріал <1>", reason: "OpenAI error: timeout" },
    ],
  });

  assert.match(text, /Нерелевантність: 12/);
  assert.match(text, /Помилки OpenAI: 9/);
  assert.match(text, /Немає тексту\/посилання: 20/);
  assert.match(text, /Матеріал &lt;1&gt;/);
});

