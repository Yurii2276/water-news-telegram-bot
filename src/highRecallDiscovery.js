import * as cheerio from "cheerio";

import { isBroadWaterSectorCandidate, isWaterNativeSource } from "./discoveryPolicy.js";
import { normalizeUrl } from "./dedup.js";
import { parseNewsFeed } from "./news.js";
import { OFFICIAL_SOURCES } from "./sources.js";

const USER_AGENT = "Mozilla/5.0 (compatible; WaterNewsEditor/0.7; +https://github.com/Yurii2276/water-news-telegram-bot)";
const TRANSIENT = new Set([429, 500, 502, 503, 504]);
const GOOGLE_TRANSIENT = new Set([429, 502, 503, 504]);
const DAY_MS = 24 * 60 * 60 * 1000;
const GOOGLE_MIN_GAP_MS = 1_800;

export const CORE_GOOGLE_QUERIES = [
  '"водоканал" OR "водопостачання" OR "водовідведення" OR "питна вода" when:3d',
  '"тариф на воду" OR "якість води" OR "відключення води" OR "аварія водогін" OR "очисні споруди" when:3d',
];

export const ROTATING_GOOGLE_QUERIES = [
  '"водна інфраструктура" OR "реконструкція водопроводу" OR "відновлення водопостачання" OR "втрати води" when:5d',
  'НКРЕКП (водопостачання OR водовідведення OR тариф OR "інвестиційна програма") when:5d',
  '("World Bank" OR EBRD OR EIB OR UNICEF OR UNDP OR USAID) Ukraine (water OR wastewater OR WASH) when:7d',
  '("smart water" OR "non-revenue water" OR "leak detection" OR "wastewater treatment") Ukraine when:7d',
  '("водні ресурси" OR "забруднення води" OR "якість річкової води") Україна when:3d',
  '(водоканал OR НКРЕКП OR Держводагентство) (директор OR керівник OR призначення OR звільнення) when:7d',
];

const sleepDefault = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRecent(candidate, now, maxAgeDays) {
  const publishedAt = candidate?.publishedAt ?? candidate?.published_at;
  if (!publishedAt) return true;
  const timestamp = new Date(publishedAt).getTime();
  if (!Number.isFinite(timestamp)) return true;
  return timestamp >= now.getTime() - maxAgeDays * DAY_MS;
}

export function selectedHighRecallQueries(now = new Date()) {
  const slot = Math.floor(now.getTime() / (3 * 60 * 60 * 1000));
  const start = slot % ROTATING_GOOGLE_QUERIES.length;
  return [
    ...CORE_GOOGLE_QUERIES,
    ROTATING_GOOGLE_QUERIES[start],
    ROTATING_GOOGLE_QUERIES[(start + 1) % ROTATING_GOOGLE_QUERIES.length],
  ];
}

function googleNewsUrl(query) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "uk");
  url.searchParams.set("gl", "UA");
  url.searchParams.set("ceid", "UA:uk");
  return url.toString();
}

function fetchError(url, status) {
  const error = new Error(`${url} returned HTTP ${status}`);
  error.status = status;
  return error;
}

async function fetchText(url, {
  fetchImpl,
  sleep,
  logger,
  diagnostics,
  maxAttempts = 2,
  timeoutMs = 18_000,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          accept: "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml,text/xml",
          "user-agent": USER_AGENT,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return { text: await response.text(), finalUrl: response.url || url, status: response.status };
      const error = fetchError(url, response.status);
      if (!TRANSIENT.has(response.status) || attempt === maxAttempts) throw error;
      diagnostics.transient_retries += 1;
      await sleep(2_000 * attempt);
    } catch (error) {
      lastError = error;
      const transientNetwork = error?.name === "TimeoutError" || ["ECONNRESET", "ETIMEDOUT"].includes(error?.code ?? error?.cause?.code);
      if (!transientNetwork || attempt === maxAttempts) throw error;
      diagnostics.transient_retries += 1;
      logger.warn?.(`Retrying direct source after transient network error: ${url}`);
      await sleep(2_000 * attempt);
    }
  }
  throw lastError;
}

function candidateFromFeed(item, source) {
  return {
    ...item,
    url: item.url ?? item.link,
    sourceId: source.id,
    sourceName: item.source || source.name,
    sourceCategory: source.category,
    discoveryMethod: "official_rss",
  };
}

