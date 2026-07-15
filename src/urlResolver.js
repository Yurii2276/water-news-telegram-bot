import { isValidHttpUrl } from "./dedup.js";

const GOOGLE_NEWS_HOSTS = new Set(["news.google.com", "www.news.google.com"]);

export function isGoogleNewsUrl(value) {
  if (!isValidHttpUrl(value)) return false;
  const url = new URL(value);
  return GOOGLE_NEWS_HOSTS.has(url.hostname.toLowerCase());
}

export async function resolveGoogleNewsUrl(
  value,
  { fetchImpl = fetch, timeoutMs = 10_000, logger = console } = {},
) {
  if (!isGoogleNewsUrl(value)) {
    return { url: value, resolved: false, failed: false };
  }

  try {
    const response = await fetchImpl(value, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": "WaterNewsEditor/0.4 url-resolver" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const resolvedUrl = response.url || value;
    if (response.ok && isValidHttpUrl(resolvedUrl) && !isGoogleNewsUrl(resolvedUrl)) {
      return { url: resolvedUrl, resolved: true, failed: false };
    }
    return { url: value, resolved: false, failed: true };
  } catch (error) {
    logger.warn?.("Google News URL resolution failed", error);
    return { url: value, resolved: false, failed: true };
  }
}
