import type { PGlite } from '@electric-sql/pglite';
import { AS_OF, queryRows } from './database.ts';
import { assessScope, PERIODS, POLICY, type Assessment } from './review.ts';
import { DEFAULT_EXPORTS_DIR } from './publisher.ts';
import { ReviewStore, type CaseRow, type DecisionRow } from './reviewStore.ts';

/** Backend review workflow shared by the Next.js route handlers and the tests. */
export class ServiceError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

export type EvidenceStatus = 'no_decision' | 'current' | 'changed';
export interface CaseView {
  case: CaseRow; assessment: Assessment; latestDecision: DecisionRow | null;
  history: Omit<DecisionRow, 'assessment'>[]; evidenceStatus: EvidenceStatus;
}
export interface ClientReport {
  caseId: string; status: 'current' | 'requires_attention'; statusMessage: string;
  brandName: string; marketplace: string; period: { start: string; end: string }; previousPeriod: { start: string; end: string };
  generatedFrom: { decisionId: number; savedAt: string; evidenceFingerprint: string; asOf: string };
  headline: string;
  figures: { label: string; value: string; note: string }[];
  interpretation: string;
  decision: { label: string; promotionChangePct: number; reason: string };
  limitations: string[]; nextAction: string;
  sources: { id: string; description: string }[];
}

export const caseIdFor = (brandId: string, marketplace: string, periodStart = PERIODS.current.start) =>
  `${brandId}--${marketplace}--${periodStart}`.toLowerCase();

const fmt = (n: number | null) => n === null ? 'Unknown' : n.toLocaleString('en-US');
const ts = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;
const pct = (n: number | null) => n === null ? null : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

