'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiFailure, type CaseView, type SavedCase, type ScopeCatalog } from './api.ts';
import { fmtRange, fmtTime } from './format.ts';
import { ScopeBar } from './ScopeBar.tsx';
import { SavedCases } from './SavedCases.tsx';
import { SummaryBanner } from './SummaryBanner.tsx';
import { EvidencePanel } from './EvidencePanel.tsx';
import { DecisionPanel, type DecisionForm, type SaveState } from './DecisionPanel.tsx';
import { ReportPanel, type ReportState } from './ReportPanel.tsx';
import { Notice, Spinner } from './ui.tsx';

type Load<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };
type CaseState =
  | { status: 'idle' }
  | { status: 'loading'; label: string; mode: 'open' | 'revalidate' }
  | { status: 'error'; message: string; retry: () => void }
  | { status: 'ready'; view: CaseView };

const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

function formFrom(view: CaseView): DecisionForm {
  const d = view.latestDecision;
  if (d && view.evidenceStatus === 'current') return { decision: d.decision, reason: d.reason, nextAction: d.nextAction };
  // New or changed evidence: start from the permitted outcome; the reviewer must write the reason.
  return { decision: view.assessment.policy.eligibleForExpansion ? 'approve_expansion' : 'hold', reason: '', nextAction: view.assessment.suggestedNextAction };
}

