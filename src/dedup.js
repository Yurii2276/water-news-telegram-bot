import { createHash } from "node:crypto";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
]);

export function isValidHttpUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeUrl(value) {
  if (!isValidHttpUrl(value)) return null;
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

export function normalizeTitle(value) {
  return String(value ?? "")
    .toLocaleLowerCase("uk")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value) {
  return new Set(normalizeTitle(value).split(" ").filter((token) => token.length > 2));
}

export function contentSimilarity(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function contentHash(value) {
  return createHash("sha256").update(normalizeTitle(value)).digest("hex");
}

export function findDuplicate(candidate, existing, threshold = 0.82) {
  const url = normalizeUrl(candidate.url);
  const title = normalizeTitle(candidate.title);

  for (const item of existing) {
    const existingUrl = normalizeUrl(item.url);
    if (url && existingUrl && existingUrl === url) {
      return { duplicate: true, reason: "url", material: item };
    }
    if (normalizeTitle(item.title) === title) {
      return { duplicate: true, reason: "title", material: item };
    }
    if (candidate.content && item.content && contentSimilarity(candidate.content, item.content) >= threshold) {
      return { duplicate: true, reason: "content", material: item };
    }
  }

  return { duplicate: false };
}
