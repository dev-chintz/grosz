import type { ImportRow } from '@grosz/shared/import';
import type { ImportBatchDto, ImportCommitRequest, ImportPreviewResponse, CalendarResponse, CategoriesResponse, ReportsResponse, SaveAccountRequest, SaveHouseholdRequest, SaveMemberRequest, SettingsResponse, SaveCategoryRequest, DashboardResponse, OptionsResponse, RecurringListResponse, SaveRuleRequest, SaveTransactionRequest, TransactionsResponse, UpdateStatusResponse } from '@grosz/shared/api';

/** Zdarzenie okna: zmieniono nazwę gospodarstwa (detail = nowa nazwa). Odświeża kartę w sidebarze. */
export const HOUSEHOLD_CHANGED = 'grosz:household-changed';
/** Sesja wygasła lub ktoś się wylogował w innej karcie — AuthGate pokazuje ekran logowania. */
export const UNAUTHORIZED = 'grosz:unauthorized';

/** Szczegóły zdarzenia HOUSEHOLD_CHANGED: tylko pola, które się zmieniły. */
export interface HouseholdChange {
  name?: string;
  memberCount?: number;
}

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
  if (response.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED));
  if (!response.ok) throw new ApiError(body?.error ?? `Błąd serwera (${response.status})`, response.status, body?.errors);
  return body as T;
}

const post = <T>(path: string, data?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(data ?? {}) });

export interface AuthStatus {
  authenticated: boolean;
  user: { id: string; name: string; login: string } | null;
  setupRequired: boolean;
}

export const api = {
  updateStatus: () => request<UpdateStatusResponse>('/api/update/status'),
  startUpdate: () => post<{ ok: boolean }>('/api/update'),
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  login: (login: string, password: string) => post<{ ok: boolean }>('/api/auth/login', { login, password }),
  setup: (data: { code: string; name: string; login: string; password: string }) => post<{ ok: boolean }>('/api/auth/setup', data),
  logout: () => post<{ ok: boolean }>('/api/auth/logout'),
  changePassword: (current: string, next: string) => post<{ ok: boolean }>('/api/auth/password', { current, next }),

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

  /** user: id osoby albo „none” (operacje wspólne); brak = wszyscy. account: id konta albo „none”; brak = wszystkie. */
  transactions: (params: { month?: string; q?: string; user?: string; account?: string }) => {
    const search = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
    return request<TransactionsResponse>(`/api/transactions?${search}`);
  },
  createTransaction: (data: SaveTransactionRequest) => post<{ id: string }>('/api/transactions', data),
  updateTransaction: (id: string, data: SaveTransactionRequest) =>
    request<{ ok: boolean }>(`/api/transactions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTransaction: (id: string) => request<{ ok: boolean }>(`/api/transactions/${id}`, { method: 'DELETE' }),

  importPreview: (rows: ImportRow[]) => post<ImportPreviewResponse>('/api/import/preview', { rows }),
  importCommit: (data: ImportCommitRequest) => post<{ batchId: string; created: number; matched: number }>('/api/import/commit', data),
  importBatches: () => request<ImportBatchDto[]>('/api/import/batches'),
  undoImport: (id: string) => request<{ ok: boolean }>(`/api/import/batches/${id}`, { method: 'DELETE' }),

  reports: (months: 3 | 6 | 12) => request<ReportsResponse>(`/api/reports?months=${months}`),

  settings: () => request<SettingsResponse>('/api/settings'),
  updateHousehold: (data: SaveHouseholdRequest) => request<{ ok: boolean }>('/api/settings/household', { method: 'PUT', body: JSON.stringify(data) }),
  createAccount: (data: SaveAccountRequest) => post<{ id: string }>('/api/accounts', data),
  updateAccount: (id: string, data: SaveAccountRequest) => request<{ ok: boolean }>(`/api/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  archiveAccount: (id: string) => post<{ ok: boolean }>(`/api/accounts/${id}/archive`),
  restoreAccount: (id: string) => post<{ ok: boolean }>(`/api/accounts/${id}/restore`),
  createMember: (data: SaveMemberRequest) => post<{ id: string }>('/api/members', data),
  updateMember: (id: string, data: SaveMemberRequest) => request<{ ok: boolean }>(`/api/members/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMember: (id: string) => request<{ ok: boolean }>(`/api/members/${id}`, { method: 'DELETE' }),

  categories: (month: string) => request<CategoriesResponse>(`/api/categories?month=${month}`),
  createCategory: (data: SaveCategoryRequest) => post<{ id: string }>('/api/categories', data),
  updateCategory: (id: string, data: { name: string; monthlyLimit: number | null }) =>
    request<{ ok: boolean }>(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  reorderCategories: (ids: string[]) => post<{ ok: boolean }>('/api/categories/reorder', { ids }),
  deleteCategory: (id: string, moveTo: string | null) =>
    request<{ ok: boolean }>(`/api/categories/${id}${moveTo ? `?moveTo=${moveTo}` : ''}`, { method: 'DELETE' }),
};
