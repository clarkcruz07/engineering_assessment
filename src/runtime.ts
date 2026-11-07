import { openDatabase, rebuildMetrics } from './database.ts';
import { ReviewStore, DEFAULT_STORE_DIR } from './reviewStore.ts';
import { createReviewService, type ReviewService } from './workflow.ts';

/**
 * One review service per server process. Startup opens the evidence working copy
 * (.runtime/marketplace, created from the bundled snapshot on first use), rebuilds the
 * derived weekly mart, and opens the review store without modifying saved cases.
 * PUBLISHER_EXPORTS_DIR / REVIEW_STORE_DIR may point at isolated copies (demos, tests).
 */
type Holder = typeof globalThis & { __reviewService?: Promise<ReviewService> };

export function getReviewService(): Promise<ReviewService> {
  const g = globalThis as Holder;
  g.__reviewService ??= (async () => {
    const evidenceDb = await openDatabase();
    await rebuildMetrics(evidenceDb);
    const store = await ReviewStore.open(process.env.REVIEW_STORE_DIR || DEFAULT_STORE_DIR);
    return createReviewService({ evidenceDb, store, exportsDir: process.env.PUBLISHER_EXPORTS_DIR || undefined });
  })().catch(error => { g.__reviewService = undefined; throw error; });
  return g.__reviewService;
}
