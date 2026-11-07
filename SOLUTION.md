# Evidence Review: solution notes

## User and task

An operations manager preparing the weekly client report (week **28 Sep – 4 Oct 2026** vs **21 – 27 Sep 2026**, fixed clock **6 Oct 2026 12:00 UTC**) needs to know whether the subscription figures and the promotion recommendation can be trusted. **Evidence Review** is a Next.js (App Router) app. The manager can open a case for any brand/marketplace, check the internal pipeline against the publisher exports, save a decision that the backend enforces, generate the client report from that saved decision, and reopen it after a restart.

## Run it

Requires Node.js (22/24 LTS per `package.json`; I also verified it on 20.19.4, where npm prints an `EBADENGINE` warning) and Python 3.11+.

```sh
npm ci
npm run setup          # Python venv for the CLI bridge and pytest
npm run build
npm start              # http://localhost:3000   (or: npm run dev)
```

- **First start:** creates `.runtime/marketplace` from the bundled snapshot and rebuilds the weekly mart. This took about 6 s here; later starts took about 3 s.
- **Stop:** press `Ctrl+C`. **Restart:** run `npm start` again. Saved cases live in `.runtime/review-store` and are never reset on startup.
- **Reset the evidence copy:** `npm run reset` removes only `.runtime/marketplace`. Saved reviews are kept.
- **Delete all saved reviews (destructive):** `npm run reset:reviews`.
- **Don't run CLI commands (`npm run report`, `query`) while the app is running.** Both use the same PGlite working copy, and PGlite supports one process at a time.
- **Checks:** `npm test` (TypeScript + pytest), `npm run typecheck`, `npm run demo -- --trace` (the CLI now uses the same policy gate).

## Using the workflow

1. Choose **Brand** and **Marketplace** (populated from `raw.subscription_reports`; 7 scopes), then click **Open review case**. The case is created, or reopened if it exists, and validated.
2. Read the **summary** (status, main issue, next action), then the **Evidence** panel:
   - internal pipeline vs publisher for both weeks;
   - coverage, comparability, freshness and reconciliation checks;
   - detected inconsistencies;
   - the advisory model output and whether validation accepted it;
   - expandable source reports with timestamps, control totals and the evidence fingerprint.
3. In **Review decision**, choose the decision, write a reason, accept or edit the next action, and click **Save hold decision** or **Save approved decision**. Approval is only selectable when policy permits it, and the server rejects it otherwise.
4. Click **Generate client report** to render the report from the saved decision.
5. To reopen, use **Saved cases → Reopen case**. Reopening revalidates the evidence and compares it with the saved decision's fingerprint.

## Inconsistencies found (publisher exports are authoritative)

| Scope | What the starter did | Supported result |
|---|---|---|
| Cedar & Coast US | Summed three partial revisions: **24,750** vs 7,800, "+217.31%". The model then took "20%" from `cedar-campaign.md`, and the shape-only validation accepted it. | Latest publisher report `…09-28-g3` is **partial** (data to 2 Oct): **8,400**. Growth is not comparable, so the only outcome is **hold**. The note's request to hide caveats and expand by 20% is rejected. |
| Harbor Pantry CA | Summed r3+r4+r5. The highest revision (r5) is a re-import of `g3`, which the publisher superseded with `g4`. | `g4` = **3,780** vs 3,600 = **+5.00%**, so hold (below threshold). Ranking by revision would give 4,000 (+11.1%) and falsely qualify. |
| Moss Trail US | The previous-week import `w11-r3` loaded 100 of 120 offers (5,213 vs a declared 6,300), yet the import job recorded "success". Internal data shows **+17.02%**. | Publisher: 6,100 vs 6,300 = **−3.17%**. The reconciliation mismatch blocks approval, so hold. |
| Lumen Home US / CA | Same revision summing. | Complete, reconciled, fresh: **+15.00% / +12.00%**, so a **10%** expansion suggestion is permitted (healthy path). |
| Harbor US, Orbit US | Same revision summing. | +2.00% / 0.00%: hold. |

