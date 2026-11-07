import type { SavedCase } from './api.ts';
import { fmtPct, fmtRange, fmtTime } from './format.ts';
import { Pill, Spinner } from './ui.tsx';

interface Props {
  state: { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: SavedCase[] };
  activeCaseId: string | null; onReopen: (c: SavedCase) => void; onRetry: () => void; onClose: () => void;
}

export function SavedCases({ state, activeCaseId, onReopen, onRetry, onClose }: Props) {
  return (
    <section className="saved-cases" aria-labelledby="saved-cases-title">
      <div className="saved-cases-inner">
        <header className="saved-cases-header">
          <h2 id="saved-cases-title">Saved cases</h2>
          <p>Stored by the review backend; they remain after the server restarts.</p>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </header>
        {state.status === 'loading' && <Spinner label="Loading saved cases…" />}
        {state.status === 'error' && <p className="inline-error" role="alert">{state.message} <button className="link-button" onClick={onRetry}>Retry</button></p>}
        {state.status === 'ready' && state.data.length === 0 && (
          <p className="empty-text">No saved cases yet. Choose a brand and marketplace below and open a review case; it is stored as soon as it is opened.</p>
        )}
        {state.status === 'ready' && state.data.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Brand · marketplace</th><th scope="col">Week</th><th scope="col">Latest decision</th><th scope="col">Saved</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
              <tbody>
                {state.data.map(c => (
                  <tr key={c.caseId} className={c.caseId === activeCaseId ? 'row-active' : undefined}>
                    <td><strong>{c.brandName}</strong> · {c.marketplace}</td>
                    <td>{fmtRange(c.periodStart, c.periodEnd)}</td>
                    <td>
                      {!c.latest ? <Pill tone="neutral">No decision yet</Pill>
                        : c.latest.decision === 'approve_expansion' ? <Pill tone="success">Approved {c.latest.promotionChangePct}% expansion</Pill>
                        : <Pill tone="info">Hold</Pill>}
                      {c.latest && c.latest.growthPct !== null && <span className="muted"> {fmtPct(c.latest.growthPct)}</span>}
                    </td>
                    <td className="muted">{c.latest ? fmtTime(c.latest.savedAt) : `Opened ${fmtTime(c.createdAt)}`}</td>
                    <td className="cell-action">
                      <button className="btn btn-secondary btn-small" onClick={() => onReopen(c)} aria-label={`Reopen case ${c.brandName} ${c.marketplace}`}>Reopen case</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
