import pg from "pg";

try {
  process.loadEnvFile();
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const { Pool } = pg;
const repairPool = new Pool({
  connectionString: databaseUrl,
  ssl: /localhost|127\.0\.0\.1|\.railway\.internal/.test(databaseUrl)
    ? false
    : { rejectUnauthorized: false },
});

async function repairDatabase() {
  await repairPool.query(`
    CREATE TABLE IF NOT EXISTS runtime_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE OR REPLACE FUNCTION preserve_material_timestamp_for_duplicate()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.status_reason LIKE 'Duplicate by %' THEN
        NEW.updated_at := OLD.updated_at;
        NEW.status_reason := OLD.status_reason;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS materials_preserve_duplicate_timestamp ON materials;
    CREATE TRIGGER materials_preserve_duplicate_timestamp
    BEFORE UPDATE ON materials
    FOR EACH ROW
    EXECUTE FUNCTION preserve_material_timestamp_for_duplicate();

    CREATE OR REPLACE FUNCTION discard_nonblocking_material_row()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.status IN (
        'duplicate',
        'filtered_out',
        'rejected_source',
        'rejected_ai_error'
      ) THEN
        RETURN NULL;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS materials_discard_nonblocking_insert ON materials;
    CREATE TRIGGER materials_discard_nonblocking_insert
    BEFORE INSERT ON materials
    FOR EACH ROW
    EXECUTE FUNCTION discard_nonblocking_material_row();
  `);

  const normalized = await repairPool.query(`
    UPDATE materials
    SET updated_at = COALESCE(published_at, created_at)
    WHERE status IN ('published', 'digest_only', 'dry_run')
      AND status_reason LIKE 'Duplicate by %'
  `);

  const removedNonblockingRows = await repairPool.query(`
    DELETE FROM materials
    WHERE published_at IS NULL
      AND status IN (
        'duplicate',
        'filtered_out',
        'rejected_source',
        'rejected_ai_error'
      )
  `);

  const policyMigration = await repairPool.query(`
    INSERT INTO runtime_migrations(name)
    VALUES ('2026-08-26-release-pre-broad-policy-rejected-ai')
    ON CONFLICT (name) DO NOTHING
    RETURNING name
  `);
  let releasedOldRejectedAi = 0;
  if (policyMigration.rowCount > 0) {
    const released = await repairPool.query(`
      DELETE FROM materials
      WHERE status = 'rejected_ai'
        AND published_at IS NULL
        AND created_at >= NOW() - INTERVAL '14 days'
    `);
    releasedOldRejectedAi = released.rowCount;
  }

  // Earlier direct discovery scanned the association homepage. That page contains
  // static category/navigation pages and old archive content with no publication
  // date, which filled the queue and the channel. Drop only unpublished rows from
  // that obsolete discovery path; the corrected /blog/ archive will rediscover
  // genuinely fresh association news with a date.
  const associationMigration = await repairPool.query(`
    INSERT INTO runtime_migrations(name)
    VALUES ('2026-08-26-reset-undated-ukrvodokanal-homepage-discovery')
    ON CONFLICT (name) DO NOTHING
    RETURNING name
  `);
  let removedAssociationBacklog = 0;
  if (associationMigration.rowCount > 0) {
    const removed = await repairPool.query(`
      DELETE FROM materials
      WHERE source_id = 'ukrvodokanal'
        AND published_at IS NULL
        AND discovery_method IN ('official', 'official_sitemap')
    `);
    removedAssociationBacklog = removed.rowCount;
  }

  const requeuedOldThreshold = await repairPool.query(`
    WITH candidates AS (
      SELECT id
      FROM materials
      WHERE status = 'rejected_ai'
        AND published_at IS NULL
        AND created_at >= NOW() - INTERVAL '7 days'
        AND COALESCE((ai_decision->>'relevanceScore')::int, 0) >= 70
        AND COALESCE((ai_decision->>'confidenceScore')::int, 0) >= 70
        AND COALESCE(ai_decision->>'category', 'other') <> 'other'
        AND (
          status_reason LIKE 'Релевантність нижче 85%'
          OR status_reason LIKE 'Рівень довіри нижче 85%'
        )
      ORDER BY created_at DESC
      LIMIT 18
    )
    UPDATE materials
    SET status = 'queued',
        status_reason = 'Requeued after relevance threshold correction',
        next_publish_at = NULL,
        last_publish_error = NULL,
        publish_attempts = 0,
        updated_at = NOW()
    WHERE id IN (SELECT id FROM candidates)
  `);

  const requeuedDigest = await repairPool.query(`
    WITH candidates AS (
      SELECT id
      FROM materials
      WHERE status = 'digest_only'
        AND published_at IS NULL
        AND created_at >= NOW() - INTERVAL '7 days'
        AND length(content) >= 180
        AND COALESCE(context_basis, '') <> 'title_only'
        AND status_reason IN (
          'insufficient_public_context',
          'generated_description_too_short',
          'invalid_sentence_count',
          'public_description_validation_failed',
          'insufficient_compact_public_context'
        )
      ORDER BY
        CASE ai_decision->>'priorityLevel'
          WHEN 'high' THEN 0
          WHEN 'medium' THEN 1
          WHEN 'low' THEN 2
          ELSE 1
        END,
        created_at DESC
      LIMIT 18
    )
    UPDATE materials
    SET status = 'queued',
        status_reason = 'Requeued for grounded compact publication',
        public_description_uk = NULL,
        next_publish_at = NULL,
        last_publish_error = NULL,
        publish_attempts = 0,
        updated_at = NOW()
    WHERE id IN (SELECT id FROM candidates)
  `);

  console.log(
    [
      `Runtime repair complete: normalized stale digest rows=${normalized.rowCount}`,
      `removed nonblocking dedup rows=${removedNonblockingRows.rowCount}`,
      `released old-policy AI rejects=${releasedOldRejectedAi}`,
      `removed association homepage backlog=${removedAssociationBacklog}`,
      `requeued old-threshold AI news=${requeuedOldThreshold.rowCount}`,
      `requeued digest news=${requeuedDigest.rowCount}`,
    ].join(", "),
  );
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async function resilientFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const isTelegram = url.startsWith("https://api.telegram.org/");
  if (!isTelegram) return originalFetch(input, init);

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const timeoutSignal = AbortSignal.timeout(50_000);
      const signal = init.signal
        ? AbortSignal.any([init.signal, timeoutSignal])
        : timeoutSignal;
      return await originalFetch(input, { ...init, signal });
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError;
};

try {
  await repairDatabase();
} finally {
  await repairPool.end();
}
await import("./index.js");
