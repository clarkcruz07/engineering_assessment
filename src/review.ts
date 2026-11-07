import { createHash } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { AS_OF, PERIOD_END, PERIOD_START, PREVIOUS_START, queryRows } from './database.ts';
import { loadPublisherExports, selectPublisherReport, DEFAULT_EXPORTS_DIR, type PublisherExports, type PublisherReport } from './publisher.ts';
import { retrieveKnowledge, type Document } from './knowledge.ts';
import { propose } from './model.ts';
import type { Evidence, Recommendation } from './types.ts';

/** Exercise policy (DATA_DICTIONARY.md). Applied by the backend; never taken from the model or the browser. */
export const POLICY = { version: 'subscription-promotion-v1', growthThresholdPct: 10, expansionPct: 10, maxImportAgeHours: 48 } as const;

export interface Period { start: string; end: string }
export const PERIODS: { current: Period; previous: Period } = {
  current: { start: PERIOD_START, end: PERIOD_END },
  previous: { start: PREVIOUS_START, end: addDays(PERIOD_START, -1) },
};

export interface InternalImport {
  reportId: string; publisherReportId: string; revision: number; status: string; periodEnd: string;
  extractedAt: string; generatedAt: string; declaredOfferCount: number; declaredActiveSubscriptions: number;
  offerRows: number; offerTotal: number; importFinishedAt: string | null; importStatus: string | null;
  selectedByPipeline: boolean; publisherSupersededBy: string | null;
}
export interface PeriodEvidence {
  label: 'current' | 'previous'; period: Period;
  internal: { reported: number | null; selected: InternalImport | null; imports: InternalImport[]; revisionSum: number | null };
  publisher: {
    selected: (PublisherReport & { offerTotal: number; offerRows: number }) | null;
    available: PublisherReport[];
  };
  reconciliation: {
    status: 'reconciled' | 'mismatch' | 'unavailable';
    sameReport: boolean; missingOffers: number; extraOffers: number; changedOffers: number;
    missingOfferExamples: string[]; delta: number | null;
  };
  /** The figure the application supports: the publisher's selected snapshot (unknown when absent). */
  supported: { value: number | null; complete: boolean; coverageEnd: string | null; publisherReportId: string | null };
}
export type Severity = 'blocking' | 'warning' | 'info';
export interface Finding { code: string; severity: Severity; title: string; detail: string; period?: 'current' | 'previous' }
export interface Assessment {
  scope: { brandId: string; brandName: string; marketplace: string };
  asOf: string; periods: typeof PERIODS; policyVersion: string;
  current: PeriodEvidence; previous: PeriodEvidence;
  freshness: { importedAt: string | null; ageHours: number | null; fresh: boolean; limitHours: number };
  growth: { comparable: boolean; exactPct: number | null; displayPct: string | null; change: number | null; note: string };
  internalPipeline: { current: number | null; previous: number | null; growthPct: number | null };
  findings: Finding[];
  policy: { eligibleForExpansion: boolean; permittedAction: 'expand_promotion' | 'hold'; permittedChangePct: number; headline: string; explanation: string; blockingReasons: string[] };
  model: { proposal: Recommendation; accepted: boolean; issues: string[] };
  notes: { id: string; source: string; text: string; citedByModel: boolean }[];
  limitations: string[];
  suggestedNextAction: string;
  sourceIds: string[];
  fingerprint: string;
}

export interface AssessOptions { asOf?: string; exportsDir?: string; exports?: PublisherExports; documents?: Document[] }

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
const iso = (v: unknown): string | null => v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
const fmt = (n: number) => n.toLocaleString('en-US');

