import { handle } from '../../../_lib.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Client report built from the latest saved decision, flagged when evidence has since changed. */
export async function GET(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return handle(service => service.generateReport(caseId));
}
