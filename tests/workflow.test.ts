import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { openDatabase, rebuildMetrics } from '../src/database.ts';
import { DEFAULT_EXPORTS_DIR } from '../src/publisher.ts';
import { ReviewStore } from '../src/reviewStore.ts';
import { createReviewService, ServiceError, caseIdFor } from '../src/workflow.ts';

// One isolated in-memory evidence copy for the file; every test gets its own review-store directory.
let db: PGlite;
const temps: string[] = [];
before(async () => { db = await openDatabase(true); await rebuildMetrics(db); });
after(async () => { await db.close(); for (const t of temps) await rm(t, { recursive: true, force: true }); });
async function tempDir(prefix: string) { const d = await mkdtemp(path.join(tmpdir(), prefix)); temps.push(d); return d; }

async function rejectsWith(promise: Promise<unknown>, status: number, code: string) {
  await assert.rejects(promise, (e: unknown) => e instanceof ServiceError && e.status === status && e.code === code);
}

test('a saved hold decision survives closing and reopening the review store', async () => {
  const dir = await tempDir('review-store-');
  let store = await ReviewStore.open(dir);
  const opened = await createReviewService({ evidenceDb: db, store }).openCase({ brandId: 'cedar-coast', marketplace: 'US' });
  const service = createReviewService({ evidenceDb: db, store });
  await service.saveDecision(opened.case.caseId, {
    decision: 'hold', reason: 'Requested week is only a partial publisher snapshot.', nextAction: 'Wait for the complete report and revalidate.',
    reviewedFingerprint: opened.assessment.fingerprint,
  });
  await store.close();

  store = await ReviewStore.open(dir);
  try {
    const reopened = createReviewService({ evidenceDb: db, store });
    const cases = await reopened.listCases();
    assert.equal(cases.length, 1);
    assert.equal(cases[0].latest?.decision, 'hold');
    const view = await reopened.getCase(opened.case.caseId);
    assert.equal(view.latestDecision?.reason, 'Requested week is only a partial publisher snapshot.');
    assert.equal(view.latestDecision?.evidenceFingerprint, opened.assessment.fingerprint);
    assert.equal(view.latestDecision?.validationOutcome, 'evidence_insufficient');
    assert.ok(view.latestDecision?.sourceIds.every(id => id.includes('cedar-coast')), 'source ids stay within the case scope');
    assert.equal(view.evidenceStatus, 'current');
    const report = await reopened.generateReport(opened.case.caseId);
    assert.equal(report.status, 'current');
    assert.equal(report.decision.promotionChangePct, 0);
    assert.ok(report.limitations.some(l => /partial|covers/i.test(l)), 'held report explains the limitation');
    assert.equal(report.figures[2].value, 'Not reported', 'no growth figure from a partial snapshot');
  } finally { await store.close(); }
});

test('the backend rejects unsupported approval even from a crafted request', async () => {
  const store = await ReviewStore.open(await tempDir('review-store-'));
  try {
    const service = createReviewService({ evidenceDb: db, store });
    for (const [brandId, marketplace] of [['cedar-coast', 'US'], ['moss-trail', 'US'], ['harbor-pantry', 'CA']]) {
      const view = await service.openCase({ brandId, marketplace });
      assert.equal(view.assessment.policy.eligibleForExpansion, false, `${brandId} ${marketplace}`);
      await rejectsWith(service.saveDecision(view.case.caseId, {
        decision: 'approve_expansion', reason: 'Client asked for the campaign to expand.', nextAction: 'Expand by 20%.',
        reviewedFingerprint: view.assessment.fingerprint,
        // Fields a browser could forge; the backend must ignore them.
        eligibleForExpansion: true, promotionChangePct: 20, growthPct: 217.31, activeSubscriptions: 24750,
      }), 422, 'APPROVAL_NOT_SUPPORTED');
      assert.equal((await service.getCase(view.case.caseId)).latestDecision, null, 'nothing was persisted');
    }
    // Model advice that leans on an operational note is rejected, not obeyed.
    const cedar = await service.getCase(caseIdFor('cedar-coast', 'US'));
    assert.equal(cedar.assessment.model.accepted, false);
    assert.ok(cedar.assessment.model.issues.some(i => /operational note/.test(i)));
    await rejectsWith(service.saveDecision(cedar.case.caseId, { decision: 'hold', reason: 'short', nextAction: 'x', reviewedFingerprint: cedar.assessment.fingerprint }), 400, 'INVALID_DECISION');
    await rejectsWith(service.openCase({ brandId: 'cedar-coast', marketplace: 'CA' }), 404, 'UNKNOWN_SCOPE');
  } finally { await store.close(); }
});

