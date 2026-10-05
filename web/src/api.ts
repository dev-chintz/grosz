import type { DashboardResponse } from '@grosz/shared/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? body?.message ?? `Błąd serwera (${response.status})`);
  return body as T;
}

export const api = {
  dashboard: (month: string) => request<DashboardResponse>(`/api/dashboard?month=${month}`),
  pay: (occurrenceId: string) => request<{ ok: boolean }>(`/api/occurrences/${occurrenceId}/pay`, { method: 'POST', body: '{}' }),
  unpay: (occurrenceId: string) => request<{ ok: boolean }>(`/api/occurrences/${occurrenceId}/unpay`, { method: 'POST' }),
};
