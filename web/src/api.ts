import type { CalendarResponse, CategoriesResponse, ReportsResponse, SaveCategoryRequest, DashboardResponse, OptionsResponse, RecurringListResponse, SaveRuleRequest, SaveTransactionRequest, TransactionsResponse } from '@grosz/shared/api';

export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: Record<string, string | undefined>;
  constructor(message: string, status: number, fieldErrors: Record<string, string | undefined> = {}) {
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
  calendar: (month: string) => request<CalendarResponse>(`/api/calendar?month=${month}`),
  /** amount: rzeczywista kwota w groszach (rachunki o zmiennej kwocie); brak = jak zaplanowano. */
  pay: (occurrenceId: string, amount?: number) => post<{ ok: boolean }>(`/api/occurrences/${occurrenceId}/pay`, amount === undefined ? {} : { amount }),
  unpay: (occurrenceId: string) => post<{ ok: boolean }>(`/api/occurrences/${occurrenceId}/unpay`),

  options: () => request<OptionsResponse>('/api/options'),
  recurring: () => request<RecurringListResponse>('/api/recurring'),
  createRule: (data: SaveRuleRequest) => post<{ id: string }>('/api/recurring', data),
  updateRule: (id: string, data: SaveRuleRequest) => request<{ ok: boolean }>(`/api/recurring/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  pauseRule: (id: string) => post<{ ok: boolean }>(`/api/recurring/${id}/pause`),
  resumeRule: (id: string) => post<{ ok: boolean }>(`/api/recurring/${id}/resume`),
  deleteRule: (id: string) => request<{ ok: boolean }>(`/api/recurring/${id}`, { method: 'DELETE' }),

  transactions: (params: { month?: string; q?: string }) => {
    const search = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
    return request<TransactionsResponse>(`/api/transactions?${search}`);
  },
  createTransaction: (data: SaveTransactionRequest) => post<{ id: string }>('/api/transactions', data),
  updateTransaction: (id: string, data: SaveTransactionRequest) =>
    request<{ ok: boolean }>(`/api/transactions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTransaction: (id: string) => request<{ ok: boolean }>(`/api/transactions/${id}`, { method: 'DELETE' }),

  reports: (months: 3 | 6 | 12) => request<ReportsResponse>(`/api/reports?months=${months}`),

  categories: (month: string) => request<CategoriesResponse>(`/api/categories?month=${month}`),
  createCategory: (data: SaveCategoryRequest) => post<{ id: string }>('/api/categories', data),
  updateCategory: (id: string, data: { name: string; monthlyLimit: number | null }) =>
    request<{ ok: boolean }>(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  reorderCategories: (ids: string[]) => post<{ ok: boolean }>('/api/categories/reorder', { ids }),
  deleteCategory: (id: string, moveTo: string | null) =>
    request<{ ok: boolean }>(`/api/categories/${id}${moveTo ? `?moveTo=${moveTo}` : ''}`, { method: 'DELETE' }),
};