test('healthy control: complete, reconciled, comparable growth can be approved at the policy limit only', async () => {
  const store = await ReviewStore.open(await tempDir('review-store-'));
  try {
    const service = createReviewService({ evidenceDb: db, store });
    const view = await service.openCase({ brandId: 'lumen-home', marketplace: 'US' });
    const a = view.assessment;
    assert.equal(a.policy.eligibleForExpansion, true);
    assert.equal(a.findings.filter(f => f.severity === 'blocking').length, 0);
    assert.equal(a.current.reconciliation.status, 'reconciled');
    assert.ok(a.growth.exactPct !== null && a.growth.exactPct >= 10);
    const saved = await service.saveDecision(view.case.caseId, {
      decision: 'approve_expansion', reason: 'Complete reconciled snapshots show growth above 10%.', nextAction: 'Send to brand manager.',
      reviewedFingerprint: a.fingerprint, promotionChangePct: 25,
    });
    assert.equal(saved.latestDecision?.decision, 'approve_expansion');
    assert.equal(saved.latestDecision?.promotionChangePct, 10, 'percentage comes from policy, not the request');
    assert.equal(saved.latestDecision?.validationOutcome, 'expansion_supported');
    assert.equal((await service.generateReport(view.case.caseId)).decision.promotionChangePct, 10);
  } finally { await store.close(); }
});

test('changed publisher evidence marks a prior approval as requiring attention and blocks reuse', async () => {
  const storeDir = await tempDir('review-store-');
  const exportsCopy = await tempDir('exports-copy-');
  await cp(DEFAULT_EXPORTS_DIR, exportsCopy, { recursive: true });
  const store = await ReviewStore.open(storeDir);
  try {
    const original = createReviewService({ evidenceDb: db, store, exportsDir: exportsCopy });
    const lumen = await original.openCase({ brandId: 'lumen-home', marketplace: 'US' });
    const lumenCa = await original.openCase({ brandId: 'lumen-home', marketplace: 'CA' });
    await original.saveDecision(lumen.case.caseId, { decision: 'approve_expansion', reason: 'Growth above threshold on complete snapshots.', nextAction: 'Send to brand manager.', reviewedFingerprint: lumen.assessment.fingerprint });

    // The publisher restates one offer in the current report; the report identifier stays the same.
    const reportId = lumen.assessment.current.supported.publisherReportId!;
    const offersFile = path.join(exportsCopy, 'subscription_offers.csv');
    const lines = (await readFile(offersFile, 'utf8')).split(/\r?\n/);
    const index = lines.findIndex(l => l.startsWith(`${reportId},`));
    const cols = lines[index].split(',');
    cols[3] = String(Number(cols[3]) + 500);
    lines[index] = cols.join(',');
    await writeFile(offersFile, lines.join('\n'));

    const after = await original.getCase(lumen.case.caseId);
    assert.equal(after.evidenceStatus, 'changed');
    assert.notEqual(after.assessment.fingerprint, lumen.assessment.fingerprint);
    assert.equal(after.latestDecision?.decision, 'approve_expansion', 'history is not rewritten');
    assert.equal(after.assessment.policy.eligibleForExpansion, false, 'internal import no longer reconciles with the publisher');
    const report = await original.generateReport(lumen.case.caseId);
    assert.equal(report.status, 'requires_attention');
    await rejectsWith(original.saveDecision(lumen.case.caseId, { decision: 'approve_expansion', reason: 'Re-approving the old evidence.', nextAction: 'Send it.', reviewedFingerprint: lumen.assessment.fingerprint }), 409, 'EVIDENCE_CHANGED');
    await rejectsWith(original.saveDecision(lumen.case.caseId, { decision: 'approve_expansion', reason: 'Re-approving after revalidation.', nextAction: 'Send it.', reviewedFingerprint: after.assessment.fingerprint }), 422, 'APPROVAL_NOT_SUPPORTED');
    const held = await original.saveDecision(lumen.case.caseId, { decision: 'hold', reason: 'Publisher restated the current report.', nextAction: 'Re-import and revalidate.', reviewedFingerprint: after.assessment.fingerprint });
    assert.equal(held.evidenceStatus, 'current');
    assert.equal(held.history.length, 2);
    // Scope isolation: another marketplace of the same brand is unaffected.
    assert.equal((await original.getCase(lumenCa.case.caseId)).assessment.fingerprint, lumenCa.assessment.fingerprint);
  } finally { await store.close(); }
});

test('every bundled scope opens through the same workflow with scope-isolated sources', async () => {
  const store = await ReviewStore.open(await tempDir('review-store-'));
  try {
    const service = createReviewService({ evidenceDb: db, store });
    const scopes = await service.listScopes();
    assert.ok(scopes.length >= 2);
    for (const s of scopes) {
      const v = await service.openCase(s);
      assert.equal(v.assessment.scope.brandId, s.brandId);
      for (const p of [v.assessment.current, v.assessment.previous]) {
        for (const r of p.publisher.available) assert.ok(r.brandId === s.brandId && r.marketplace === s.marketplace);
        assert.ok(p.internal.imports.every(i => i.reportId.startsWith(s.brandId)));
      }
      assert.equal(v.assessment.policy.eligibleForExpansion, v.assessment.policy.permittedAction === 'expand_promotion');
    }
  } finally { await store.close(); }
});
