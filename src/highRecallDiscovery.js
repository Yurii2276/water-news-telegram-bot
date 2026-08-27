import * as cheerio from "cheerio";

import { isBroadWaterSectorCandidate, isWaterNativeSource } from "./discoveryPolicy.js";
import { normalizeUrl } from "./dedup.js";
import { parseNewsFeed } from "./news.js";
import { createNewsSearchState, fetchNewsSearchLane } from "./newsSearchProvider.js";
import { OFFICIAL_SOURCES, isGoogleNewsOnlySource } from "./sources.js";

const USER_AGENT = "Mozilla/5.0 (compatible; WaterNewsEditor/1.1; +https://github.com/Yurii2276/water-news-telegram-bot)";
const TRANSIENT = new Set([429, 500, 502, 503, 504]);
const DAY_MS = 24 * 60 * 60 * 1000;
const NEWS_SEARCH_GAP_MS = 1_800;

// Four permanent base lanes. Supplemental discovery adds water resources,
// utilities, donor, cyber/OT and technology-specific coverage on top of these.
export const COVERAGE_GOOGLE_QUERIES = [
  '(НКРЕКП OR Мінрозвитку OR "Кабінет Міністрів" OR "Верховна Рада") (водопостачання OR водовідведення OR водоканал OR "тариф на воду" OR "інвестиційна програма" OR "водна інфраструктура") when:5d',
  '(водоканал OR водопостачання OR водовідведення OR "питна вода" OR "якість води" OR "очисні споруди" OR "аварія на водогоні" OR "відключення води" OR "втрати води") Україна when:3d',
  '("World Bank" OR EBRD OR EIB OR UNICEF OR UNDP OR "European Commission" OR "Ukraine Facility") (Ukraine water OR Ukraine wastewater OR Ukraine WASH OR "water infrastructure Ukraine") when:7d',
  '("smart water" OR "digital water" OR "non-revenue water" OR "leak detection" OR "smart metering" OR "digital twin" OR "water utility AI" OR "SCADA water" OR "wastewater treatment" OR "sludge treatment" OR "wastewater reuse" OR "desalination technology" OR "membrane bioreactor") when:7d',
];

const sleepDefault = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const UK_MONTHS = new Map([
  ["січня", 0], ["лютого", 1], ["березня", 2], ["квітня", 3],
  ["травня", 4], ["червня", 5], ["липня", 6], ["серпня", 7],
  ["вересня", 8], ["жовтня", 9], ["листопада", 10], ["грудня", 11],
]);

function dateFromText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ");
  let match = text.match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2})\b/u);
  if (match) {
    return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  }
  match = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/u);
  if (match) {
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }
  match = text.match(/\b(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)\s+(20\d{2})\b/iu);
  if (match) {
    return new Date(Date.UTC(Number(match[3]), UK_MONTHS.get(match[2].toLowerCase()), Number(match[1])));
  }
  return null;
}

function isRecent(candidate, now, maxAgeDays) {
  const publishedAt = candidate?.publishedAt ?? candidate?.published_at;
  if (!publishedAt) return true;
  const timestamp = new Date(publishedAt).getTime();
  if (!Number.isFinite(timestamp)) return true;
  return timestamp >= now.getTime() - maxAgeDays * DAY_MS;
}