async function internalImports(db: PGlite, brandId: string, marketplace: string, period: Period, asOf: string): Promise<InternalImport[]> {
  const rows = await queryRows<Record<string, unknown>>(db, `
    SELECT r.report_id, r.publisher_report_id, r.revision, r.status, r.period_end::text AS period_end,
           r.extracted_at, r.generated_at, r.declared_offer_count, r.declared_active_subscriptions,
           COALESCE(o.n, 0)::int AS offer_rows, COALESCE(o.total, 0)::bigint::text AS offer_total,
           i.finished_at, i.status AS import_status,
           COALESCE(w.source_report_ids ? r.report_id, false) AS selected
    FROM raw.subscription_reports r
    LEFT JOIN (SELECT report_id, COUNT(*) AS n, SUM(active_subscriptions) AS total FROM raw.subscription_offers GROUP BY report_id) o USING (report_id)
    LEFT JOIN LATERAL (SELECT finished_at, status FROM ingestion_runs x WHERE x.report_id = r.report_id ORDER BY finished_at DESC LIMIT 1) i ON true
    LEFT JOIN marts.subscription_weekly w ON w.brand_id = r.brand_id AND w.marketplace = r.marketplace AND w.period_start = r.period_start
    WHERE r.brand_id = $1 AND r.marketplace = $2 AND r.period_start = $3::date AND r.extracted_at <= $4::timestamptz
    ORDER BY r.revision`, [brandId, marketplace, period.start, asOf]);
  return rows.map(r => ({
    reportId: String(r.report_id), publisherReportId: String(r.publisher_report_id), revision: Number(r.revision),
    status: String(r.status), periodEnd: String(r.period_end), extractedAt: iso(r.extracted_at)!, generatedAt: iso(r.generated_at)!,
    declaredOfferCount: Number(r.declared_offer_count), declaredActiveSubscriptions: Number(r.declared_active_subscriptions),
    offerRows: Number(r.offer_rows), offerTotal: Number(r.offer_total), importFinishedAt: iso(r.finished_at),
    importStatus: r.import_status == null ? null : String(r.import_status), selectedByPipeline: Boolean(r.selected), publisherSupersededBy: null,
  }));
}

async function periodEvidence(db: PGlite, exp: PublisherExports, label: 'current' | 'previous', brandId: string, marketplace: string, period: Period, asOf: string): Promise<PeriodEvidence> {
  const imports = await internalImports(db, brandId, marketplace, period, asOf);
  const { selected: pub, available } = selectPublisherReport(exp.reports, brandId, marketplace, period.start, asOf);
  const byId = new Map(available.map(r => [r.publisherReportId, r]));
  for (const i of imports) {
    const sup = byId.get(i.publisherReportId)?.supersededBy;
    i.publisherSupersededBy = sup && byId.has(sup) ? sup : null;
  }
  const selected = imports.find(i => i.selectedByPipeline) ?? null;
  const pubOffers = pub ? exp.offersByReport.get(pub.publisherReportId) ?? [] : [];
  const publisherSelected = pub ? { ...pub, offerTotal: pubOffers.reduce((s, o) => s + o.activeSubscriptions, 0), offerRows: pubOffers.length } : null;

  let missing = 0, extra = 0, changed = 0; const missingExamples: string[] = [];
  if (selected && pub) {
    const internalOffers = await queryRows<{ offer_id: string; asin: string; active_subscriptions: number }>(db,
      'SELECT offer_id, asin, active_subscriptions FROM raw.subscription_offers WHERE report_id = $1', [selected.reportId]);
    const internalMap = new Map(internalOffers.map(o => [o.offer_id, o]));
    const pubIds = new Set(pubOffers.map(o => o.offerId));
    for (const o of pubOffers) {
      const i = internalMap.get(o.offerId);
      if (!i) { missing++; if (missingExamples.length < 5) missingExamples.push(o.offerId); }
      else if (i.active_subscriptions !== o.activeSubscriptions || i.asin !== o.asin) changed++;
    }
    for (const o of internalOffers) if (!pubIds.has(o.offer_id)) extra++;
  }
  const sameReport = Boolean(selected && pub && selected.publisherReportId === pub.publisherReportId);
  const reconciled = Boolean(selected && publisherSelected && sameReport && !missing && !extra && !changed && selected.offerTotal === publisherSelected.offerTotal);
  return {
    label, period,
    internal: { reported: selected ? selected.offerTotal : null, selected, imports, revisionSum: imports.length ? imports.reduce((s, i) => s + i.offerTotal, 0) : null },
    publisher: { selected: publisherSelected, available },
    reconciliation: {
      status: !selected || !publisherSelected ? 'unavailable' : reconciled ? 'reconciled' : 'mismatch',
      sameReport, missingOffers: missing, extraOffers: extra, changedOffers: changed, missingOfferExamples: missingExamples,
      delta: selected && publisherSelected ? selected.offerTotal - publisherSelected.offerTotal : null,
    },
    supported: {
      value: publisherSelected ? publisherSelected.offerTotal : null,
      complete: Boolean(pub && pub.status === 'complete' && pub.periodEnd >= period.end),
      coverageEnd: pub?.periodEnd ?? null, publisherReportId: pub?.publisherReportId ?? null,
    },
  };
}

