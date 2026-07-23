import { isValidHttpUrl } from "./dedup.js";

const GOOGLE_NEWS_HOSTS = new Set(["news.google.com", "www.news.google.com"]);
const GOOGLE_HOST_SUFFIXES = ["google.com", "googleusercontent.com", "gstatic.com"];

export function isGoogleNewsUrl(value) {
  if (!isValidHttpUrl(value)) return false;
  const url = new URL(value);
  return GOOGLE_NEWS_HOSTS.has(url.hostname.toLowerCase());
}

function decodeHtml(value) {
  return String(value ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function normalizeEmbeddedUrl(value) {
  if (!value) return null;
  let candidate = decodeHtml(String(value).trim())
    .replaceAll("\\u003d", "=")
    .replaceAll("\\u0026", "&")
    .replaceAll("\\/", "/");

  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    // Keep the original candidate when it is not percent-encoded.
  }

  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const isGoogleHost = GOOGLE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
    if (!isValidHttpUrl(url.toString()) || isGoogleHost) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extractPublisherUrl(html) {
  const candidates = [];
  const push = (value) => {
    const normalized = normalizeEmbeddedUrl(value);
    if (normalized) candidates.push(normalized);
  };

  const metaRefresh = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url\s*=\s*([^"'>\s]+)[^"']*["']/i)
    ?? html.match(/<meta[^>]+content=["'][^"']*url\s*=\s*([^"'>\s]+)[^"']*["'][^>]+http-equiv=["']?refresh["']?/i);
  if (metaRefresh?.[1]) push(metaRefresh[1]);

  const canonical = html.match(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["']/i)
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["']/i);
  if (canonical?.[1]) push(canonical[1]);

  for (const match of html.matchAll(/https?:\\?\/\\?\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/g)) {
    push(match[0]);
  }

  for (const match of html.matchAll(/(?:url|href|link)["']?\s*[:=]\s*["']([^"']+)["']/gi)) {
    push(match[1]);
  }

  return candidates[0] ?? null;
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
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "uk-UA,uk;q=0.9,en;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; WaterNewsEditor/0.5; +https://github.com/Yurii2276/water-news-telegram-bot)",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    const redirectedUrl = normalizeEmbeddedUrl(response.url);
    if (response.ok && redirectedUrl) {
      return { url: redirectedUrl, resolved: true, failed: false };
    }

    if (response.ok) {
      const html = await response.text();
      const publisherUrl = extractPublisherUrl(html);
      if (publisherUrl) {
        return { url: publisherUrl, resolved: true, failed: false };
      }
    }

    logger.warn?.(`Google News URL remained unresolved: ${value}`);
    return { url: value, resolved: false, failed: true };
  } catch (error) {
    logger.warn?.("Google News URL resolution failed", error);
    return { url: value, resolved: false, failed: true };
  }
}
