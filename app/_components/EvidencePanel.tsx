import type { CaseView } from './api.ts';
import type { PeriodEvidence, Finding } from '../../src/review.ts';
import { fmtDate, fmtInt, fmtPct, fmtRange, fmtTime, shortHash } from './format.ts';
import { Pill, Section, type Tone } from './ui.tsx';

const SEVERITY: Record<Finding['severity'], { tone: Tone; label: string }> = {
  blocking: { tone: 'danger', label: 'Blocks approval' },
  warning: { tone: 'warning', label: 'Warning' },
  info: { tone: 'info', label: 'Context' },
};

function coverage(p: PeriodEvidence) {
  const s = p.supported;
  if (s.value === null) return 'No publisher report';
  return s.complete ? `Complete to ${fmtDate(s.coverageEnd)}` : `Partial, to ${fmtDate(s.coverageEnd)}`;
}

function ComparisonRow({ name, p }: { name: string; p: PeriodEvidence }) {
  const sel = p.internal.selected, pub = p.publisher.selected;
  const r = p.reconciliation;
  return (
    <tr>
      <th scope="row">{name}<span className="cell-sub">{fmtRange(p.period.start, p.period.end)}</span></th>
      <td className="num">
        {fmtInt(p.internal.reported)}
        <span className="cell-sub">{sel ? `${sel.reportId} · ${sel.status}, to ${fmtDate(sel.periodEnd)}` : 'No import'}</span>
      </td>
      <td className="num">
        <strong>{fmtInt(p.supported.value)}</strong>
        <span className="cell-sub">{pub ? `${pub.publisherReportId} · ${coverage(p)}` : 'Unknown, not zero'}</span>
      </td>
      <td>
        {r.status === 'reconciled' ? <Pill tone="success">Reconciled</Pill>
          : r.status === 'mismatch' ? <Pill tone="danger">Mismatch {r.delta !== null && r.delta !== 0 ? `(${r.delta > 0 ? '+' : ''}${fmtInt(r.delta)})` : ''}</Pill>
          : <Pill tone="warning">Cannot reconcile</Pill>}
      </td>
    </tr>
  );
}

function Check({ label, ok, okText, badText, detail }: { label: string; ok: boolean; okText: string; badText: string; detail: string }) {
  return (
    <li className="check">
      <div className="check-head"><span className="check-label">{label}</span><Pill tone={ok ? 'success' : 'danger'}>{ok ? okText : badText}</Pill></div>
      <p>{detail}</p>
    </li>
  );
}

