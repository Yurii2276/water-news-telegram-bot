function isGoogleNewsUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "news.google.com" || host.endsWith(".news.google.com");
  } catch {
    return false;
  }
}

export function isGoogleNewsCandidate(candidate) {
  return candidate?.sourceId === "google_news" || isGoogleNewsUrl(candidate?.url);
}

export function shouldRunCandidateDedup(candidate) {
  return !isGoogleNewsCandidate(candidate);
}

export function resolvedDedupPool(existing, candidate) {
  if (!isGoogleNewsCandidate(candidate)) return existing;
  return existing.filter((item) => !isGoogleNewsUrl(item?.url));
}
