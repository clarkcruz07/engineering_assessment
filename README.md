# Stonecutter: Engineering Assessment

A two-hour engineering assessment for the Senior Software Engineer, AI & Data Platform role.
All companies, documents and records in this project are synthetic.

## Review application

The submitted solution is a Next.js review workspace: `npm ci`, `npm run setup`, `npm run build`, `npm start`, then open http://localhost:3000. See [SOLUTION.md](SOLUTION.md) for usage, findings, architecture and tests.

## The business problem

Our team uses an internal application to prepare weekly marketplace performance reports
for several brands. For **Cedar & Coast**, the latest report shows a sharp increase in
active subscriptions. Its AI-generated commentary describes this as strong growth and
recommends expanding the subscription promotion.

Operations cannot reconcile the reported figures with the source reports and has asked
us to investigate before sharing the report with the client.

**Build a usable solution that helps marketplace operations investigate conflicting figures,
understand which results can be trusted, and decide what to do next.** Use the supplied
application and data as your starting point. Choose the interface, architecture and storage for the required review operation.

## What to build

Choose one concrete decision or task for an operations manager preparing a client report.
Deliver **one complete usable workflow**: the user can start from a documented entry point,
understand the discrepancy and its evidence, and reach a supported outcome or next action.
Implement at least one verifiable correctness improvement that supports that workflow.
Show what changed and which limitations remain.

A working visual artifact is required to operate one complete review: open a case,
investigate evidence, validate a correction, persist the decision and generate the client
report. Read [ASSESSMENT.md](ASSESSMENT.md) for the full assessment requirements. A screen that only
fetches/displays figures or a generated report alone is insufficient. Save the case with
source/result/reason/limitation evidence; stop, restart and reopen it. Enforce unsupported
approval blocking in the backend and revalidate when evidence changes.

Build the artifact as a **React + TypeScript** application, either on **Next.js** (App Router,
with route handlers or server actions as the backend) or as a **Vite + React** frontend calling
a **FastAPI** backend. A static or hand-written HTML/JavaScript page does not qualify, even
when a backend serves it. Choose your own components, styling, storage and what to present;
add derived review tables or a separate local store without changing raw inputs. The starter
is a CLI with no frontend; creating the application is your construction task.
One complete path is enough, but the user must be able to open a case for **any brand and
marketplace** in the data and see the inconsistencies your app detects; authentication,
deployment and a general case platform are not required. You do not need to modify every language.

Keep the scope small enough to finish in **120 minutes**. Prioritize one working path and
verify its result. You do not need to correct every defect or build a
production platform. Focused partial work is welcome; explain what works and what does not.

## Ground rules

- **Publisher exports are authoritative.** `data/exports/` holds the publisher's own records.
  Internal documentation, including `DATA_DICTIONARY.md`, may be out of date; when they
  disagree, the exports win.
- **Source data is a fixed contract.** Do not edit `data/marketplace.pglite`, `data/exports/`
  or the `raw.*` table definitions. Views, marts, SQL, application code and tests may change.
- **We may check relevant behavior against a different dataset** with the same schema and
  business contracts. Do not hardcode IDs or figures. Existing CLI/module interfaces may
  change; document your entry point and how to verify it. We adapt the evaluation to your
  chosen scope and interfaces. Tests are one source of evidence, not the whole assessment.
- **Treat `src/model.ts` as a third-party model provider.** It is deterministic for local
  execution. You may change how the application uses or validates its output. A real LLM
  is not required. Your submitted workflow must run locally without paid services,
  external API keys, a cloud account or deployment.

## Quick start

Prerequisites: **Node.js 22 or 24 LTS**, npm, **Python 3.11+** (with venv/pip), and internet access for the initial dependency
installation. Verified on macOS; Windows and Linux have not been tested. The commands
use Node/npm without shell-specific syntax. No API keys, cloud
accounts, Docker, database server or paid services are needed. After installation,
the application runs offline. Extract the ZIP and open a terminal inside `engineering-assessment`;
it is already a Git repository (`git log` shows the `starter` commit).

```sh
npm ci
npm run setup
npm run demo
npm test
```

`npm run setup` creates `.venv` and installs pytest. No activation is needed. `npm test`
runs both TypeScript and Python tests; `npm run test:python` runs pytest alone.
The runtime Python module uses only the standard library. If Python is installed under
a custom path, set `PYTHON` to that executable before setup. Runtime and tests prefer the created `.venv`.

The database is included as `data/marketplace.pglite`, a compressed PostgreSQL data-directory
snapshot loaded by PGlite. The first command opens a working copy under `.runtime/`.
Run commands from this project directory. If your Node version differs, check `node --version`.
For a setup blocker, contact the person who sent the assessment; report the error and time
spent rather than spending the exercise troubleshooting your environment.

## Investigating