export function createReviewService(deps: { evidenceDb: PGlite; store: ReviewStore; exportsDir?: string; asOf?: string }) {
  const { evidenceDb: db, store } = deps;
  const exportsDir = deps.exportsDir ?? DEFAULT_EXPORTS_DIR;
  const asOf = deps.asOf ?? AS_OF;
  const assess = (brandId: string, marketplace: string) => assessScope(db, brandId, marketplace, { asOf, exportsDir });

  async function listScopes() {
    return queryRows<{ brandId: string; brandName: string; marketplace: string }>(db, `
      SELECT DISTINCT r.brand_id AS "brandId", b.name AS "brandName", r.marketplace
      FROM raw.subscription_reports r JOIN brands b USING (brand_id) ORDER BY 2, 3`);
  }

  async function view(c: CaseRow): Promise<CaseView> {
    const assessment = await assess(c.brandId, c.marketplace);
    const history = await store.decisions(c.caseId);
    const latestDecision = history[0] ?? null;
    return {
      case: c, assessment, latestDecision,
      history: history.map(({ assessment: _a, ...rest }) => rest),
      evidenceStatus: !latestDecision ? 'no_decision' : latestDecision.evidenceFingerprint === assessment.fingerprint ? 'current' : 'changed',
    };
  }

  async function requireCase(caseId: string): Promise<CaseRow> {
    const c = await store.getCase(caseId);
    if (!c) throw new ServiceError(404, 'CASE_NOT_FOUND', `Review case "${caseId}" does not exist. Open a review from the scope selector.`);
    return c;
  }

  return {
    asOf, periods: PERIODS,
    listScopes,
    listCases: () => store.listCases(),

    async openCase(input: unknown): Promise<CaseView> {
      const { brandId, marketplace } = (input ?? {}) as Record<string, unknown>;
      if (typeof brandId !== 'string' || typeof marketplace !== 'string')
        throw new ServiceError(400, 'INVALID_SCOPE', 'Choose a brand and a marketplace.');
      const scope = (await listScopes()).find(s => s.brandId === brandId && s.marketplace === marketplace);
      if (!scope) throw new ServiceError(404, 'UNKNOWN_SCOPE', `No subscription data exists for ${brandId} in ${marketplace}.`);
      const c = await store.upsertCase({
        caseId: caseIdFor(brandId, marketplace), brandId, brandName: scope.brandName, marketplace,
        periodStart: PERIODS.current.start, periodEnd: PERIODS.current.end,
        previousStart: PERIODS.previous.start, previousEnd: PERIODS.previous.end, asOf,
      });
      return view(c);
    },

    async getCase(caseId: string): Promise<CaseView> { return view(await requireCase(caseId)); },

    /** Validates and persists a decision. Every eligibility fact is recomputed here; the request supplies only intent and text. */
    async saveDecision(caseId: string, input: unknown): Promise<CaseView> {
      const c = await requireCase(caseId);
      const body = (input ?? {}) as Record<string, unknown>;
      const decision = body.decision;
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      const nextAction = typeof body.nextAction === 'string' ? body.nextAction.trim() : '';
      const reviewed = typeof body.reviewedFingerprint === 'string' ? body.reviewedFingerprint : '';
      const problems: string[] = [];
      if (decision !== 'hold' && decision !== 'approve_expansion') problems.push('Decision must be "hold" or "approve_expansion".');
      if (reason.length < 10) problems.push('Give a reason of at least 10 characters.');
      if (reason.length > 2000) problems.push('Keep the reason under 2,000 characters.');
      if (nextAction.length < 5) problems.push('Describe the next action (at least 5 characters).');
      if (nextAction.length > 500) problems.push('Keep the next action under 500 characters.');
      if (!reviewed) problems.push('The reviewed evidence fingerprint is missing; reload the case.');
      if (problems.length) throw new ServiceError(400, 'INVALID_DECISION', problems.join(' '), { problems });

      const assessment = await assess(c.brandId, c.marketplace);
      if (reviewed !== assessment.fingerprint)
        throw new ServiceError(409, 'EVIDENCE_CHANGED', 'The evidence changed after you reviewed it. Revalidate the evidence and review the updated figures before saving.', { currentFingerprint: assessment.fingerprint });
      if (decision === 'approve_expansion' && !assessment.policy.eligibleForExpansion)
        throw new ServiceError(422, 'APPROVAL_NOT_SUPPORTED', `Approval rejected: ${assessment.policy.explanation} Save a hold decision instead.`, { blockingReasons: assessment.policy.blockingReasons, growthPct: assessment.growth.exactPct });

      await store.insertDecision({
        caseId, decision: decision as 'hold' | 'approve_expansion',
        promotionChangePct: decision === 'approve_expansion' ? POLICY.expansionPct : 0,
        reason, nextAction,
        validationOutcome: assessment.policy.eligibleForExpansion ? 'expansion_supported' : assessment.policy.blockingReasons.length ? 'evidence_insufficient' : 'below_threshold',
        assessment,
      });
      return view(c);
    },

    /** Builds the client report from the latest saved decision and the evidence it reviewed. */
    async generateReport(caseId: string): Promise<ClientReport> {
      const c = await requireCase(caseId);
      const v = await view(c);
      const d = v.latestDecision;
      if (!d) throw new ServiceError(409, 'NO_DECISION', 'Save a review decision before generating the client report.');
      const a = d.assessment;
      const changed = v.evidenceStatus === 'changed';
      const cur = a.current.supported, prev = a.previous.supported;
      const figures = [
        { label: `Active subscriptions, ${a.periods.current.start} to ${a.periods.current.end}`, value: fmt(cur.value),
          note: cur.value === null ? 'No publisher report available.' : cur.complete ? `Complete snapshot (${cur.publisherReportId}).` : `Partial snapshot covering ${a.periods.current.start} to ${cur.coverageEnd} (${cur.publisherReportId}).` },
        { label: `Active subscriptions, ${a.periods.previous.start} to ${a.periods.previous.end}`, value: fmt(prev.value),
          note: prev.value === null ? 'No publisher report available.' : prev.complete ? `Complete snapshot (${prev.publisherReportId}).` : `Partial snapshot (${prev.publisherReportId}).` },
        { label: 'Week-over-week change', value: a.growth.exactPct === null ? 'Not reported' : pct(a.growth.exactPct)!, note: a.growth.note },
      ];
      const interpretation = a.growth.exactPct !== null
        ? `Active subscription enrollments moved from ${fmt(prev.value)} to ${fmt(cur.value)} between complete weekly snapshots (${pct(a.growth.exactPct)}). These count product-offer enrollments, not unique customers.`
        : cur.value !== null && !cur.complete
          ? `The publisher has only issued a partial report for the requested week (through ${cur.coverageEnd}), showing ${fmt(cur.value)} active enrollments. Weekly growth is not reported until a complete snapshot is available.`
          : 'Weekly growth cannot be reported from the available publisher evidence.';
      return {
        caseId, status: changed ? 'requires_attention' : 'current',
        statusMessage: changed
          ? `Requires attention: the source evidence changed after decision #${d.decisionId} was saved. This report shows the reviewed evidence; revalidate and save a new decision before sharing it.`
          : `Generated from saved decision #${d.decisionId}; the source evidence is unchanged since review.`,
        brandName: c.brandName, marketplace: c.marketplace,
        period: a.periods.current, previousPeriod: a.periods.previous,
        generatedFrom: { decisionId: d.decisionId, savedAt: d.savedAt, evidenceFingerprint: d.evidenceFingerprint, asOf: a.asOf },
        headline: d.decision === 'approve_expansion'
          ? `Subscriptions grew ${pct(a.growth.exactPct)} on complete snapshots; a ${d.promotionChangePct}% promotion expansion is proposed for your review.`
          : `Promotion held at its current level. ${a.growth.exactPct !== null ? `Subscriptions changed ${pct(a.growth.exactPct)} week over week.` : 'Weekly growth is not yet supported by complete evidence.'}`,
        figures, interpretation,
        decision: { label: d.decision === 'approve_expansion' ? `Suggest ${d.promotionChangePct}% promotion expansion (draft for brand-manager approval)` : 'Hold the current promotion', promotionChangePct: d.promotionChangePct, reason: d.reason },
        limitations: d.limitations, nextAction: d.nextAction,
        sources: [a.current, a.previous].flatMap(p => [
          ...(p.publisher.selected ? [{ id: p.publisher.selected.publisherReportId, description: `Publisher ${p.publisher.selected.status} report, ${p.period.start} to ${p.publisher.selected.periodEnd}, generated ${ts(p.publisher.selected.generatedAt)}, ${p.publisher.selected.offerRows} offers` }] : []),
          ...(p.internal.selected ? [{ id: p.internal.selected.reportId, description: `Internal import r${p.internal.selected.revision}, extracted ${ts(p.internal.selected.extractedAt)}, reconciliation: ${p.reconciliation.status}` }] : []),
        ]),
      };
    },
  };
}
export type ReviewService = ReturnType<typeof createReviewService>;
