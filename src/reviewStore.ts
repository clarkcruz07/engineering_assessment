import { PGlite } from '@electric-sql/pglite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './database.ts';
import type { Assessment } from './review.ts';

/**
 * Application-owned review state. Separate PGlite data directory from the evidence
 * working copy, so resetting/rebuilding evidence never touches saved reviews.
 * Schema creation is idempotent; normal startup never drops or rewrites rows.
 * Decisions are append-only: the latest row is the case's current decision.
 */
export const DEFAULT_STORE_DIR = path.join(ROOT, '.runtime', 'review-store');

const SCHEMA = `
CREATE SCHEMA IF NOT EXISTS review;
CREATE TABLE IF NOT EXISTS review.cases (
  case_id text PRIMARY KEY,
  brand_id text NOT NULL, brand_name text NOT NULL, marketplace text NOT NULL,
  period_start date NOT NULL, period_end date NOT NULL,
  previous_start date NOT NULL, previous_end date NOT NULL,
  as_of timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, marketplace, period_start)
);
CREATE TABLE IF NOT EXISTS review.decisions (
  decision_id bigserial PRIMARY KEY,
  case_id text NOT NULL REFERENCES review.cases(case_id),
  decision text NOT NULL CHECK (decision IN ('hold', 'approve_expansion')),
  promotion_change_pct numeric NOT NULL CHECK (promotion_change_pct >= 0),
  reason text NOT NULL, next_action text NOT NULL,
  validation_outcome text NOT NULL,
  evidence_fingerprint text NOT NULL,
  supported_current integer, supported_previous integer, growth_pct double precision,
  source_ids jsonb NOT NULL, limitations jsonb NOT NULL,
  assessment jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS decisions_case_idx ON review.decisions (case_id, decision_id DESC);`;

export interface CaseRow {
  caseId: string; brandId: string; brandName: string; marketplace: string;
  periodStart: string; periodEnd: string; previousStart: string; previousEnd: string; asOf: string; createdAt: string;
}
export interface DecisionRow {
  decisionId: number; caseId: string; decision: 'hold' | 'approve_expansion'; promotionChangePct: number;
  reason: string; nextAction: string; validationOutcome: string; evidenceFingerprint: string;
  supportedCurrent: number | null; supportedPrevious: number | null; growthPct: number | null;
  sourceIds: string[]; limitations: string[]; assessment: Assessment; savedAt: string;
}
export interface NewDecision {
  caseId: string; decision: DecisionRow['decision']; promotionChangePct: number; reason: string; nextAction: string;
  validationOutcome: string; assessment: Assessment;
}

const iso = (v: unknown) => v instanceof Date ? v.toISOString() : String(v);
const toCase = (r: Record<string, unknown>): CaseRow => ({
  caseId: String(r.case_id), brandId: String(r.brand_id), brandName: String(r.brand_name), marketplace: String(r.marketplace),
  periodStart: String(r.period_start), periodEnd: String(r.period_end), previousStart: String(r.previous_start), previousEnd: String(r.previous_end),
  asOf: iso(r.as_of), createdAt: iso(r.created_at),
});
const toDecision = (r: Record<string, unknown>): DecisionRow => ({
  decisionId: Number(r.decision_id), caseId: String(r.case_id), decision: r.decision as DecisionRow['decision'],
  promotionChangePct: Number(r.promotion_change_pct), reason: String(r.reason), nextAction: String(r.next_action),
  validationOutcome: String(r.validation_outcome), evidenceFingerprint: String(r.evidence_fingerprint),
  supportedCurrent: r.supported_current == null ? null : Number(r.supported_current),
  supportedPrevious: r.supported_previous == null ? null : Number(r.supported_previous),
  growthPct: r.growth_pct == null ? null : Number(r.growth_pct),
  sourceIds: r.source_ids as string[], limitations: r.limitations as string[], assessment: r.assessment as Assessment, savedAt: iso(r.saved_at),
});
const CASE_COLS = `case_id, brand_id, brand_name, marketplace, period_start::text, period_end::text, previous_start::text, previous_end::text, as_of, created_at`;

export class ReviewStore {
  private constructor(private db: PGlite) {}

  static async open(dir = DEFAULT_STORE_DIR): Promise<ReviewStore> {
    await mkdir(dir, { recursive: true });
    const db = new PGlite({ dataDir: dir });
    await db.waitReady;
    await db.exec("SET TIME ZONE 'UTC'");
    await db.exec(SCHEMA);
    return new ReviewStore(db);
  }
  close(): Promise<void> { return this.db.close(); }

  async upsertCase(c: Omit<CaseRow, 'createdAt'>): Promise<CaseRow> {
    await this.db.query(`INSERT INTO review.cases (case_id, brand_id, brand_name, marketplace, period_start, period_end, previous_start, previous_end, as_of)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (case_id) DO NOTHING`,
      [c.caseId, c.brandId, c.brandName, c.marketplace, c.periodStart, c.periodEnd, c.previousStart, c.previousEnd, c.asOf]);
    return (await this.getCase(c.caseId))!;
  }
  async getCase(caseId: string): Promise<CaseRow | null> {
    const r = (await this.db.query<Record<string, unknown>>(`SELECT ${CASE_COLS} FROM review.cases WHERE case_id = $1`, [caseId])).rows[0];
    return r ? toCase(r) : null;
  }
  async listCases(): Promise<(CaseRow & { latest: Omit<DecisionRow, 'assessment' | 'limitations'> | null; decisionCount: number })[]> {
    const rows = (await this.db.query<Record<string, unknown>>(`
      SELECT ${CASE_COLS.split(', ').map(c => `c.${c}`).join(', ')}, d.decision_id, d.decision, d.promotion_change_pct, d.reason, d.next_action,
             d.validation_outcome, d.evidence_fingerprint, d.supported_current, d.supported_previous, d.growth_pct, d.source_ids, d.saved_at,
             (SELECT COUNT(*)::int FROM review.decisions x WHERE x.case_id = c.case_id) AS decision_count
      FROM review.cases c
      LEFT JOIN LATERAL (SELECT * FROM review.decisions d WHERE d.case_id = c.case_id ORDER BY decision_id DESC LIMIT 1) d ON true
      ORDER BY COALESCE(d.saved_at, c.created_at) DESC`)).rows;
    return rows.map(r => {
      const { assessment: _a, limitations: _l, ...latest } = toDecision({ ...r, assessment: null, limitations: [] });
      return { ...toCase(r), latest: r.decision_id == null ? null : latest, decisionCount: Number(r.decision_count) };
    });
  }
  async decisions(caseId: string): Promise<DecisionRow[]> {
    return (await this.db.query<Record<string, unknown>>('SELECT * FROM review.decisions WHERE case_id = $1 ORDER BY decision_id DESC', [caseId])).rows.map(toDecision);
  }
  async insertDecision(d: NewDecision): Promise<DecisionRow> {
    const a = d.assessment;
    const [row] = (await this.db.query<Record<string, unknown>>(`
      INSERT INTO review.decisions (case_id, decision, promotion_change_pct, reason, next_action, validation_outcome, evidence_fingerprint,
        supported_current, supported_previous, growth_pct, source_ids, limitations, assessment)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [d.caseId, d.decision, d.promotionChangePct, d.reason, d.nextAction, d.validationOutcome, a.fingerprint,
        a.current.supported.value, a.previous.supported.value, a.growth.exactPct,
        JSON.stringify(a.sourceIds), JSON.stringify(a.limitations), JSON.stringify(a)])).rows;
    return toDecision(row);
  }
}
