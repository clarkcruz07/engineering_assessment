import { PGlite } from '@electric-sql/pglite';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Resolved without `new URL(..., import.meta.url)` so bundlers (Next.js) do not treat it as an asset.
function projectRoot(): string {
  const candidates = [process.env.ASSESSMENT_ROOT, path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), process.cwd()];
  for (const dir of candidates) if (dir && existsSync(path.join(dir, 'data', 'manifest.json'))) return dir + path.sep;
  throw new Error('Cannot locate the project directory. Run commands from the engineering-assessment folder or set ASSESSMENT_ROOT.');
}
export const ROOT = projectRoot();
export const AS_OF = '2026-10-06T12:00:00Z';
export const PERIOD_START = '2026-09-28';
export const PERIOD_END = '2026-10-04';
export const PREVIOUS_START = '2026-09-21';

export async function openDatabase(memory = false, runtime = path.join(ROOT, '.runtime', 'marketplace')): Promise<PGlite> {
  if (!memory) await mkdir(path.dirname(runtime), { recursive: true });
  let initialized = false;
  if (!memory) {
    try { initialized = (await stat(path.join(runtime, 'PG_VERSION'))).isFile(); }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
  }
  const snapshot = initialized ? undefined : await readFile(path.join(ROOT, 'data', 'marketplace.pglite'));
  const db = new PGlite({
    ...(memory ? {} : { dataDir: runtime }),
    ...(snapshot ? { loadDataDir: new Blob([new Uint8Array(snapshot)]) } : {}),
  });
  await db.waitReady;
  await db.exec("SET TIME ZONE 'UTC'");
  return db;
}

export async function rebuildMetrics(db: PGlite, asOf = AS_OF): Promise<void> {
  const selection = await readFile(path.join(ROOT, 'sql', 'select-reports.sql'), 'utf8');
  await db.transaction(async tx => {
    await tx.exec('DELETE FROM marts.subscription_weekly');
    await tx.query(`
      INSERT INTO marts.subscription_weekly
      SELECT r.brand_id, r.marketplace, r.period_start,
             SUM(o.active_subscriptions), MAX(r.period_end), BOOL_AND(r.status = 'complete'),
             jsonb_agg(DISTINCT r.report_id), MAX(r.extracted_at)
      FROM (${selection}) r
      JOIN raw.subscription_offers o USING (report_id)
      GROUP BY r.brand_id, r.marketplace, r.period_start
    `, [asOf]);
  });
}

export async function queryRows<T>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}
