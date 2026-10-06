// Kategorie: dane formularza i wspólna walidacja dla przeglądarki i serwera.

export interface CategoryInput {
  name: string;
  direction: 'expense' | 'income';
  /** Miesięczny limit w groszach; null = bez limitu. Ignorowany dla wpływów. */
  monthlyLimit: number | null;
}

export type CategoryInputErrors = Partial<Record<keyof CategoryInput, string>>;

export function validateCategoryInput(input: CategoryInput, existingNames: readonly string[] = []): CategoryInputErrors {
  const errors: CategoryInputErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = 'Podaj nazwę kategorii.';
  else if (name.length > 60) errors.name = 'Nazwa może mieć najwyżej 60 znaków.';
  else if (existingNames.some((n) => n.trim().toLocaleLowerCase('pl') === name.toLocaleLowerCase('pl'))) {
    errors.name = 'Taka kategoria już istnieje.';
  }
  if (input.monthlyLimit !== null && (!Number.isInteger(input.monthlyLimit) || input.monthlyLimit <= 0 || input.monthlyLimit > 100_000_000_00)) {
    errors.monthlyLimit = 'Limit musi być kwotą większą od zera.';
  }
  return errors;
}

export type LimitState = 'none' | 'ok' | 'warning' | 'over';

/**
 * Stan limitu: „warning” od 85% zaplanowanych wydatków, „over” po przekroczeniu.
 * Liczymy razem wydane i zaplanowane — żeby ostrzec, zanim rachunki faktycznie zejdą.
 */
export function limitState(total: number, limit: number | null): LimitState {
  if (!limit) return 'none';
  if (total > limit) return 'over';
  if (total >= limit * 0.85) return 'warning';
  return 'ok';
}