export function selectedHighRecallQueries() {
  return [...COVERAGE_GOOGLE_QUERIES];
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

const NAVIGATION_TITLE = /^(?:головна|про асоціацію|рада|дирекція|учасники|партнери|новини|всі новини|діяльність|обладнання|очистка та знезараження|it-забезпечення|лічильники|call-центр|інвестиційна політика|тарифна політика|кадрова політика|робочі групи|медіа|журнал|фото|відео|календар подій|контакти|юридична консультація|категорія:.*|детальніше)$/iu;

function listingCandidates(html, source, limit) {
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();
  const sourceLimit = Math.max(1, Math.min(limit, source.maxDirectItems ?? 12));

  $("a[href]").each((_, element) => {
    if (items.length >= sourceLimit) return;
    let url;
    try {
      url = new URL($(element).attr("href"), source.listingUrl).toString();
    } catch {
      return;
    }
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (!source.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return;
    if (source.articlePathPattern && !source.articlePathPattern.test(parsed.pathname)) return;
    if (seen.has(url)) return;

    const anchor = $(element).text().replace(/\s+/g, " ").trim();
    const label = String($(element).attr("title") ?? $(element).attr("aria-label") ?? "").replace(/\s+/g, " ").trim();
    const containerNode = $(element).closest("article,.post,.blog-post,.news-item,.news,.item,.card,li");
    const container = (containerNode.length ? containerNode : $(element).parent()).text().replace(/\s+/g, " ").trim();
    const title = [anchor, label].find((value) => value.length >= 18) ?? "";
    if (!title || NAVIGATION_TITLE.test(title)) return;

    const publishedAt = dateFromText(container);
    if (source.requirePublishedDate && !publishedAt) return;

    const candidate = {
      title: title.slice(0, 500),
      url,
      sourceId: source.id,
      sourceName: source.name,
      sourceCategory: source.category,
      discoveryMethod: "official",
      publishedAt,
      summary: container && container !== title ? container.slice(0, 1200) : undefined,
      snippet: container && container !== title ? container.slice(0, 1200) : undefined,
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
  return items.reverse().slice(0, Math.min(limit, source.maxDirectItems ?? 12));
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
    if (isGoogleNewsOnlySource(source)) {
      diagnostics.direct_sources_skipped_google_news_only += 1;
      continue;
    }
    if (await sourceHealthStore?.isSourceInCooldown?.(source.id, now)) {
      diagnostics.direct_sources_skipped_cooldown += 1;
      continue;
    }
    diagnostics.direct_sources_attempted += 1;
    try {
      let discovered = [];
      const sourceLimit = Math.max(1, Math.min(limit, source.maxDirectItems ?? 12));
      if (source.feedUrl) {
        const { text } = await fetchText(source.feedUrl, { fetchImpl, sleep, logger, diagnostics });
        discovered = parseNewsFeed(text, sourceLimit)
          .map((item) => candidateFromFeed(item, source))
          .filter((item) => directItemRelevant(item, source));
      } else if (source.sitemapUrl) {
        const { text } = await fetchText(source.sitemapUrl, { fetchImpl, sleep, logger, diagnostics });
        discovered = sitemapCandidates(text, source, sourceLimit);
      } else {
        const { text } = await fetchText(source.listingUrl, { fetchImpl, sleep, logger, diagnostics });
        discovered = listingCandidates(text, source, sourceLimit);
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

async function discoverNewsSearch({
  now,
  limit,
  fetchImpl,
  sleep,
  logger,
  diagnostics,
  newsSearchState,
}) {
  const candidates = [];
  const queries = selectedHighRecallQueries(now);

  for (const [index, query] of queries.entries()) {
    if (index > 0) await sleep(NEWS_SEARCH_GAP_MS);
    const items = await fetchNewsSearchLane({
      lane: {
        id: `base_${index + 1}`,
        query,
        hl: "uk",
        gl: "UA",
        ceid: "UA:uk",
      },
      fetchImpl,
      sleep,
      diagnostics,
      state: newsSearchState,
      logger,
      limit: Math.max(12, Math.ceil(limit / 2)),
    });

    for (const item of items) {
      candidates.push({
        ...item,
        url: item.url ?? item.link,
        sourceId: "google_news",
        sourceName: item.source || "News search discovery",
        sourceCategory: "general_news",
        discoveryMethod: item.searchProvider === "bing"
          ? "google_news_bing_fallback"
          : "google_news_high_recall",
        sectorQuery: query,
        discoveryLane: `base_${index + 1}`,
      });
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
  newsSearchState = createNewsSearchState(),
} = {}) {
  const diagnostics = {
    source_fetch_failures: 0,
    transient_retries: 0,
    google_queries_executed: 0,
    google_circuit_opened: 0,
    google_rate_limited: 0,
    google_transient_failures: 0,
    bing_fallback_queries: 0,
    news_search_fallback_successes: 0,
    news_search_failures: 0,
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
  const searched = await discoverNewsSearch({
    now,
    limit,
    fetchImpl,
    sleep,
    logger,
    diagnostics,
    newsSearchState,
  });

  // Search coverage first is deliberate: the editor queues while scanning. Putting
  // the broad lanes first prevents any one direct source from dominating the queue.
  pushUnique(merged, seen, searched, now, maxAgeDays);
  pushUnique(merged, seen, direct, now, maxAgeDays);

  diagnostics.candidates_discovered = merged.length;
  Object.defineProperty(merged, "diagnostics", { value: diagnostics, enumerable: false });
  return merged;
}
