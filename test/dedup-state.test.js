import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/db.js", import.meta.url), "utf8");

test("dedup query does not let stale rejected rows block discovery forever", () => {
  assert.match(source, /status IN \('published', 'queued', 'dry_run'\)/);
  assert.match(source, /status = 'digest_only' AND updated_at >= NOW\(\) - INTERVAL '6 hours'/);
  assert.match(source, /status = 'rejected_ai' AND updated_at >= NOW\(\) - INTERVAL '24 hours'/);
  assert.match(source, /SELECT id, url, title, content, story_key, status, published_at, created_at, updated_at/);
});

test("rediscovered relevant material can be promoted back to queued", () => {
  assert.match(source, /WHEN EXCLUDED\.status = 'queued' THEN 'queued'/);
  assert.match(source, /WHEN materials\.published_at IS NULL AND EXCLUDED\.status = 'queued' THEN 0/);
  assert.match(source, /WHEN materials\.published_at IS NULL AND EXCLUDED\.status = 'queued' THEN NULL/);
});

test("published material remains immutable on URL conflicts", () => {
  assert.match(source, /WHEN materials\.published_at IS NOT NULL OR materials\.status = 'published' THEN materials\.status/);
  assert.match(source, /WHEN materials\.published_at IS NOT NULL OR materials\.status = 'published' THEN materials\.updated_at/);
});

test("digest windows use publication and creation time instead of duplicate-touch time", () => {
  assert.match(source, /status = 'published'[\s\S]*published_at >= NOW\(\) - INTERVAL '24 hours'/);
  assert.match(source, /status IN \('queued', 'dry_run', 'digest_only'\)[\s\S]*created_at >= NOW\(\) - INTERVAL '24 hours'/);
  assert.match(source, /status = 'published'[\s\S]*published_at >= NOW\(\) - INTERVAL '7 days'/);
});
