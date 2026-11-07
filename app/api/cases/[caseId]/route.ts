import { handle } from '../../_lib.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reopen a case: revalidates current evidence and compares it with the saved decision. */
export async function GET(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return handle(service => service.getCase(caseId));
}