function periodFindings(p: PeriodEvidence): Finding[] {
  const week = p.label === 'current' ? 'Requested week' : 'Comparison week';
  const out: Finding[] = [];
  const pub = p.publisher.selected; const sel = p.internal.selected;
  if (!pub) out.push({ code: 'PUBLISHER_MISSING', severity: 'blocking', period: p.label, title: `${week}: no publisher report`,
    detail: `No publisher report for ${p.period.start} was available at the evaluation time. The value is unknown, not zero.` });
  else {
    if (!(pub.status === 'complete' && pub.periodEnd >= p.period.end)) out.push({ code: 'PARTIAL_SNAPSHOT', severity: 'blocking', period: p.label,
      title: `${week}: partial snapshot only`,
      detail: `The latest publisher report (${pub.publisherReportId}) is ${pub.status} and covers ${p.period.start} to ${pub.periodEnd}, not the full week to ${p.period.end}. It can be shown with that coverage but is not comparable weekly growth.` });
    if (pub.offerTotal !== pub.activeSubscriptions || pub.offerRows !== pub.offerCount) out.push({ code: 'PUBLISHER_CONTROL_TOTALS', severity: 'blocking', period: p.label,
      title: `${week}: publisher export fails its own control totals`,
      detail: `${pub.publisherReportId} header declares ${fmt(pub.offerCount)} offers / ${fmt(pub.activeSubscriptions)} subscriptions; its offer rows contain ${fmt(pub.offerRows)} / ${fmt(pub.offerTotal)}.` });
  }
  if (!sel) out.push({ code: 'INTERNAL_MISSING', severity: 'blocking', period: p.label, title: `${week}: no internal import`,
    detail: 'The internal pipeline has no imported report for this week, so its result cannot be reconciled.' });
  if (sel && pub && !p.reconciliation.sameReport) out.push({ code: 'INTERNAL_WRONG_REPORT', severity: 'blocking', period: p.label,
    title: `${week}: internal pipeline used a different report`,
    detail: `Internal pipeline used ${sel.reportId} (publisher ${sel.publisherReportId}, ${fmt(sel.offerTotal)}); the publisher's current report is ${pub.publisherReportId} (${fmt(pub.offerTotal)}).` });
  if (sel && pub && p.reconciliation.sameReport && p.reconciliation.status === 'mismatch') {
    const r = p.reconciliation;
    out.push({ code: 'INTERNAL_OFFERS_MISMATCH', severity: 'blocking', period: p.label, title: `${week}: internal import does not match the publisher`,
      detail: `Import ${sel.reportId} loaded ${fmt(sel.offerRows)} of ${fmt(pub.offerRows)} offers (${fmt(sel.offerTotal)} vs ${fmt(pub.offerTotal)} subscriptions; header declared ${fmt(sel.declaredActiveSubscriptions)}). Missing ${r.missingOffers}, unexpected ${r.extraOffers}, changed ${r.changedOffers}${r.missingOfferExamples.length ? ` (e.g. ${r.missingOfferExamples.join(', ')})` : ''}. The import job still recorded "${sel.importStatus ?? 'unknown'}".` });
  }
  if (p.internal.imports.length > 1) out.push({ code: 'MULTIPLE_REVISIONS', severity: 'info', period: p.label,
    title: `${week}: ${p.internal.imports.length} imported revisions of one snapshot`,
    detail: `Revisions ${p.internal.imports.map(i => `r${i.revision}`).join(', ')} are successive snapshots; one is used${sel ? ` (${sel.reportId})` : ''}. Summing them, as the previous weekly mart did, would report ${fmt(p.internal.revisionSum ?? 0)}.` });
  for (const i of p.internal.imports) if (i.publisherSupersededBy && sel && i.revision > sel.revision) out.push({ code: 'SUPERSEDED_REIMPORT', severity: 'warning', period: p.label,
    title: `${week}: latest import carries a superseded report`,
    detail: `Import ${i.reportId} (revision ${i.revision}) contains publisher report ${i.publisherReportId}, which the publisher superseded with ${i.publisherSupersededBy}. A higher internal revision does not override the publisher record.` });
  return out;
}

/** Model output is advisory: it is accepted only when it matches the backend's policy outcome exactly. */
export function validateProposal(proposal: Recommendation, policy: Pick<Assessment['policy'], 'permittedAction' | 'permittedChangePct' | 'eligibleForExpansion'>, documents: Document[]): string[] {
  const issues: string[] = [];
  const label = (a: string) => a === 'hold' ? 'hold' : 'expand promotion';
  if (!['hold', 'expand_promotion'].includes(proposal.action)) issues.push(`Unknown action "${String(proposal.action)}".`);
  else if (proposal.action !== policy.permittedAction) issues.push(`Proposes "${label(proposal.action)}" but the validated evidence supports "${label(policy.permittedAction)}".`);
  if (!Number.isFinite(proposal.budgetChangePct) || proposal.budgetChangePct !== policy.permittedChangePct) issues.push(`Proposes a ${proposal.budgetChangePct}% change; policy permits ${policy.permittedChangePct}%.`);
  for (const d of documents.filter(d => proposal.citations.includes(d.id))) issues.push(`Relies on operational note ${d.id}; notes are context and cannot override policy or remove caveats.`);
  if (proposal.action === 'expand_promotion' && !policy.eligibleForExpansion) issues.push('Claims growth that complete, reconciled, comparable snapshots do not support.');
  return issues;
}