export function ReviewWorkspace() {
  const [catalog, setCatalog] = useState<Load<ScopeCatalog>>({ status: 'loading' });
  const [saved, setSaved] = useState<Load<SavedCase[]>>({ status: 'loading' });
  const [showSaved, setShowSaved] = useState(false);
  const [brandId, setBrandId] = useState('');
  const [marketplace, setMarketplace] = useState('');
  const [caseState, setCaseState] = useState<CaseState>({ status: 'idle' });
  const [form, setForm] = useState<DecisionForm>({ decision: 'hold', reason: '', nextAction: '' });
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const [report, setReport] = useState<ReportState>({ status: 'idle' });
  const [evidenceNotice, setEvidenceNotice] = useState<{ tone: 'success' | 'warning' | 'danger'; title: string; text: string } | null>(null);
  const [revalidating, setRevalidating] = useState(false);
  // Only the most recent case request may update the screen.
  const sequence = useRef(0);
  const inflight = useRef<AbortController | null>(null);

  const loadCatalog = useCallback(() => {
    setCatalog({ status: 'loading' });
    api.scopes().then(data => setCatalog({ status: 'ready', data }), e => setCatalog({ status: 'error', message: message(e) }));
  }, []);
  const loadSaved = useCallback(() => {
    api.cases().then(data => setSaved({ status: 'ready', data }), e => setSaved({ status: 'error', message: message(e) }));
  }, []);
  useEffect(() => { loadCatalog(); loadSaved(); }, [loadCatalog, loadSaved]);

  const view = caseState.status === 'ready' ? caseState.view : null;

  const cancelPending = () => { sequence.current++; inflight.current?.abort(); inflight.current = null; };

  const runCase = useCallback(async (label: string, mode: 'open' | 'revalidate', fetcher: (signal: AbortSignal) => Promise<CaseView>, previous: CaseView | null) => {
    const id = ++sequence.current;
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    const retry = () => { void runCase(label, mode, fetcher, previous); };
    if (mode === 'open' || !previous) setCaseState({ status: 'loading', label, mode });
    else setRevalidating(true);
    try {
      const next = await fetcher(controller.signal);
      if (id !== sequence.current) return;
      setCaseState({ status: 'ready', view: next });
      if (mode === 'open') {
        setForm(formFrom(next)); setSave({ status: 'idle' }); setReport({ status: 'idle' });
        setEvidenceNotice(next.evidenceStatus === 'changed' ? { tone: 'warning', title: 'Evidence changed since the saved decision', text: 'The saved decision covered earlier evidence. Review the current figures and save a new decision before sharing a report.' } : null);
      } else if (previous && previous.assessment.fingerprint !== next.assessment.fingerprint) {
        setEvidenceNotice({ tone: 'warning', title: 'Evidence changed', text: 'The source evidence changed since this case was last validated. Figures and findings below are updated; review them before saving.' });
        if (next.evidenceStatus === 'changed') setForm(formFrom(next));
      } else {
        setEvidenceNotice({ tone: 'success', title: 'Evidence validated', text: 'The source evidence is unchanged since it was last checked.' });
      }
    } catch (e) {
      if (isAbort(e) || id !== sequence.current) return;
      if (mode === 'revalidate' && previous) setEvidenceNotice({ tone: 'danger', title: 'Validation failed', text: `${message(e)} The figures below are from the previous successful check.` });
      else setCaseState({ status: 'error', message: message(e), retry });
    } finally {
      if (id === sequence.current) { inflight.current = null; setRevalidating(false); }
    }
  }, []);

  const scopeName = (b: string, m: string) => {
    const s = catalog.status === 'ready' ? catalog.data.scopes.find(x => x.brandId === b && x.marketplace === m) : undefined;
    return `${s?.brandName ?? b} · ${m}`;
  };

  // Changing the scope clears the previous case so its figures never appear under the new selection.
  const changeScope = (b: string, m: string) => {
    setBrandId(b); setMarketplace(m);
    if (view && (view.case.brandId !== b || view.case.marketplace !== m) || caseState.status === 'loading' || caseState.status === 'error') {
      cancelPending(); setRevalidating(false);
      setCaseState({ status: 'idle' }); setReport({ status: 'idle' }); setSave({ status: 'idle' }); setEvidenceNotice(null);
    }
  };
  const onBrand = (b: string) => {
    const markets = catalog.status === 'ready' ? catalog.data.scopes.filter(s => s.brandId === b).map(s => s.marketplace) : [];
    changeScope(b, markets.includes(marketplace) ? marketplace : markets[0] ?? '');
  };

  const openSelected = () => {
    if (!brandId || !marketplace) return;
    void runCase(`Validating evidence for ${scopeName(brandId, marketplace)}…`, 'open', s => api.openCase(brandId, marketplace, s), null)
      .then(loadSaved);
  };
  const reopen = (c: SavedCase) => {
    setShowSaved(false);
    setBrandId(c.brandId); setMarketplace(c.marketplace);
    void runCase(`Reopening ${c.brandName} · ${c.marketplace} and revalidating its evidence…`, 'open', s => api.getCase(c.caseId, s), null);
  };
  const revalidate = () => {
    if (!view) return;
    void runCase('Validating evidence…', 'revalidate', s => api.getCase(view.case.caseId, s), view);
  };

  const onSave = async () => {
    if (!view || save.status === 'saving') return;
    const caseId = view.case.caseId;
    const id = sequence.current;
    setSave({ status: 'saving' });
    try {
      const next = await api.saveDecision(caseId, { ...form, reviewedFingerprint: view.assessment.fingerprint });
      if (id !== sequence.current) return;
      setCaseState({ status: 'ready', view: next });
      const d = next.latestDecision!;
      setForm({ decision: d.decision, reason: d.reason, nextAction: d.nextAction });
      setSave({ status: 'saved', decisionId: d.decisionId, savedAt: d.savedAt, decision: d.decision });
      setEvidenceNotice(null);
      loadSaved();
    } catch (e) {
      if (id !== sequence.current) return;
      setSave({ status: 'error', code: e instanceof ApiFailure ? e.code : 'UNKNOWN', message: message(e) });
    }
  };

  const generateReport = async () => {
    if (!view) return;
    const id = sequence.current;
    setReport({ status: 'loading' });
    try {
      const data = await api.report(view.case.caseId);
      if (id === sequence.current) setReport({ status: 'ready', data });
    } catch (e) {
      if (id === sequence.current) setReport({ status: 'error', message: message(e) });
    }
  };

  const d = view?.latestDecision;
  const dirty = !!view && (d
    ? form.decision !== d.decision || form.reason.trim() !== d.reason || form.nextAction.trim() !== d.nextAction
    : form.reason.trim().length > 0);

  const periods = catalog.status === 'ready' ? catalog.data.periods : null;
  const savedCount = saved.status === 'ready' ? saved.data.length : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brandmark">
            <span className="logo" aria-hidden="true">ER</span>
            <div>
              <h1>Evidence Review</h1>
              <p>Check weekly subscription figures against publisher records before they reach a client.</p>
            </div>
          </div>
          <div className="topbar-meta">
            {catalog.status === 'ready' && <span className="clock">Scenario clock: {fmtTime(catalog.data.asOf)}</span>}
            <button className="btn btn-secondary" aria-expanded={showSaved} aria-controls="saved-cases" onClick={() => { setShowSaved(s => !s); if (!showSaved) loadSaved(); }}>
              Saved cases{savedCount !== null ? ` (${savedCount})` : ''}
            </button>
          </div>
        </div>
      </header>

      {showSaved && (
        <div id="saved-cases">
          <SavedCases state={saved} activeCaseId={view?.case.caseId ?? null} onReopen={reopen} onRetry={loadSaved} onClose={() => setShowSaved(false)} />
        </div>
      )}

      <main className="container">
        <ScopeBar
          scopes={catalog.status === 'ready' ? catalog.data.scopes : null}
          scopesError={catalog.status === 'error' ? `Could not load brands and marketplaces: ${catalog.message}` : null}
          onRetryScopes={loadCatalog}
          brandId={brandId} marketplace={marketplace}
          onBrand={onBrand} onMarketplace={m => changeScope(brandId, m)}
          onOpen={openSelected} opening={caseState.status === 'loading'}
          view={view}
          period={periods ? { start: periods.current.start, end: periods.current.end, previousStart: periods.previous.start, previousEnd: periods.previous.end } : null}
        />

        {caseState.status === 'idle' && (
          <section className="empty card" aria-live="polite">
            <h2>{brandId && marketplace ? `Ready to open ${scopeName(brandId, marketplace)}` : 'Choose a brand and marketplace'}</h2>
            <p>{brandId && marketplace
              ? `Open the review case to validate the ${periods ? fmtRange(periods.current.start, periods.current.end) : 'requested'} figures against the publisher's records.`
              : 'Select the scope above, then open its review case. You can also reopen a saved case.'}</p>
            <ol className="steps">
              <li><strong>Investigate</strong> the internal figures against publisher exports: coverage, freshness, reconciliation.</li>
              <li><strong>Decide</strong> with a reason and next action; the server enforces the promotion policy.</li>
              <li><strong>Report</strong>: generate the client report from the saved decision.</li>
            </ol>
          </section>
        )}

        {caseState.status === 'loading' && (
          <section className="card loading-card" aria-live="polite"><Spinner label={caseState.label} /></section>
        )}

        {caseState.status === 'error' && (
          <section className="card" aria-live="assertive">
            <Notice tone="danger" title="The case could not be loaded" action={<button className="btn btn-secondary btn-small" onClick={caseState.retry}>Try again</button>}>
              {caseState.message}
            </Notice>
          </section>
        )}

        {view && (
          <>
            {evidenceNotice && <Notice tone={evidenceNotice.tone} title={evidenceNotice.title}>{evidenceNotice.text}</Notice>}
            <SummaryBanner view={view} />
            <div className="workspace-grid">
              <EvidencePanel view={view} onRevalidate={revalidate} revalidating={revalidating} />
              <div className="side-column">
                <DecisionPanel view={view} form={form} onChange={f => { setForm(f); if (save.status !== 'saving') setSave({ status: 'idle' }); }} onSave={onSave} save={save} dirty={dirty} onRevalidate={revalidate} />
              </div>
            </div>
            <ReportPanel view={view} state={report} onGenerate={generateReport} dirty={dirty} />
          </>
        )}
      </main>
    </div>
  );
}