function directItemRelevant(item, source) {
  return isWaterNativeSource({ sourceId: source.id }) || isBroadWaterSectorCandidate({
    ...item,
    sourceId: source.id,
    sourceName: source.name,
  });
}

function listingCandidates(html, source, limit) {
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  $("a[href]").each((_, element) => {
    if (items.length >= limit) return;
    let url;
    try {
      url = new URL($(element).attr("href"), source.listingUrl).toString();
    } catch {
      return;
    }
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (!source.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return;
    if (source.articlePathPattern && !source.articlePathPattern.test(new URL(url).pathname)) return;
    if (seen.has(url)) return;

    const anchor = $(element).text().replace(/\s+/g, " ").trim();
    const label = String($(element).attr("title") ?? $(element).attr("aria-label") ?? "").replace(/\s+/g, " ").trim();
    const container = $(element).closest("article,li,.news-item,.news,.item,.card").text().replace(/\s+/g, " ").trim();
    const title = [anchor, label, container].find((value) => value.length >= 18) ?? "";
    if (!title) return;

    const candidate = {
      title: title.slice(0, 500),
      url,
      sourceId: source.id,
      sourceName: source.name,
      sourceCategory: source.category,
      discoveryMethod: "official",
    };
    if (!directItemRelevant(candidate, source)) return;
    seen.add(url);
    items.push(candidate);
  });

  return items;
}

function sitemapCandidates(xml, source, limit) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];
  $("url").each((_, element) => {
    const url = $(element).find("loc").first().text().trim();
    if (!url) return;
    let pathname;
    try {
      pathname = new URL(url).pathname;
    } catch {
      return;
    }
    if (source.articlePathPattern && !source.articlePathPattern.test(pathname)) return;
    const title = decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? "")
      .replaceAll("-", " ")
      .replaceAll("_", " ")
      .trim();
    const candidate = {
      title,
      url,
      sourceId: source.id,
      sourceName: source.name,
      sourceCategory: source.category,
      discoveryMethod: "official_sitemap",
      publishedAt: $(element).find("lastmod").first().text().trim() || null,
    };
    if (!directItemRelevant(candidate, source)) return;
    items.push(candidate);
  });
  return items.reverse().slice(0, limit);
}

