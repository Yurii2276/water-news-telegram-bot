import pg from "pg";

import { contentHash, isValidHttpUrl, normalizeTitle, normalizeUrl } from "./dedup.js";
import { createStoryKey, inferSourceQuality } from "./editorial.js";

const { Pool } = pg;
const FAILED_PUBLICATION_STATUSES = new Set(["rejected_publish", "publish_failed"]);

export function isRetryableFailedPublication(material, { now = new Date(), windowHours = 48 } = {}) {
  if (!FAILED_PUBLICATION_STATUSES.has(material?.status)) return false;
  if (!isValidHttpUrl(material.url)) return false;
  if (material.ai_decision?.relevant !== true) return false;
  if (material.published_at) return false;

  const updatedAt = new Date(material.updated_at).getTime();
  const ageMs = now.getTime() - updatedAt;
  return Number.isFinite(updatedAt) && ageMs >= 0 && ageMs <= windowHours * 60 * 60 * 1000;
}

export function createDatabase(databaseUrl) {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl:
      /localhost|127\.0\.0\.1|\.railway\.internal/.test(databaseUrl)
        ? false
        : { rejectUnauthorized: false },
  });

  return {
    async migrate() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS materials (
          id BIGSERIAL PRIMARY KEY,
          source_id TEXT NOT NULL,
          source_name TEXT NOT NULL,
          discovery_method TEXT NOT NULL,
          url TEXT NOT NULL,
          normalized_url TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          normalized_title TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          content_hash TEXT,
          status TEXT NOT NULL,
          status_reason TEXT,
          preliminary_categories JSONB NOT NULL DEFAULT '[]',
          ai_decision JSONB,
          editor_text TEXT,
          publish_attempts INTEGER NOT NULL DEFAULT 0,
          last_publish_error TEXT,
          next_publish_at TIMESTAMPTZ,
          published_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS materials_status_idx ON materials(status);
        CREATE INDEX IF NOT EXISTS materials_title_idx ON materials(normalized_title);
        CREATE INDEX IF NOT EXISTS materials_hash_idx ON materials(content_hash);
        ALTER TABLE materials ADD COLUMN IF NOT EXISTS publish_attempts INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE materials ADD COLUMN IF NOT EXISTS last_publish_error TEXT;
        ALTER TABLE materials ADD COLUMN IF NOT EXISTS next_publish_at TIMESTAMPTZ;
        ALTER TABLE materials ADD COLUMN IF NOT EXISTS story_key TEXT;
        ALTER TABLE materials ADD COLUMN IF NOT EXISTS source_quality TEXT;
        ALTER TABLE materials ADD COLUMN IF NOT EXISTS context_basis TEXT;
        ALTER TABLE materials ADD COLUMN IF NOT EXISTS professional_context_uk TEXT;
        ALTER TABLE materials ADD COLUMN IF NOT EXISTS public_description_uk TEXT;
        CREATE INDEX IF NOT EXISTS materials_story_key_idx ON materials(story_key);
        CREATE INDEX IF NOT EXISTS materials_source_quality_idx ON materials(source_quality);
        CREATE TABLE IF NOT EXISTS source_health (
          source_id TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'recovered',
          consecutive_permanent_failures INTEGER NOT NULL DEFAULT 0,
          last_status_code INTEGER,
          last_error TEXT,
          cooldown_until TIMESTAMPTZ,
          last_failure_at TIMESTAMPTZ,
          last_recovered_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    },

    async listForDedup(limit = 1000) {
      const { rows } = await pool.query(
        `SELECT id, url, title, content, story_key FROM materials ORDER BY id DESC LIMIT $1`,
        [limit],
      );
      return rows;
    },

    async saveMaterial(material) {
      const storyKey = material.storyKey ?? material.story_key ?? createStoryKey(material);
      const sourceQuality = material.sourceQuality ?? material.source_quality ?? inferSourceQuality(material);
      const { rows } = await pool.query(
        `INSERT INTO materials (
           source_id, source_name, discovery_method, url, normalized_url,
           title, normalized_title, content, content_hash, status,
           status_reason, preliminary_categories, ai_decision, story_key,
           source_quality, context_basis, professional_context_uk, public_description_uk
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (normalized_url) DO UPDATE SET
           updated_at = NOW(),
           status_reason = EXCLUDED.status_reason,
           story_key = COALESCE(materials.story_key, EXCLUDED.story_key),
           source_quality = COALESCE(materials.source_quality, EXCLUDED.source_quality),
           context_basis = COALESCE(materials.context_basis, EXCLUDED.context_basis),
           professional_context_uk = COALESCE(materials.professional_context_uk, EXCLUDED.professional_context_uk),
           public_description_uk = COALESCE(materials.public_description_uk, EXCLUDED.public_description_uk)
         RETURNING *`,
        [
          material.sourceId,
          material.sourceName,
          material.discoveryMethod,
          material.url,
          normalizeUrl(material.url),
          material.title,
          normalizeTitle(material.title),
          material.content ?? "",
          material.content ? contentHash(material.content) : null,
          material.status,
          material.statusReason ?? null,
          JSON.stringify(material.preliminaryCategories ?? []),
          material.aiDecision ? JSON.stringify(material.aiDecision) : null,
          storyKey,
          sourceQuality,
          material.contextBasis ?? material.context_basis ?? null,
          material.professionalContextUk ?? material.professional_context_uk ?? null,
          material.publicDescriptionUk ?? material.public_description_uk ?? null,
        ],
      );
      return rows[0];
    },

    async getQueue(limit = 20) {
      const { rows } = await pool.query(
        `SELECT * FROM materials
         WHERE status = 'queued'
           AND (next_publish_at IS NULL OR next_publish_at <= NOW())
         ORDER BY
           CASE WHEN ai_decision->>'normativeAct' = 'true' OR ai_decision->>'normative_act' = 'true' THEN 0 ELSE 1 END,
           CASE COALESCE(ai_decision->>'materialCategory', ai_decision->>'sourceCategory')
             WHEN 'regulator' THEN 1
             WHEN 'government' THEN 2
             WHEN 'parliament' THEN 3
             WHEN 'personnel_change' THEN 4
             WHEN 'association' THEN 4
             WHEN 'donor' THEN 5
             WHEN 'international_tech' THEN 6
             WHEN 'vodokanal' THEN 7
             WHEN 'general_news' THEN 8
             WHEN 'local_media' THEN 9
             ELSE 8
           END,
           CASE ai_decision->>'priorityLevel'
             WHEN 'high' THEN 0
             WHEN 'medium' THEN 1
             WHEN 'low' THEN 2
             ELSE 1
           END,
           (ai_decision->>'priorityScore')::int DESC NULLS LAST,
           (ai_decision->>'importance')::int DESC NULLS LAST,
           id ASC
         LIMIT $1`,
        [limit],
      );
      return rows;
    },

    async retryFailedPublications(windowHours = 48) {
      const { rows } = await pool.query(
        `SELECT id, url, status, ai_decision, published_at, updated_at
         FROM materials
         WHERE status IN ('rejected_publish', 'publish_failed')
           AND updated_at >= NOW() - ($1 * INTERVAL '1 hour')`,
        [windowHours],
      );
      const ids = rows
        .filter((material) => isRetryableFailedPublication(material, { windowHours }))
        .map((material) => material.id);
      if (ids.length === 0) return 0;

      const result = await pool.query(
        `UPDATE materials SET
           status='queued',
           status_reason='Requeued by admin after publication failure',
           next_publish_at=NULL,
           updated_at=NOW()
         WHERE id = ANY($1::bigint[])
           AND status IN ('rejected_publish', 'publish_failed')
           AND published_at IS NULL`,
        [ids],
      );
      return result.rowCount;
    },

    async countPublishedToday(timeZone = "Europe/Kyiv") {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count FROM materials
         WHERE status='published'
           AND published_at >= (
             date_trunc('day', NOW() AT TIME ZONE $1)
             AT TIME ZONE $1
           )`,
        [timeZone],
      );
      return rows[0].count;
    },

    async releaseDryRunMaterials() {
      const { rowCount } = await pool.query(
        `UPDATE materials SET status='queued',
           status_reason='Released after DRY_RUN was disabled',
           next_publish_at=NULL,
           updated_at=NOW()
         WHERE status='dry_run'`,
      );
      return rowCount;
    },

    async recordPublishFailure(id, error, retryAt, terminal = false) {
      const { rows } = await pool.query(
        `UPDATE materials SET
           publish_attempts=publish_attempts+1,
           last_publish_error=$2,
           next_publish_at=$3,
           status=CASE WHEN $4 THEN 'rejected_publish' ELSE status END,
           status_reason=CASE WHEN $4 THEN $2 ELSE status_reason END,
           updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [id, error, retryAt, terminal],
      );
      return rows[0] ?? null;
    },

    async getDailyStats() {
      const { rows } = await pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM materials
         WHERE updated_at >= NOW() - INTERVAL '24 hours'
         GROUP BY status ORDER BY status`,
      );
      return Object.fromEntries(rows.map((row) => [row.status, row.count]));
    },

    async getPublished(limit = 10) {
      const { rows } = await pool.query(
        `SELECT * FROM materials WHERE status = 'published'
         ORDER BY published_at DESC NULLS LAST, id DESC LIMIT $1`,
        [limit],
      );
      return rows;
    },

    async getDailyDigestMaterials() {
      const { rows } = await pool.query(
        `SELECT * FROM materials
         WHERE status IN ('published', 'queued', 'dry_run', 'digest_only')
           AND updated_at >= NOW() - INTERVAL '24 hours'
         ORDER BY
           CASE WHEN ai_decision->>'normativeAct' = 'true' OR ai_decision->>'normative_act' = 'true' THEN 0 ELSE 1 END,
           CASE COALESCE(ai_decision->>'materialCategory', ai_decision->>'sourceCategory')
             WHEN 'regulator' THEN 1
             WHEN 'government' THEN 2
             WHEN 'parliament' THEN 3
             WHEN 'association' THEN 4
             WHEN 'donor' THEN 5
             WHEN 'international_tech' THEN 6
             WHEN 'vodokanal' THEN 7
             WHEN 'general_news' THEN 8
             WHEN 'local_media' THEN 9
             ELSE 8
           END,
           CASE ai_decision->>'priorityLevel'
             WHEN 'high' THEN 0
             WHEN 'medium' THEN 1
             WHEN 'low' THEN 2
             ELSE 1
           END,
           (ai_decision->>'priorityScore')::int DESC NULLS LAST,
           updated_at DESC
         LIMIT 60`,
      );
      return rows;
    },

    async getWeeklyAnalysisMaterials() {
      const { rows } = await pool.query(
        `SELECT * FROM materials
         WHERE status IN ('published', 'queued', 'dry_run', 'digest_only')
           AND updated_at >= NOW() - INTERVAL '7 days'
         ORDER BY
           CASE WHEN ai_decision->>'normativeAct' = 'true' OR ai_decision->>'normative_act' = 'true' THEN 0 ELSE 1 END,
           CASE COALESCE(ai_decision->>'materialCategory', ai_decision->>'sourceCategory')
             WHEN 'regulator' THEN 1
             WHEN 'government' THEN 2
             WHEN 'parliament' THEN 3
             WHEN 'personnel_change' THEN 4
             WHEN 'association' THEN 5
             WHEN 'donor' THEN 6
             WHEN 'international_tech' THEN 7
             WHEN 'vodokanal' THEN 8
             WHEN 'general_news' THEN 9
             WHEN 'local_media' THEN 10
             ELSE 9
           END,
           (ai_decision->>'priorityScore')::int DESC NULLS LAST,
           updated_at DESC
         LIMIT 120`,
      );
      return rows;
    },

    async getById(id) {
      const { rows } = await pool.query(`SELECT * FROM materials WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },

    async setStatus(id, status, reason = null) {
      const { rows } = await pool.query(
        `UPDATE materials SET status=$2, status_reason=$3,
          published_at=CASE WHEN $2='published' THEN NOW() ELSE published_at END,
          updated_at=NOW() WHERE id=$1 RETURNING *`,
        [id, status, reason],
      );
      return rows[0] ?? null;
    },

    async setEditorText(id, text) {
      const { rows } = await pool.query(
        `UPDATE materials SET editor_text=$2, status='queued', updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [id, text],
      );
      return rows[0] ?? null;
    },

    async setPublicDescription(id, text) {
      const { rows } = await pool.query(
        `UPDATE materials SET public_description_uk=$2, updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [id, text],
      );
      return rows[0] ?? null;
    },

    async getSourceHealth(sourceId) {
      const { rows } = await pool.query(`SELECT * FROM source_health WHERE source_id=$1`, [sourceId]);
      return rows[0] ?? null;
    },

    async isSourceInCooldown(sourceId, now = new Date()) {
      const health = await this.getSourceHealth(sourceId);
      return Boolean(health?.cooldown_until && new Date(health.cooldown_until) > now);
    },

    async recordSourceFetchSuccess(sourceId) {
      const previous = await this.getSourceHealth(sourceId);
      await pool.query(
        `INSERT INTO source_health (
           source_id, status, consecutive_permanent_failures, cooldown_until, last_recovered_at, updated_at
         ) VALUES ($1,'recovered',0,NULL,NOW(),NOW())
         ON CONFLICT (source_id) DO UPDATE SET
           status='recovered',
           consecutive_permanent_failures=0,
           cooldown_until=NULL,
           last_recovered_at=NOW(),
           updated_at=NOW()`,
        [sourceId],
      );
      return previous && previous.status !== "recovered" ? "recovered" : "ok";
    },

    async recordSourceFetchFailure(
      sourceId,
      { status = "transient_failure", statusCode = null, error = "", threshold = 3, cooldownHours = 168 } = {},
    ) {
      const permanent = status === "permanent_failure" || status === "blocked";
      const cooldownExpression = permanent
        ? `CASE WHEN source_health.consecutive_permanent_failures + 1 >= $5 THEN NOW() + ($6 * INTERVAL '1 hour') ELSE source_health.cooldown_until END`
        : `source_health.cooldown_until`;
      const { rows } = await pool.query(
        `INSERT INTO source_health (
           source_id, status, consecutive_permanent_failures, last_status_code, last_error,
           cooldown_until, last_failure_at, updated_at
         ) VALUES ($1,$2,CASE WHEN $3 THEN 1 ELSE 0 END,$4,$7,NULL,NOW(),NOW())
         ON CONFLICT (source_id) DO UPDATE SET
           status=$2,
           consecutive_permanent_failures=CASE WHEN $3 THEN source_health.consecutive_permanent_failures + 1 ELSE 0 END,
           last_status_code=$4,
           last_error=$7,
           cooldown_until=${cooldownExpression},
           last_failure_at=NOW(),
           updated_at=NOW()
         RETURNING *`,
        [sourceId, status, permanent, statusCode, threshold, cooldownHours, String(error).slice(0, 500)],
      );
      return rows[0];
    },

    close: () => pool.end(),
  };
}
