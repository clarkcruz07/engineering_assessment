import type { CaseView, ClientReport } from '../../src/workflow.ts';
import type { CaseRow, DecisionRow } from '../../src/reviewStore.ts';

export type { CaseView, ClientReport };
export interface Scope { brandId: string; brandName: string; marketplace: string }
export interface ScopeCatalog { scopes: Scope[]; asOf: string; periods: { current: { start: string; end: string }; previous: { start: string; end: string } } }
export type SavedCase = CaseRow & { latest: Omit<DecisionRow, 'assessment' | 'limitations'> | null; decisionCount: number };
export type Decision = 'hold' | 'approve_expansion';

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init?.headers }, cache: 'no-store' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiFailure(0, 'NETWORK', 'Cannot reach the review backend. Check that the server is running (npm run dev or npm start), then retry.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiFailure(response.status, body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? `The server returned ${response.status}.`);
  }
  return body as T;
}

export const api = {
  scopes: (signal?: AbortSignal) => request<ScopeCatalog>('/api/scopes', { signal }),
  cases: (signal?: AbortSignal) => request<SavedCase[]>('/api/cases', { signal }),
  openCase: (brandId: string, marketplace: string, signal?: AbortSignal) =>
    request<CaseView>('/api/cases', { method: 'POST', body: JSON.stringify({ brandId, marketplace }), signal }),
  getCase: (caseId: string, signal?: AbortSignal) => request<CaseView>(`/api/cases/${encodeURIComponent(caseId)}`, { signal }),
  saveDecision: (caseId: string, body: { decision: Decision; reason: string; nextAction: string; reviewedFingerprint: string }) =>
    request<CaseView>(`/api/cases/${encodeURIComponent(caseId)}/decisions`, { method: 'POST', body: JSON.stringify(body) }),
  report: (caseId: string, signal?: AbortSignal) => request<ClientReport>(`/api/cases/${encodeURIComponent(caseId)}/report`, { signal }),
};