```sh
npm run demo -- --trace
npm run report -- --brand lumen-home --json
npm run query -- "SELECT * FROM brands"
npm run query -- "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('raw','marts','public')"
npm run query -- "SELECT * FROM raw.subscription_reports WHERE brand_id='cedar-coast' ORDER BY period_start DESC, revision DESC LIMIT 9"
npm run typecheck
```

`--trace` exposes the selection SQL, metric SQL, source report identifiers, timestamps,
retrieved documents, assembled context, model proposal and validation outcome.
`--json` emits the complete result. `query` executes SQL in a read-only transaction.
Use `node --import tsx main.ts report --brand cedar-coast --json` if you need JSON without npm's script banner.

The exercise clock is fixed at **2026-10-06 12:00 UTC**, reporting week **2026-09-28 through
2026-10-04**, compared with the preceding week. Your computer's current date is irrelevant.
The bundled fixture covers the US and CA marketplaces in USD; the demo shows one scope only. See [DATA_DICTIONARY.md](DATA_DICTIONARY.md)
for definitions and source contracts. You do not need prior Amazon domain knowledge.

## Project map

```text
main.ts                    CLI: report, query, reset
src/database.ts            PostgreSQL snapshot loading and metric rebuild
src/metrics.ts             SQL evidence and per-report source totals
python/reconcile.py        Source-to-mart reconciliation, growth and quality
src/python.ts              Local JSON bridge to Python
src/knowledge.ts           Retrieval of operational notes
src/model.ts               Deterministic offline model provider
src/analyst.ts             Context, recommendation and validation
sql/                       Schema and report-selection query
data/                      Database, manifest, publisher exports and operational notes
scripts/python.ts          Python setup and pytest runner
tests/                     Starter smoke tests
```

The report command rebuilds the weekly mart using the current SQL before answering.
SQL evidence passes through `python/reconcile.py` before TypeScript constructs the analyst
context. The bridge sends one JSON object on stdin and reads `{evidence, quality}` on stdout;
Python never opens the database. `sourceSnapshots` holds selected-report offer totals;
`sourceTotal` and `reconciliationDelta` expose the comparison with the mart.
You may change any layer; changes in every language are not required.
The model consumes the actual retrieved notes and evidence; it is deliberately a small,
deterministic provider, not a general chatbot. No real model integration is expected.
Starter tests verify basic execution and are not comprehensive business-correctness tests.

`npm run reset` removes only the local working copy; it does not contact external services.
The bundled snapshot and exports never change.

## Time and submission

Stop after **120 minutes**, including reading, setup, investigation, changes, tests, notes
and recording. You can choose when to work before the deadline communicated by the sender.
Please report approximate time spent and any environment issues; partial work is acceptable.

Reply through the same channel that delivered the assessment with:

1. A Git repository link accessible to the hiring team (GitHub, GitLab or Bitbucket; a private
   repository is fine if you grant access). This project is already a Git repository with one
   initial commit tagged `starter`: keep that history, commit as you work and push it. We review
   your changes as `git diff starter..HEAD`. Where practical, commit a failing test before the
   fix that makes it pass. Commit count and message style are not evaluated. Include your source,
   lockfile, bundled data and tests; the provided `.gitignore` already excludes `node_modules/`,
   `.runtime/`, `.venv/` and Python caches.
2. Short notes in `SOLUTION.md`: the intended user and task; exact steps to run the workflow, save a decision, stop/restart/reopen it and generate the report;
   what did not reconcile and your verified before/after result; visual hierarchy and state/interaction decisions; architecture, data flow, persistence/state transitions and validation boundaries;
   tests or commands supporting your claims; limitations, unfinished work and actual time spent.
   Keep this concise. No exhaustive ledger or design document is required.
3. A Loom or equivalent video of **no more than three minutes**, in English. Start by using
   the solution as the intended user: show the entry point, interaction, result and next step.
   Then explain one important correction and the technical decision that supports it.
   Screen recording with narration is enough. Check that the team can open the link.

Stop at the time limit, even if unfinished. No deployment, introductory video or additional
take-home is required. Record actual time spent; AI assistance is allowed throughout.

## AI tools and evaluation

Claude, Codex, ChatGPT, Cursor and other AI coding assistants are explicitly allowed.
You remain responsible for checking results and explaining your implementation. We do
not use AI-detection tools or require conversation transcripts.

We evaluate **usefulness and scope, data correctness, backend reliability, interaction design,
and evidence and communication**. We will try your documented workflow as a user, inspect
its implementation and test relevant behavior. Visual and interaction design carries the
largest weight (30 of 100): what you chose to present, scanability, spacing, control behavior,
loading/empty/error states and the frontend source, alongside architecture and data
correctness. Visual decoration, feature count, the choice between the two permitted stacks
and changing more languages do not earn points by themselves. A useful outcome must also be trustworthy.

We evaluate your submission from the repository, SOLUTION.md and video alone. No extra
take-home work is required.
