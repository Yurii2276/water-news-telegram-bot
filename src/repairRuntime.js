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
  `);

  const normalized = await repairPool.query(`
    UPDATE materials
    SET updated_at = COALESCE(published_at, created_at)
    WHERE status IN ('published', 'digest_only', 'dry_run')
      AND status_reason LIKE 'Duplicate by %'
  `);

  const removedDuplicateRows = await repairPool.query(`
    DELETE FROM materials
    WHERE status = 'duplicate'
      AND published_at IS NULL
  `);

  const reopenedTransientRows = await repairPool.query(`
    DELETE FROM materials
    WHERE published_at IS NULL
      AND created_at >= NOW() - INTERVAL '14 days'
      AND (
        status IN ('rejected_source', 'rejected_ai_error')
        OR (
          status = 'filtered_out'
          AND (
            status_reason LIKE 'Extraction error:%'
            OR status_reason IN (
              'Не вдалося визначити посилання на першоджерело',
              'Недостатньо тексту першоджерела'
            )
          )
        )
      )
  `);

  const recovered = await repairPool.query(`
    UPDATE materials
    SET status = 'queued',
        status_reason = 'Recovered after OpenAI quota restoration',
        next_publish_at = NULL,
        last_publish_error = NULL,
        publish_attempts = 0,
        updated_at = NOW()
    WHERE status = 'rejected_ai_error'
      AND published_at IS NULL
      AND length(content) >= 300
      AND created_at >= NOW() - INTERVAL '14 days'
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
      LIMIT 10
    )
    UPDATE materials
    SET status = 'queued',
        status_reason = 'Requeued for compact grounded publication',
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
      `removed duplicate-only rows=${removedDuplicateRows.rowCount}`,
      `reopened transient rows=${reopenedTransientRows.rowCount}`,
      `recovered AI-rejected news=${recovered.rowCount}`,
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