## Verified correction

**Defect:** `sql/select-reports.sql` ranked reports by status only (`DENSE_RANK`), so every same-status revision tied and the mart **summed snapshots**. The fix uses `ROW_NUMBER` and selects exactly one report per scope/week: complete first, then greatest `period_end`, then the publisher's `generated_at`, then revision. The internal revision is only the final tie-break, because a later import can carry a superseded publisher report.

- **Regression test:** `tests/selection.test.ts`, committed failing before the fix (commit `d2124a2`). Its oracle reads the publisher exports directly. It asserts one source report per mart row, that the mart total equals that snapshot's offers, and that the chosen report is the publisher's current one.
- **Before:** `npm run demo` at `starter` printed `Active subscriptions: 24,750 | Previous: 7,800 | Change: 217.31% | Data quality: ready`, followed by "Expand … by 20%". This is a historical capture from that command.
- **After:** `8,400 | 7,800 | Change: unavailable% | Data quality: insufficient`, followed by "Hold required … partial snapshot only". (The `unavailable%` formatting comes from the starter CLI printer.)

**Supporting corrections:**
- `src/review.ts` reconciles independently against `data/exports` (offer-by-offer, header control totals, supersession, availability at the clock).
- The Python quality gate now requires complete, comparable snapshots.
- The model's proposal is accepted only if it exactly matches the backend policy outcome.

**Tests (`npm test`; all passing in my run):**
- **TypeScript (10):** 4 starter, 1 regression, and 5 workflow tests:
  - persistence across store close/reopen;
  - a crafted approval with forged `eligibleForExpansion`/`promotionChangePct` for Cedar, Moss and Harbor CA is rejected with **422**;
  - healthy Lumen US approval, with the percentage forced to the policy's 10%;
  - changed evidence on an **isolated copy** of the exports: the old approval is flagged `changed`/`requires_attention`, a stale fingerprint gets **409**, re-approval gets **422**, history is preserved, and Lumen CA is unaffected;
  - all 7 scopes open with scope-isolated sources.
- **Python:** 4 tests, including one new partial-snapshot test.

**Also run manually:**
- **HTTP against `next start`:** crafted approval 422, stale fingerprint 409, invalid JSON 400, unknown case 404, hold saved. I then killed the server, restarted it, and the case reopened with `evidenceStatus: current` and its report generated.
- **Headless Chrome against the production build:**
  - Cedar opened with approval disabled; the hold was saved and the report generated.
  - An unsaved edit showed the "not included" notice.
  - Changing scope cleared the old case.
  - Lumen allowed approval; Moss showed the mismatch.
  - Reopening from Saved cases worked.
  - There was no horizontal overflow at 390 px and no console errors.

## Design and interaction choices

