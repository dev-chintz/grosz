import type { DashboardResponse, OptionsResponse, RecurringListResponse, SaveRuleRequest } from '@grosz/shared/api';
import type { RuleInputErrors } from '@grosz/shared/recurring';

export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: RuleInputErrors;
  constructor(message: string, status: number, fieldErrors: RuleInputErrors = {}) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.error ?? `Błąd serwera (${response.status})`, response.status, body?.errors);
  return body as T;
}

const post = <T>(path: string, data?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(data ?? {}) });

export const api = {
  dashboard: (month: string) => request<DashboardResponse>(`/api/dashboard?month=${month}`),
  pay: (occurrenceId: string) => post<{ ok: boolean }>(`/api/occurrences/${occurrenceId}/pay`),
  unpay: (occurrenceId: string) => post<{ ok: boolean }>(`/api/occurrences/${occurrenceId}/unpay`),

  options: () => request<OptionsResponse>('/api/options'),
  recurring: () => request<RecurringListResponse>('/api/recurring'),
  createRule: (data: SaveRuleRequest) => post<{ id: string }>('/api/recurring', data),
  updateRule: (id: string, data: SaveRuleRequest) => request<{ ok: boolean }>(`/api/recurring/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  pauseRule: (id: string) => post<{ ok: boolean }>(`/api/recurring/${id}/pause`),
  resumeRule: (id: string) => post<{ ok: boolean }>(`/api/recurring/${id}/resume`),
  deleteRule: (id: string) => request<{ ok: boolean }>(`/api/recurring/${id}`, { method: 'DELETE' }),
};
