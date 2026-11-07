import { handle } from '../_lib.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Valid brand/marketplace scopes from the data, plus the fixed reporting clock and periods. */
export function GET() {
  return handle(async service => ({ scopes: await service.listScopes(), asOf: service.asOf, periods: service.periods }));
}