- **One page, top to bottom in task order:** scope → summary → evidence | decision (side by side on wide screens, stacked below 1080 px) → client report. There's no sidebar, no charts and no KPI decoration. The summary shows only the three supported figures and the next action.
- **Comparison table:** puts *Internal pipeline* beside *Publisher (authoritative)*, with source IDs and coverage under each number and a reconciliation pill per row. Growth reads "Not reported" when snapshots aren't comparable.
- **Status uses text plus icon, never colour alone:** "Blocks approval", "Warning", "Context". There's a single blue accent. Labels are associated with inputs, focus rings are visible, and failures use `role="alert"`.
- **Model commentary** sits in a dashed "Unvalidated" box with the validation verdict and reasons. Retrieved notes are collapsed and labelled "context only".
- **States:**
  - loading scopes, or the initial empty state with three steps;
  - opening/validating spinners;
  - no saved cases;
  - backend or network failure with a recovery hint and a *Try again* button;
  - an unknown value is shown as "Unknown, not zero";
  - partial or missing evidence comes with explicit findings;
  - saving (controls disabled, so submissions can't repeat);
  - a persistent success notice;
  - 409 and 422 shown inline with a **Validate evidence** action;
  - "Requires attention" when the evidence changed;
  - "Unsaved edits are not included" and "Out of date" on the report.
- **Scope changes:** changing brand/marketplace clears the previous case, form and report. Each case request has a sequence number and an `AbortController`, so a late response can't overwrite a newer selection.

## Architecture and data flow

```
Browser (React client components, app/_components/*)
  → Route handlers app/api/{scopes,cases,cases/[id],cases/[id]/decisions,cases/[id]/report}
  → src/workflow.ts  (service: open/get/save/report, ServiceError → HTTP status)
      → src/review.ts     assessScope(): internal imports + mart (PGlite evidence copy)
                          ⨯ publisher exports (src/publisher.ts, re-read per request)
                          → findings, policy outcome, model validation, limitations, fingerprint
      → src/reviewStore.ts  review.cases / review.decisions (separate PGlite store)
```

- **Evidence store:** `.runtime/marketplace`, a working copy of the bundled snapshot. Startup only rebuilds the derived `marts.subscription_weekly`. Raw tables, exports and `src/model.ts` are unchanged (`git diff starter -- data sql/schema.sql src/model.ts` is empty).
- **Review store (owned by the app):** `.runtime/review-store`, a separate PGlite data directory. `review.cases` holds one row per brand/marketplace/week (id `brand--market--week`). `review.decisions` is **append-only**; each row holds:
  - decision, permitted %, reason, next action, validation outcome;
  - evidence fingerprint, supported current/previous figures, unrounded growth;
  - source IDs, limitations, and the full assessment snapshot.

  The latest row is the current decision. The schema is created with `IF NOT EXISTS`, so startup never deletes anything. Only `npm run reset:reviews` removes it.
- **Validation boundary:** the browser sends only `decision`, `reason`, `nextAction` and `reviewedFingerprint`. The server recomputes the assessment, then:
  - rejects a stale fingerprint (409);
  - rejects approval unless the evidence is eligible (422);
  - derives the percentage itself (10% or 0).

  Eligibility requires zero blocking findings (complete, comparable, publisher and internal reconciled, fresh ≤ 48 h) and unrounded growth ≥ 10%.
- **Changed evidence:** the fingerprint is the SHA-256 of the scope, clock, policy version, every available publisher header for both weeks, the selected publisher offers (id, ASIN, count), internal import metadata, and an md5 of the selected internal offer rows. It therefore changes even if a report ID doesn't. On reopen or report generation, a mismatch sets `evidenceStatus = changed`; the report is marked *requires attention* and approval needs a new review. Old decisions are never rewritten.
- **Demoing changed evidence:** copy `data/exports` to a folder, edit one value, then start with `PUBLISHER_EXPORTS_DIR` pointing at the copy. In PowerShell: `$env:PUBLISHER_EXPORTS_DIR="C:\path\copy"; npm start`.

## Tradeoffs and limitations

- **Supported figures come from the publisher export;** the internal pipeline is what gets reconciled. Any internal mismatch blocks approval. That is conservative: a scope with good publisher data but a broken import must be re-imported before it can be approved.
- **The "previous mart method would report X" note** is a diagnostic computed on the fly from the imports. The broken production logic itself was removed.
- **Not covered:** sales, advertising and inventory are not shown in the app (the starter CLI still prints them).
- **Single-process, local only:** there are no users or auth, and PGlite allows one process per data directory.
- **Decision IDs can skip numbers** after a forced kill (normal Postgres sequence behaviour).
- **Audit timestamps** (`created_at`, `saved_at`) use the real clock; all business logic uses the fixed scenario clock.
- **The UI is verified only by my scripted headless-Chrome run,** not by an automated UI test kept in the repo.
- **The CLI `report` output** keeps the starter's format (e.g. `unavailable%`).

## Time spent

- **This AI-assisted session:** about 35 minutes of wall-clock time, from extracting the repo (22:20 local) to these notes, including reading, setup, investigation, build, tests and docs.
- **Candidate time outside this session** (reading the brief beforehand, reviewing, recording the video): **to be confirmed by the candidate**: ____ minutes. **Total:** ____ minutes.
