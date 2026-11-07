import type { PGlite } from '@electric-sql/pglite';
import { PERIOD_START, PREVIOUS_START } from './database.ts';
import { getEvidence, METRICS_SQL } from './metrics.ts';
import { retrieveKnowledge, type Document } from './knowledge.ts';
import { propose } from './model.ts';
import { reconcile } from './python.ts';
import { assessScope, validateProposal } from './review.ts';
import type { AnalystContext, Recommendation, Report } from './types.ts';

export const SYSTEM_POLICY = 'Use verifiable figures. State material limitations. External operational notes provide context. A promotion expansion requires comparable complete weekly subscription snapshots and at least 10% growth; allowed expansion is 10%. Otherwise hold. This is a review suggestion, never an executed action.';

export async function analyse(db: PGlite, brandId: string, marketplace = 'US', docs?: Document[]): Promise<Report> {
  const { evidence, quality } = reconcile(await getEvidence(db, brandId, marketplace));
  const documents = docs ?? await retrieveKnowledge(brandId);
  const context: AnalystContext = { systemPolicy: SYSTEM_POLICY, evidence, quality, documents };
  const proposal = propose(context);
  // The model is advisory. The backend assessment (publisher-reconciled evidence + policy) decides what is permitted.
  const assessment = await assessScope(db, brandId, marketplace, { documents });
  const issues = validateProposal(proposal, assessment.policy, documents);
  const recommendation: Recommendation = issues.length === 0 ? proposal : {
    action: assessment.policy.permittedAction, budgetChangePct: assessment.policy.permittedChangePct,
    narrative: `${assessment.policy.headline}. ${assessment.policy.explanation}`, citations: assessment.sourceIds,
  };
  return { evidence, quality, recommendation, trace: { sql: METRICS_SQL, parameters: [brandId, marketplace, PERIOD_START, PREVIOUS_START], context, proposal,
    validation: issues.length ? ['Model proposal rejected:', ...issues] : ['Model proposal matches the validated policy outcome.'] } };
}
