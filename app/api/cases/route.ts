import { handle, readJson } from '../_lib.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Saved review cases with their latest decision. */
export function GET() {
  return handle(service => service.listCases());
}

/** Open (or create) the review case for a brand/marketplace and validate its evidence. */
export function POST(request: Request) {
  return handle(async service => service.openCase(await readJson(request)));
}
