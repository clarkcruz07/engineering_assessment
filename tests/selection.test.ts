import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AS_OF, ROOT, openDatabase, rebuildMetrics } from '../src/database.ts';

/**
 * Regression: a subscription report is a snapshot. The weekly mart must use exactly one
 * report per brand/marketplace/week and must agree with the publisher's current
 * (non-superseded) report, not with the highest internal import revision.
 * The oracle below reads the publisher exports directly and is independent of the SQL.
 */
function csv(file: string): Record<string, string>[] {
  const [header, ...lines] = readFileSync(path.join(ROOT, 'data', 'exports', file), 'utf8').trim().split(/\r?\n/);
  const keys = header.split(',');
  return lines.map(line => Object.fromEntries(line.split(',').map((v, i) => [keys[i], v])));
}

test('weekly mart selects one snapshot per scope and week instead of summing revisions', async () => {
  const exportsByScope = new Map<string, Record<string, string>[]>();
  for (const r of csv('subscription_reports.csv')) {
    if (Date.parse(r.generated_at) > Date.parse(AS_OF)) continue;
    const key = `${r.brand_id}|${r.marketplace}|${r.period_start}`;
    exportsByScope.set(key, [...(exportsByScope.get(key) ?? []), r]);
  }
  const db = await openDatabase(true);
  try {
    await rebuildMetrics(db);
    const mart = (await db.query<{ brand_id: string; marketplace: string; period_start: string; active_subscriptions: string; source_report_ids: string[] }>(
      `SELECT brand_id, marketplace, period_start::text, active_subscriptions::text, source_report_ids FROM marts.subscription_weekly`)).rows;
    assert.ok(mart.length > 0);
    let multiRevisionWeeks = 0;
    for (const row of mart) {
      assert.equal(row.source_report_ids.length, 1, `${row.brand_id} ${row.marketplace} ${row.period_start} combined ${row.source_report_ids.join(', ')}`);
      const [selected] = (await db.query<{ publisher_report_id: string; total: string }>(
        `SELECT r.publisher_report_id, SUM(o.active_subscriptions)::text AS total
         FROM raw.subscription_reports r JOIN raw.subscription_offers o USING (report_id)
         WHERE r.report_id = $1 GROUP BY r.publisher_report_id`, [row.source_report_ids[0]])).rows;
      assert.equal(row.active_subscriptions, selected.total, 'mart total must equal the selected snapshot');
      const current = (exportsByScope.get(`${row.brand_id}|${row.marketplace}|${row.period_start}`) ?? [])
        .filter(r => !r.superseded_by);
      assert.equal(current.length, 1, 'fixture has one current publisher report per week');
      assert.equal(selected.publisher_report_id, current[0].publisher_report_id,
        `${row.brand_id} ${row.marketplace} ${row.period_start} must use the publisher's current report`);
      const [{ n }] = (await db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM raw.subscription_reports WHERE brand_id=$1 AND marketplace=$2 AND period_start=$3::date AND extracted_at <= $4::timestamptz`,
        [row.brand_id, row.marketplace, row.period_start, AS_OF])).rows;
      if (n > 1) multiRevisionWeeks++;
    }
    assert.ok(multiRevisionWeeks > 0, 'the fixture exercises weeks with several revisions');
  } finally { await db.close(); }
});