function pushUnique(target, seen, candidates, now, maxAgeDays) {
  for (const candidate of candidates) {
    if (!candidate?.url || !isRecent(candidate, now, maxAgeDays)) continue;
    const key = normalizeUrl(candidate.url) ?? `${candidate.sourceId}:${candidate.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(candidate);
  }
}

async function discoverDirectSources({
  limit,
  now,
  fetchImpl,
  sleep,
  logger,
  sourceHealthStore,
  sourcePermanentFailureThreshold,
  sourcePermanentFailureCooldownHours,
  diagnostics,
}) {
  const candidates = [];
  for (const source of OFFICIAL_SOURCES) {
    if (await sourceHealthStore?.isSourceInCooldown?.(source.id, now)) {
      diagnostics.direct_sources_skipped_cooldown += 1;
      continue;
    }
    diagnostics.direct_sources_attempted += 1;
    try {
      let discovered = [];
      if (source.feedUrl) {
        const { text } = await fetchText(source.feedUrl, { fetchImpl, sleep, logger, diagnostics });
        discovered = parseNewsFeed(text, limit)
          .map((item) => candidateFromFeed(item, source))
          .filter((item) => directItemRelevant(item, source));
      } else if (source.sitemapUrl) {
        const { text } = await fetchText(source.sitemapUrl, { fetchImpl, sleep, logger, diagnostics });
        discovered = sitemapCandidates(text, source, limit);
      } else {
        const { text } = await fetchText(source.listingUrl, { fetchImpl, sleep, logger, diagnostics });
        discovered = listingCandidates(text, source, limit);
      }
      candidates.push(...discovered);
      const health = await sourceHealthStore?.recordSourceFetchSuccess?.(source.id);
      if (health === "recovered") diagnostics.recovered_sources += 1;
    } catch (error) {
      diagnostics.source_fetch_failures += 1;
      if (error?.status === 403 || error?.status === 404) {
        diagnostics.permanent_failures += 1;
        await sourceHealthStore?.recordSourceFetchFailure?.(source.id, {
          status: error.status === 403 ? "blocked" : "permanent_failure",
          statusCode: error.status,
          error: error.message,
          threshold: sourcePermanentFailureThreshold,
          cooldownHours: sourcePermanentFailureCooldownHours,
        });
      } else {
        diagnostics.transient_failures += 1;
        await sourceHealthStore?.recordSourceFetchFailure?.(source.id, {
          status: "transient_failure",
          statusCode: error?.status ?? null,
          error: error.message,
          threshold: sourcePermanentFailureThreshold,
          cooldownHours: sourcePermanentFailureCooldownHours,
        });
      }
      logger.warn?.(`High-recall direct discovery failed: ${source.id}: ${error.message}`);
    }
  }
  return candidates;
}

async function discoverGoogleNews({ now, limit, fetchImpl, sleep, logger, diagnostics }) {
  const candidates = [];
  let lastRequestAt = 0;

  for (const query of selectedHighRecallQueries(now)) {
    if (diagnostics.google_circuit_opened) break;
    const gap = Date.now() - lastRequestAt;
    if (lastRequestAt && gap < GOOGLE_MIN_GAP_MS) await sleep(GOOGLE_MIN_GAP_MS - gap);
    const url = googleNewsUrl(query);
    diagnostics.google_queries_executed += 1;
    try {
      lastRequestAt = Date.now();
      const response = await fetchImpl(url, {
        headers: {
          accept: "application/rss+xml,application/atom+xml,application/xml,text/xml",
          "user-agent": USER_AGENT,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        if (GOOGLE_TRANSIENT.has(response.status)) {
          diagnostics.google_circuit_opened = 1;
          diagnostics.source_fetch_failures += 1;
          diagnostics.transient_failures += 1;
          logger.warn?.(`Google News circuit opened after HTTP ${response.status}; remaining queries deferred to next scan`);
          break;
        }
        throw fetchError(url, response.status);
      }
      const items = parseNewsFeed(await response.text(), Math.max(8, Math.ceil(limit / 2)));
      for (const item of items) {
        const candidate = {
          ...item,
          url: item.url ?? item.link,
          sourceId: "google_news",
          sourceName: item.source || "Google News discovery",
          sourceCategory: "general_news",
          discoveryMethod: "google_news_high_recall",
          sectorQuery: query,
        };
        // The query itself is water-sector scoped. Keep every result for full-text
        // inspection so indirect but important headlines are not lost at discovery time.
        candidates.push(candidate);
      }
    } catch (error) {
      diagnostics.source_fetch_failures += 1;
      diagnostics.transient_failures += TRANSIENT.has(error?.status) ? 1 : 0;
      logger.warn?.(`Google News high-recall query failed: ${query}: ${error.message}`);
    }
  }
  return candidates;
}

export async function discoverHighRecallSources({
  limit = 30,
  now = new Date(),
  maxAgeDays = 7,
  fetchImpl = fetch,
  sleep = sleepDefault,
  logger = console,
  sourceHealthStore = null,
  sourcePermanentFailureThreshold = 3,
  sourcePermanentFailureCooldownHours = 168,
} = {}) {
  const diagnostics = {
    source_fetch_failures: 0,
    transient_retries: 0,
    google_queries_executed: 0,
    google_circuit_opened: 0,
    direct_sources_attempted: 0,
    direct_sources_skipped_google_news_only: 0,
    direct_sources_skipped_cooldown: 0,
    transient_failures: 0,
    permanent_failures: 0,
    recovered_sources: 0,
    candidates_discovered: 0,
  };
  const merged = [];
  const seen = new Set();

  const direct = await discoverDirectSources({
    limit,
    now,
    fetchImpl,
    sleep,
    logger,
    sourceHealthStore,
    sourcePermanentFailureThreshold,
    sourcePermanentFailureCooldownHours,
    diagnostics,
  });
  pushUnique(merged, seen, direct, now, maxAgeDays);

  const google = await discoverGoogleNews({ now, limit, fetchImpl, sleep, logger, diagnostics });
  pushUnique(merged, seen, google, now, maxAgeDays);

  diagnostics.candidates_discovered = merged.length;
  Object.defineProperty(merged, "diagnostics", { value: diagnostics, enumerable: false });
  return merged;
}
