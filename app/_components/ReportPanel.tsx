import type { CaseView, ClientReport } from './api.ts';
import { fmtRange, fmtTime, shortHash } from './format.ts';
import { Notice, Pill, Section, Spinner } from './ui.tsx';

export type ReportState = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: ClientReport };

export function ReportPanel({ view, state, onGenerate, dirty }: { view: CaseView; state: ReportState; onGenerate: () => void; dirty: boolean }) {
  const saved = view.latestDecision;
  const report = state.status === 'ready' ? state.data : null;
  const olderDecision = report && saved && report.generatedFrom.decisionId !== saved.decisionId;

  return (
    <Section id="report" title="Client report"
      description="Generated only from the saved decision and the evidence it reviewed."
      actions={<button className="btn btn-primary" onClick={onGenerate} disabled={!saved || state.status === 'loading'}>
        {state.status === 'loading' ? <Spinner label="Generating…" /> : report ? 'Regenerate client report' : 'Generate client report'}
      </button>}>
      {!saved && <p className="empty-text">Save a decision first. A held decision still produces a report explaining the limitation and next step.</p>}
      {saved && state.status === 'idle' && <p className="empty-text">Decision #{saved.decisionId} is saved. Generate the client report to preview it.</p>}
      {state.status === 'error' && <Notice tone="danger" title="Report not generated">{state.message}</Notice>}
      {report && (
        <>
          {report.status === 'requires_attention' && <Notice tone="warning" title="Requires attention: do not share yet">{report.statusMessage}</Notice>}
          {olderDecision && <Notice tone="warning" title="Out of date">This preview was generated from decision #{report.generatedFrom.decisionId}; decision #{saved!.decisionId} has since been saved. Regenerate the report.</Notice>}
          {dirty && <Notice tone="info" title="Unsaved edits are not included">The report reflects saved decision #{report.generatedFrom.decisionId} only. Save your changes, then regenerate.</Notice>}
          <article className="report-doc" aria-label="Client report preview">
            <header className="report-head">
              <div>
                <p className="report-kicker">Weekly subscription report</p>
                <h3>{report.brandName} · {report.marketplace} marketplace</h3>
                <p className="muted">Week of {fmtRange(report.period.start, report.period.end)}, compared with {fmtRange(report.previousPeriod.start, report.previousPeriod.end)}</p>
              </div>
              {report.status === 'current' ? <Pill tone="success">Evidence unchanged since review</Pill> : <Pill tone="warning">Evidence changed</Pill>}
            </header>
            <p className="report-lead">{report.headline}</p>
            <table className="table report-figures">
              <tbody>
                {report.figures.map(f => (
                  <tr key={f.label}><th scope="row">{f.label}</th><td className="num"><strong>{f.value}</strong></td><td className="muted">{f.note}</td></tr>
                ))}
              </tbody>
            </table>
            <h4>What this means</h4>
            <p>{report.interpretation}</p>
            <h4>Decision</h4>
            <p><strong>{report.decision.label}.</strong> {report.decision.reason}</p>
            <h4>Limitations</h4>
            <ul>{report.limitations.map(l => <li key={l}>{l}</li>)}</ul>
            <h4>Next step</h4>
            <p>{report.nextAction}</p>
            <footer className="report-foot">
              <h4>Sources</h4>
              <ul>{report.sources.map(s => <li key={s.id}><code>{s.id}</code>: {s.description}</li>)}</ul>
              <p className="muted">Prepared from saved decision #{report.generatedFrom.decisionId} ({fmtTime(report.generatedFrom.savedAt)}). Evidence as of {fmtTime(report.generatedFrom.asOf)}, fingerprint <code>{shortHash(report.generatedFrom.evidenceFingerprint)}</code>.</p>
            </footer>
          </article>
        </>
      )}
    </Section>
  );
}
