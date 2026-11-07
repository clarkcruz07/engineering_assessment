import { handle, readJson } from '../../../_lib.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Save a decision. Only decision, reason, nextAction and reviewedFingerprint are read; eligibility is recomputed. */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return handle(async service => service.saveDecision(caseId, await readJson(request)));
}
