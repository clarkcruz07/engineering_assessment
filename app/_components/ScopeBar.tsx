import type { Scope, CaseView } from './api.ts';
import { fmtRange, fmtTime } from './format.ts';
import { Pill, Spinner } from './ui.tsx';

interface Props {
  scopes: Scope[] | null; scopesError: string | null; onRetryScopes: () => void;
  brandId: string; marketplace: string;
  onBrand: (brandId: string) => void; onMarketplace: (marketplace: string) => void;
  onOpen: () => void; opening: boolean;
  view: CaseView | null;
  period: { start: string; end: string; previousStart: string; previousEnd: string } | null;
}

export function ScopeBar({ scopes, scopesError, onRetryScopes, brandId, marketplace, onBrand, onMarketplace, onOpen, opening, view, period }: Props) {
  const brands = scopes ? [...new Map(scopes.map(s => [s.brandId, s.brandName])).entries()] : [];
  const markets = scopes ? scopes.filter(s => s.brandId === brandId).map(s => s.marketplace) : [];
  const matchesView = view && view.case.brandId === brandId && view.case.marketplace === marketplace;
  const saveState = !view ? null
    : view.evidenceStatus === 'changed' ? <Pill tone="warning">Requires attention</Pill>
    : view.latestDecision ? <Pill tone="success">Decision #{view.latestDecision.decisionId} saved</Pill>
    : <Pill tone="neutral">Open, no decision saved</Pill>;

  return (
    <section className="card scope-bar" aria-label="Case scope">
      <div className="scope-fields">
        <div className="field">
          <label htmlFor="brand">Brand</label>
          <select id="brand" value={brandId} disabled={!scopes} onChange={e => onBrand(e.target.value)}>
            {!scopes && <option value="">{scopesError ? 'Unavailable' : 'Loading brands…'}</option>}
            {scopes && <option value="" disabled>Choose a brand</option>}
            {brands.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="marketplace">Marketplace</label>
          <select id="marketplace" value={marketplace} disabled={!brandId} onChange={e => onMarketplace(e.target.value)}>
            {!brandId && <option value="">Choose a brand first</option>}
            {markets.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="field field-static">
          <span className="label">Reporting period</span>
          <span className="static-value">{period ? fmtRange(period.start, period.end) : '…'}</span>
          <span className="hint">{period ? `compared with ${fmtRange(period.previousStart, period.previousEnd)}` : 'Loading period'}</span>
        </div>
        <div className="scope-action">
          {matchesView && !opening ? saveState : (
            <button className="btn btn-primary" onClick={onOpen} disabled={!brandId || !marketplace || opening}>
              {opening ? <Spinner label="Opening…" /> : 'Open review case'}
            </button>
          )}
        </div>
      </div>
      {scopesError && (
        <p className="inline-error" role="alert">{scopesError} <button className="link-button" onClick={onRetryScopes}>Retry</button></p>
      )}
      {view && matchesView && (
        <div className="case-meta">
          <span>Case <code>{view.case.caseId}</code></span>
          <span>Opened {fmtTime(view.case.createdAt)}</span>
          <span>{view.history.length} saved decision{view.history.length === 1 ? '' : 's'}</span>
        </div>
      )}
    </section>
  );
}
