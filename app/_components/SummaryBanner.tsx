import type { CaseView } from './api.ts';
import { fmtDate, fmtInt, fmtTime } from './format.ts';
import { Pill, type Tone } from './ui.tsx';

export function SummaryBanner({ view }: { view: CaseView }) {
  const a = view.assessment;
  const d = view.latestDecision;
  const blocking = a.findings.filter(f => f.severity === 'blocking');
  let tone: Tone, label: string, title: string, body: string;
  if (d && view.evidenceStatus === 'changed') {
    tone = 'warning'; label = 'Requires attention';
    title = `Evidence changed after decision #${d.decisionId} was saved`;
    body = `The saved ${d.decision === 'hold' ? 'hold' : 'approval'} covered earlier evidence and does not cover the current figures. Review the updated evidence and save a new decision. The earlier decision stays in the history.`;
  } else if (d) {
    tone = d.decision === 'approve_expansion' ? 'success' : 'info';
    label = `Decision saved ${fmtTime(d.savedAt)}`;
    title = d.decision === 'approve_expansion' ? `${d.promotionChangePct}% promotion expansion suggested for brand-manager review` : 'Hold the current promotion';
    body = d.reason;
  } else {
    tone = a.policy.eligibleForExpansion ? 'success' : blocking.length ? 'warning' : 'neutral';
    label = a.policy.eligibleForExpansion ? 'Evidence supports expansion' : blocking.length ? 'Hold required' : 'Hold recommended';
    title = a.policy.headline;
    body = blocking[0]?.detail ?? a.policy.explanation;
  }
  const cur = a.current.supported, prev = a.previous.supported;

  return (
    <section className={`summary summary-${tone}`} aria-labelledby="summary-title">
      <div className="summary-main">
        <Pill tone={tone}>{label}</Pill>
        <h2 id="summary-title">{title}</h2>
        <p>{body}</p>
      </div>
      <dl className="summary-facts">
        <div>
          <dt>Requested week (publisher)</dt>
          <dd>{fmtInt(cur.value)}</dd>
          <dd className="fact-note">{cur.value === null ? 'No report available' : cur.complete ? 'Complete week' : `Partial, data to ${fmtDate(cur.coverageEnd)}`}</dd>
        </div>
        <div>
          <dt>Comparison week</dt>
          <dd>{fmtInt(prev.value)}</dd>
          <dd className="fact-note">{prev.value === null ? 'No report available' : prev.complete ? 'Complete week' : 'Partial'}</dd>
        </div>
        <div>
          <dt>Supported change</dt>
          <dd>{a.growth.displayPct ?? 'Not reported'}</dd>
          <dd className="fact-note">{a.growth.exactPct === null ? 'Not comparable' : `${a.growth.change! >= 0 ? '+' : ''}${fmtInt(a.growth.change)} enrollments`}</dd>
        </div>
        <div className="fact-wide">
          <dt>Next action</dt>
          <dd className="fact-text">{d && view.evidenceStatus === 'current' ? d.nextAction : view.evidenceStatus === 'changed' ? 'Review the changed evidence and save a new decision.' : a.suggestedNextAction}</dd>
        </div>
      </dl>
    </section>
  );
}
