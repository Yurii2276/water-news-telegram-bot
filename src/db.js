import pg from "pg";

import { contentHash, isValidHttpUrl, normalizeTitle, normalizeUrl } from "./dedup.js";

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
      `);
    },

    async listForDedup(limit = 1000) {
      const { rows } = await pool.query(
        `SELECT id, url, title, content FROM materials ORDER BY id DESC LIMIT $1`,
        [limit],
      );
      return rows;
    },

    async saveMaterial(material) {
      const { rows } = await pool.query(
        `INSERT INTO materials (
           source_id, source_name, discovery_method, url, normalized_url,
           title, normalized_title, content, content_hash, status,
           status_reason, preliminary_categories, ai_decision
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (normalized_url) DO UPDATE SET
           updated_at = NOW(),
           status_reason = EXCLUDED.status_reason
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

    async countPublishedToday() {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count FROM materials
         WHERE status='published'
           AND published_at >= (
             date_trunc('day', NOW() AT TIME ZONE 'Europe/Kyiv')
             AT TIME ZONE 'Europe/Kyiv'
           )`,
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
         WHERE status IN ('published', 'queued', 'dry_run')
           AND updated_at >= NOW() - INTERVAL '24 hours'
         ORDER BY
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

    close: () => pool.end(),
  };
}