export async function assessScope(db: PGlite, brandId: string, marketplace: string, options: AssessOptions = {}): Promise<Assessment> {
  const asOf = options.asOf ?? AS_OF;
  const [brand] = await queryRows<{ name: string }>(db, 'SELECT name FROM brands WHERE brand_id = $1', [brandId]);
  if (!brand) throw new Error(`Unknown brand: ${brandId}`);
  const exp = options.exports ?? await loadPublisherExports(options.exportsDir ?? DEFAULT_EXPORTS_DIR);
  const current = await periodEvidence(db, exp, 'current', brandId, marketplace, PERIODS.current, asOf);
  const previous = await periodEvidence(db, exp, 'previous', brandId, marketplace, PERIODS.previous, asOf);
  const findings = [...periodFindings(current), ...periodFindings(previous)];

  const importedAt = current.internal.selected?.extractedAt ?? null;
  const ageHours = importedAt ? (Date.parse(asOf) - Date.parse(importedAt)) / 3_600_000 : null;
  const fresh = ageHours !== null && ageHours >= 0 && ageHours <= POLICY.maxImportAgeHours;
  if (!fresh) findings.push({ code: 'STALE_IMPORT', severity: 'blocking', period: 'current', title: 'Current import is not fresh enough',
    detail: importedAt ? `The current import was obtained ${ageHours!.toFixed(1)} hours before the evaluation time; the limit is ${POLICY.maxImportAgeHours} hours.` : 'There is no current import, so freshness cannot be established.' });

  const comparable = current.supported.complete && previous.supported.complete;
  const cur = current.supported.value, prev = previous.supported.value;
  let exactPct: number | null = null; let note: string;
  if (cur === null || prev === null) note = 'Change is unknown because a publisher snapshot is unavailable.';
  else if (!comparable) note = 'Not comparable weekly growth: at least one snapshot is partial.';
  else if (prev === 0) note = 'Percentage change is undefined because the comparison week is zero.';
  else { exactPct = (cur / prev - 1) * 100; note = 'Complete snapshots for both weeks.'; }
  if (comparable && prev === 0) findings.push({ code: 'ZERO_BASELINE', severity: 'blocking', title: 'Percentage change undefined', detail: 'The comparison week has zero active subscriptions.' });

  const blocking = findings.filter(f => f.severity === 'blocking');
  const eligible = blocking.length === 0 && exactPct !== null && exactPct >= POLICY.growthThresholdPct;
  const pctText = exactPct === null ? null : `${exactPct >= 0 ? '+' : ''}${exactPct.toFixed(2)}%`;
  const policy = eligible
    ? { headline: 'Expansion supported for review', explanation: `Complete, reconciled snapshots show ${pctText} (at least ${POLICY.growthThresholdPct}%). Policy supports a ${POLICY.expansionPct}% promotion expansion suggestion for brand-manager review.` }
    : blocking.length
      ? { headline: 'Hold required: evidence does not support a growth claim', explanation: `Approval is unavailable while ${blocking.length} blocking issue${blocking.length > 1 ? 's remain' : ' remains'}: ${blocking.map(b => b.title.toLowerCase()).join('; ')}.` }
      : { headline: 'Hold: growth below policy threshold', explanation: `Complete, reconciled snapshots show ${pctText}, below the ${POLICY.growthThresholdPct}% threshold. Keep the current promotion.` };

  // Advisory model: run on the validated evidence, then validate its proposal against policy.
  const documents = options.documents ?? await retrieveKnowledge(brandId);
  const modelEvidence: Evidence = {
    brandId, brandName: brand.name, marketplace, periodStart: PERIODS.current.start, expectedPeriodEnd: PERIODS.current.end, asOf,
    activeSubscriptions: cur, previousSubscriptions: prev, growthPct: exactPct === null ? null : Math.round(exactPct * 100) / 100,
    sourcePeriodEnd: current.supported.coverageEnd, sourceComplete: current.supported.complete,
    sourceReports: [current.supported.publisherReportId, previous.supported.publisherReportId].filter((x): x is string => !!x),
    ingestedAt: importedAt, previousSourceComplete: previous.supported.complete, previousSourcePeriodEnd: previous.supported.coverageEnd,
    netSales: 0, adSpend: 0, attributedAdSales: 0, roas: null, inventoryUnits: 0, sourceSnapshots: [],
  };
  const proposal = propose({ systemPolicy: '', evidence: modelEvidence, quality: { status: blocking.length ? 'insufficient' : 'ready', reasons: blocking.map(b => b.title) }, documents });
  const permittedAction = eligible ? 'expand_promotion' : 'hold';
  const permittedPct = eligible ? POLICY.expansionPct : 0;
  const issues = validateProposal(proposal, { permittedAction, permittedChangePct: permittedPct, eligibleForExpansion: eligible }, documents);
  const accepted = issues.length === 0;
  if (!accepted) findings.push({ code: 'MODEL_REJECTED', severity: 'warning', title: 'Model recommendation rejected',
    detail: `The advisory model proposed: "${proposal.narrative}" ${issues.join(' ')}` });

  const limitations: string[] = [];
  for (const f of findings.filter(f => f.severity === 'blocking')) limitations.push(f.detail);
  for (const p of [current, previous]) if (p.supported.value !== null && !p.supported.complete)
    limitations.push(`${p.label === 'current' ? 'Requested' : 'Comparison'} week figure ${fmt(p.supported.value)} covers ${p.period.start} to ${p.supported.coverageEnd} only.`);
  limitations.push('Active subscriptions count product-offer enrollments, not unique customers or orders.');
  limitations.push('Any promotion change is a draft suggestion for brand-manager review; nothing is executed by this application.');

  const suggestedNextAction = eligible
    ? `Share the ${POLICY.expansionPct}% promotion expansion suggestion with the brand manager for approval.`
    : blocking.some(b => b.code === 'PARTIAL_SNAPSHOT' || b.code === 'PUBLISHER_MISSING')
      ? 'Wait for the complete publisher report for the requested week, then reopen and revalidate this case.'
      : blocking.some(b => b.code.startsWith('INTERNAL'))
        ? 'Ask data engineering to re-import the affected report so the internal pipeline matches the publisher, then revalidate.'
        : blocking.some(b => b.code === 'STALE_IMPORT') ? 'Request a fresh import of the current report, then revalidate.'
          : 'Keep the current promotion and review again with next week\'s complete snapshot.';

  const sourceIds = [...new Set([current, previous].flatMap(p => [p.supported.publisherReportId, p.internal.selected?.reportId]).filter((x): x is string => !!x))];
  const fingerprintInput = {
    policy: POLICY, asOf, brandId, marketplace,
    periods: [current, previous].map(p => ({
      period: p.period,
      publisherReports: p.publisher.available,
      publisherOffers: p.publisher.selected ? (exp.offersByReport.get(p.publisher.selected.publisherReportId) ?? [])
        .map(o => [o.offerId, o.asin, o.activeSubscriptions]).sort() : null,
      internalImports: p.internal.imports.map(i => ({ ...i })),
    })),
  };
  // Internal offer content of the selected imports also feeds the fingerprint.
  const internalOfferDigest: string[] = [];
  for (const p of [current, previous]) if (p.internal.selected) {
    const rows = await queryRows<{ d: string }>(db, `SELECT md5(string_agg(offer_id || ':' || asin || ':' || active_subscriptions, ',' ORDER BY offer_id)) AS d FROM raw.subscription_offers WHERE report_id = $1`, [p.internal.selected.reportId]);
    internalOfferDigest.push(`${p.internal.selected.reportId}:${rows[0]?.d}`);
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({ ...fingerprintInput, internalOfferDigest })).digest('hex');

  const internalGrowth = current.internal.reported !== null && previous.internal.reported ? (current.internal.reported / previous.internal.reported - 1) * 100 : null;
  return {
    scope: { brandId, brandName: brand.name, marketplace }, asOf, periods: PERIODS, policyVersion: POLICY.version,
    current, previous,
    freshness: { importedAt, ageHours, fresh, limitHours: POLICY.maxImportAgeHours },
    growth: { comparable, exactPct, displayPct: pctText, change: cur !== null && prev !== null ? cur - prev : null, note },
    internalPipeline: { current: current.internal.reported, previous: previous.internal.reported, growthPct: internalGrowth },
    findings, policy: { eligibleForExpansion: eligible, permittedAction, permittedChangePct: permittedPct, blockingReasons: blocking.map(b => b.title), ...policy },
    model: { proposal, accepted, issues },
    notes: documents.map(d => ({ id: d.id, source: d.source, text: d.text, citedByModel: proposal.citations.includes(d.id) })),
    limitations, suggestedNextAction, sourceIds, fingerprint,
  };
}
