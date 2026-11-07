import type { CaseView, Decision } from './api.ts';
import { fmtTime, shortHash } from './format.ts';
import { Notice, Pill, Section, Spinner } from './ui.tsx';

export interface DecisionForm { decision: Decision; reason: string; nextAction: string }
export type SaveState =
  | { status: 'idle' } | { status: 'saving' }
  | { status: 'saved'; decisionId: number; savedAt: string; decision: Decision }
  | { status: 'error'; code: string; message: string };

interface Props {
  view: CaseView; form: DecisionForm; onChange: (form: DecisionForm) => void;
  onSave: () => void; save: SaveState; dirty: boolean; onRevalidate: () => void;
}

export function DecisionPanel({ view, form, onChange, onSave, save, dirty, onRevalidate }: Props) {
  const a = view.assessment;
  const eligible = a.policy.eligibleForExpansion;
  const reasonOk = form.reason.trim().length >= 10;
  const nextOk = form.nextAction.trim().length >= 5;
  const saving = save.status === 'saving';
  const canSave = reasonOk && nextOk && !saving && (form.decision === 'hold' || eligible);
  const label = form.decision === 'approve_expansion' ? 'Save approved decision' : 'Save hold decision';

  return (
    <Section id="decision" title="Review decision" description="Saved to the review backend with the evidence it covers.">
      <div className={`policy policy-${eligible ? 'ok' : 'hold'}`}>
        <span className="policy-label">Validated outcome</span>
        <strong>{eligible ? `Expansion of ${a.policy.permittedChangePct}% is permitted` : 'Hold is the only permitted outcome'}</strong>
        <p>{a.policy.explanation}</p>
      </div>

      <fieldset className="choices" disabled={saving}>
        <legend>Decision</legend>
        <label className={`choice${form.decision === 'hold' ? ' choice-selected' : ''}`}>
          <input type="radio" name="decision" value="hold" checked={form.decision === 'hold'} onChange={() => onChange({ ...form, decision: 'hold' })} />
          <span><strong>Hold the current promotion</strong><span className="choice-sub">No promotion change. Always available.</span></span>
        </label>
        <label className={`choice${form.decision === 'approve_expansion' ? ' choice-selected' : ''}${!eligible ? ' choice-disabled' : ''}`}>
          <input type="radio" name="decision" value="approve_expansion" disabled={!eligible} checked={form.decision === 'approve_expansion'}
            onChange={() => onChange({ ...form, decision: 'approve_expansion' })} aria-describedby="approve-help" />
          <span><strong>Approve {a.policy.permittedChangePct || 10}% expansion suggestion</strong>
            <span className="choice-sub" id="approve-help">{eligible ? 'Draft for brand-manager approval; nothing is executed.' : 'Unavailable: the evidence does not support a growth-based expansion. The server rejects this choice too.'}</span>
          </span>
        </label>
      </fieldset>

      <div className="field">
        <label htmlFor="reason">Reason <span className="req">required</span></label>
        <textarea id="reason" rows={3} value={form.reason} disabled={saving} aria-invalid={!reasonOk && form.reason.length > 0}
          placeholder="Why this decision is supported by the evidence above."
          onChange={e => onChange({ ...form, reason: e.target.value })} aria-describedby="reason-hint" />
        <span id="reason-hint" className={`hint${!reasonOk && form.reason.length > 0 ? ' hint-error' : ''}`}>At least 10 characters. Appears in the client report.</span>
      </div>

      <div className="field">
        <div className="label-row">
          <label htmlFor="next-action">Next action <span className="req">required</span></label>
          {form.nextAction !== a.suggestedNextAction && (
            <button type="button" className="link-button" disabled={saving} onClick={() => onChange({ ...form, nextAction: a.suggestedNextAction })}>Use suggested</button>
          )}
        </div>
        <textarea id="next-action" rows={2} value={form.nextAction} disabled={saving} onChange={e => onChange({ ...form, nextAction: e.target.value })} />
      </div>

      <div className="limitations">
        <span className="label">Limitations saved with this decision</span>
        <ul>{a.limitations.map(l => <li key={l}>{l}</li>)}</ul>
      </div>

      <div className="save-row">
        <button className="btn btn-primary" onClick={onSave} disabled={!canSave}>{saving ? <Spinner label="Saving…" /> : label}</button>
        {!saving && !canSave && <span className="hint">{!reasonOk ? 'Add a reason to save.' : !nextOk ? 'Add the next action to save.' : ''}</span>}
        {dirty && !saving && view.latestDecision && <span className="hint">Unsaved changes</span>}
      </div>

      {save.status === 'saved' && (
        <Notice tone="success" title={`${save.decision === 'hold' ? 'Hold' : 'Approved'} decision #${save.decisionId} saved`}>
          Stored at {fmtTime(save.savedAt)}. It remains available after a restart via Saved cases. You can now generate the client report.
        </Notice>
      )}
      {save.status === 'error' && (
        <Notice tone="danger" title={save.code === 'EVIDENCE_CHANGED' ? 'Evidence changed, decision not saved' : save.code === 'APPROVAL_NOT_SUPPORTED' ? 'Approval rejected by the server' : 'Decision not saved'}
          action={save.code === 'EVIDENCE_CHANGED' ? <button className="btn btn-secondary btn-small" onClick={onRevalidate}>Validate evidence</button> : undefined}>
          {save.message}
        </Notice>
      )}

      {view.history.length > 0 && (
        <details className="details history">
          <summary>Decision history ({view.history.length})</summary>
          <ol>
            {view.history.map(h => (
              <li key={h.decisionId}>
                <div><strong>#{h.decisionId} {h.decision === 'hold' ? 'Hold' : `Approve ${h.promotionChangePct}% expansion`}</strong> <span className="muted">{fmtTime(h.savedAt)}</span></div>
                <div className="muted">Evidence <code>{shortHash(h.evidenceFingerprint)}</code>{' '}
                  {h.evidenceFingerprint === a.fingerprint ? <Pill tone="success">Matches current evidence</Pill> : <Pill tone="warning">Earlier evidence</Pill>}
                </div>
                <div>{h.reason}</div>
              </li>
            ))}
          </ol>
        </details>
      )}
    </Section>
  );
}