function SourceTables({ p, title }: { p: PeriodEvidence; title: string }) {
  return (
    <div className="source-block">
      <h4>{title} · {fmtRange(p.period.start, p.period.end)}</h4>
      <p className="table-caption">Publisher exports (authoritative), available by the evaluation time</p>
      <div className="table-wrap">
        <table className="table table-compact">
          <thead><tr><th scope="col">Publisher report</th><th scope="col">Status</th><th scope="col">Data to</th><th scope="col">Generated</th><th scope="col">Superseded by</th><th scope="col" className="num">Offers</th><th scope="col" className="num">Header total</th></tr></thead>
          <tbody>
            {p.publisher.available.length === 0 && <tr><td colSpan={7} className="muted">No publisher report for this week.</td></tr>}
            {p.publisher.available.map(r => (
              <tr key={r.publisherReportId} className={r.publisherReportId === p.supported.publisherReportId ? 'row-selected' : undefined}>
                <td><code>{r.publisherReportId}</code>{r.publisherReportId === p.supported.publisherReportId && <span className="tag">Used</span>}</td>
                <td>{r.status}</td><td>{fmtDate(r.periodEnd)}</td><td>{fmtTime(r.generatedAt)}</td>
                <td>{r.supersededBy ? <code>{r.supersededBy}</code> : <span className="muted">Current</span>}</td>
                <td className="num">{fmtInt(r.offerCount)}</td><td className="num">{fmtInt(r.activeSubscriptions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {p.publisher.selected && (
        <p className="table-note">Offer rows of {p.publisher.selected.publisherReportId}: {fmtInt(p.publisher.selected.offerRows)} offers totalling {fmtInt(p.publisher.selected.offerTotal)} (header declares {fmtInt(p.publisher.selected.offerCount)} / {fmtInt(p.publisher.selected.activeSubscriptions)}).</p>
      )}
      <p className="table-caption">Internal imports (raw.subscription_reports)</p>
      <div className="table-wrap">
        <table className="table table-compact">
          <thead><tr><th scope="col">Import</th><th scope="col">Rev.</th><th scope="col">Publisher report</th><th scope="col">Status</th><th scope="col">Data to</th><th scope="col">Extracted</th><th scope="col" className="num">Rows / declared</th><th scope="col" className="num">Loaded total</th></tr></thead>
          <tbody>
            {p.internal.imports.length === 0 && <tr><td colSpan={8} className="muted">No internal import for this week.</td></tr>}
            {p.internal.imports.map(i => (
              <tr key={i.reportId} className={i.selectedByPipeline ? 'row-selected' : undefined}>
                <td><code>{i.reportId}</code>{i.selectedByPipeline && <span className="tag">Used</span>}</td>
                <td>{i.revision}</td>
                <td><code>{i.publisherReportId}</code>{i.publisherSupersededBy && <span className="tag tag-warning">Superseded</span>}</td>
                <td>{i.status}</td><td>{fmtDate(i.periodEnd)}</td><td>{fmtTime(i.extractedAt)}</td>
                <td className={`num${i.offerRows !== i.declaredOfferCount ? ' text-danger' : ''}`}>{fmtInt(i.offerRows)} / {fmtInt(i.declaredOfferCount)}</td>
                <td className={`num${i.offerTotal !== i.declaredActiveSubscriptions ? ' text-danger' : ''}`}>{fmtInt(i.offerTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EvidencePanel({ view, onRevalidate, revalidating }: { view: CaseView; onRevalidate: () => void; revalidating: boolean }) {
  const a = view.assessment;
  const order = { blocking: 0, warning: 1, info: 2 } as const;
  const findings = [...a.findings].sort((x, y) => order[x.severity] - order[y.severity]);
  const reconciled = a.current.reconciliation.status === 'reconciled' && a.previous.reconciliation.status === 'reconciled';
  const mismatchWeeks = [a.current, a.previous].filter(p => p.reconciliation.status !== 'reconciled').map(p => p.label === 'current' ? 'requested week' : 'comparison week');

  return (
    <Section id="evidence" title="Evidence" description={<>Internal pipeline compared with publisher exports as of {fmtTime(a.asOf)}.</>}
      actions={<button className="btn btn-secondary btn-small" onClick={onRevalidate} disabled={revalidating}>{revalidating ? 'Validating…' : 'Validate evidence'}</button>}>
      <div className="table-wrap">
        <table className="table comparison">
          <thead>
            <tr><th scope="col">Active subscriptions</th><th scope="col" className="num">Internal pipeline</th><th scope="col" className="num">Publisher (authoritative)</th><th scope="col">Reconciliation</th></tr>
          </thead>
          <tbody>
            <ComparisonRow name="Requested week" p={a.current} />
            <ComparisonRow name="Comparison week" p={a.previous} />
            <tr className="row-total">
              <th scope="row">Week-over-week change</th>
              <td className="num">{fmtPct(a.internalPipeline.growthPct)}<span className="cell-sub">Internal figures, not policy-checked</span></td>
              <td className="num"><strong>{a.growth.displayPct ?? 'Not reported'}</strong><span className="cell-sub">{a.growth.note}</span></td>
              <td>{a.growth.exactPct !== null ? <Pill tone="success">Comparable</Pill> : <Pill tone="danger">Not comparable</Pill>}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <ul className="checks" aria-label="Validation checks">
        <Check label="Coverage" ok={a.current.supported.complete} okText="Complete" badText={a.current.supported.value === null ? 'Missing' : 'Partial'}
          detail={`Requested week: ${coverage(a.current)}.`} />
        <Check label="Comparability" ok={a.growth.comparable} okText="Comparable" badText="Not comparable"
          detail={`Comparison week: ${coverage(a.previous)}. Both weeks must be complete.`} />
        <Check label="Freshness" ok={a.freshness.fresh} okText="Fresh" badText="Stale or unknown"
          detail={a.freshness.ageHours === null ? 'No current import.' : `Current import obtained ${a.freshness.ageHours.toFixed(1)} h before the evaluation time (limit ${a.freshness.limitHours} h).`} />
        <Check label="Reconciliation" ok={reconciled} okText="Reconciled" badText="Mismatch"
          detail={reconciled ? 'Internal imports match the publisher offer by offer.' : `Differences in the ${mismatchWeeks.join(' and ')}. Publisher figures are used.`} />
      </ul>

      <h3 className="subhead">Detected inconsistencies <span className="count">{findings.length}</span></h3>
      {findings.length === 0 ? <p className="empty-text">No inconsistencies detected for this scope.</p> : (
        <ul className="findings">
          {findings.map((f, i) => (
            <li key={`${f.code}-${i}`} className={`finding finding-${f.severity}`}>
              <div className="finding-head"><Pill tone={SEVERITY[f.severity].tone}>{SEVERITY[f.severity].label}</Pill><strong>{f.title}</strong></div>
              <p>{f.detail}</p>
            </li>
          ))}
        </ul>
      )}

      <h3 className="subhead">Advisory model output <span className="subhead-note">Unvalidated commentary, not the approval authority</span></h3>
      <div className="model">
        <blockquote>“{a.model.proposal.narrative}”</blockquote>
        <div className="model-verdict">
          {a.model.accepted ? <Pill tone="success">Matches validated outcome</Pill> : <Pill tone="danger">Rejected by validation</Pill>}
          {a.model.issues.length > 0 && <ul>{a.model.issues.map(i => <li key={i}>{i}</li>)}</ul>}
        </div>
        {a.notes.length > 0 && (
          <details className="details">
            <summary>Operational notes retrieved ({a.notes.length}): context only</summary>
            {a.notes.map(n => (
              <div key={n.id} className="note">
                <div className="note-head"><code>{n.id}</code> · {n.source}{n.citedByModel && <span className="tag tag-warning">Cited by model</span>}</div>
                <pre>{n.text}</pre>
              </div>
            ))}
          </details>
        )}
      </div>

      <details className="details">
        <summary>Source reports, timestamps and control totals</summary>
        <SourceTables p={a.current} title="Requested week" />
        <SourceTables p={a.previous} title="Comparison week" />
        <p className="table-note">Evidence fingerprint <code title={a.fingerprint}>{shortHash(a.fingerprint)}</code>: SHA-256 of the publisher report headers, selected offer rows, internal import metadata and offer content for both weeks, plus policy {a.policyVersion}.</p>
      </details>
    </Section>
  );
}
