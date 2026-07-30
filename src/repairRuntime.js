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

  console.log(
    `Runtime repair complete: normalized stale digest rows=${normalized.rowCount}, recovered AI-rejected news=${recovered.rowCount}`,
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

await repairDatabase();
await import("./index.js");
