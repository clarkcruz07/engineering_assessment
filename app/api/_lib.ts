import { getReviewService } from '../../src/runtime.ts';
import { ServiceError, type ReviewService } from '../../src/workflow.ts';

export interface ApiError { error: { code: string; message: string; details?: unknown } }

export async function handle(fn: (service: ReviewService) => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn(await getReviewService()));
  } catch (error) {
    if (error instanceof ServiceError) {
      return Response.json({ error: { code: error.code, message: error.message, details: error.details } } satisfies ApiError, { status: error.status });
    }
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: { code: 'BACKEND_FAILURE', message: `The review backend failed: ${message}. Check the server terminal. If another process (for example the CLI) is using .runtime/marketplace, stop it and retry.` } } satisfies ApiError, { status: 500 });
  }
}

export async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); }
  catch { throw new ServiceError(400, 'INVALID_JSON', 'The request body must be JSON.'); }
}
