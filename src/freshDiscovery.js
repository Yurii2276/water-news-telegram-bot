import { discoverAllSources } from "./collector.js";
import { normalizeUrl } from "./dedup.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function isRecent(candidate, now, maxAgeDays) {
  const publishedAt = candidate?.publishedAt ?? candidate?.published_at;
  if (!publishedAt) return true;
  const timestamp = new Date(publishedAt).getTime();
  if (!Number.isFinite(timestamp)) return true;
  return timestamp >= now.getTime() - maxAgeDays * DAY_MS;
}

function mergeDiagnostics(target, source = {}) {
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "number") target[key] = (target[key] ?? 0) + value;
  }
}

export async function discoverFreshSources(options = {}) {
  const now = options.now ?? new Date();
  const maxAgeDays = options.maxAgeDays ?? 5;
  const passes = options.passes ?? 3;
  const merged = [];
  const seen = new Set();
  const diagnostics = {};

  for (let pass = 0; pass < passes; pass += 1) {
    const passNow = new Date(now.getTime() + pass * DAY_MS);
    const candidates = await discoverAllSources({ ...options, now: passNow });
    mergeDiagnostics(diagnostics, candidates.diagnostics);

    for (const candidate of candidates) {
      if (!isRecent(candidate, now, maxAgeDays)) continue;
      const key = normalizeUrl(candidate.url) ?? `${candidate.sourceId}:${candidate.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(candidate);
    }
  }

  diagnostics.candidates_discovered = merged.length;
  Object.defineProperty(merged, "diagnostics", {
    value: diagnostics,
    enumerable: false,
  });
  return merged;
}
