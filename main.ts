import { rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, openDatabase, rebuildMetrics } from './src/database.ts';
import { analyse } from './src/analyst.ts';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [command] = args;
  if (command === 'reset') {
    await rm(path.join(ROOT, '.runtime', 'marketplace'), { recursive: true, force: true });
    console.log('Local working evidence database reset. The bundled snapshot and saved review cases are unchanged.');
    return;
  }
  if (command === 'reset-reviews') {
    await rm(path.join(ROOT, '.runtime', 'review-store'), { recursive: true, force: true });
    console.log('DESTRUCTIVE: all saved review cases and decisions were deleted.');
    return;
  }
  if (!['report', 'query'].includes(command ?? '')) throw new Error('Usage: npm run report -- --brand cedar-coast [--marketplace US] [--trace] [--json] | npm run query -- "SELECT ..."');
  const db = await openDatabase();
  try {
    if (command === 'query') {
      const sql = args.slice(1).join(' ');
      if (!sql.trim()) throw new Error('Provide a SQL query.');
      await db.exec('BEGIN READ ONLY');
      try { console.log(JSON.stringify((await db.query(sql)).rows, null, 2)); }
      finally { await db.exec('ROLLBACK'); }
      return;
    }
    const value = (key: string, fallback: string): string => {
      const index = args.indexOf(key);
      if (index < 0) return fallback;
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${key}`);
      return args[index + 1];
    };
    await rebuildMetrics(db);
    const result = await analyse(db, value('--brand', 'cedar-coast'), value('--marketplace', 'US'));
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else {
      const e = result.evidence;
      console.log(`\n${e.brandName} | ${e.marketplace} | ${e.periodStart} to ${e.expectedPeriodEnd}`);
      console.log(`Active subscriptions: ${e.activeSubscriptions?.toLocaleString('en-US') ?? 'unavailable'} | Previous: ${e.previousSubscriptions?.toLocaleString('en-US') ?? 'unavailable'}`);
      console.log(`Change: ${e.growthPct ?? 'unavailable'}% | Data quality: ${result.quality.status}`);
      console.log(`Net sales: $${e.netSales.toFixed(2)} | Attributed ROAS: ${e.roas ?? 'unavailable'} | Inventory units: ${e.inventoryUnits}`);
      console.log(`\n${result.recommendation.narrative}\n`);
      if (args.includes('--trace')) console.log(JSON.stringify({ ...result.trace, selectionSql: await readFile(path.join(ROOT, 'sql/select-reports.sql'), 'utf8') }, null, 2));
    }
  } finally { await db.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
