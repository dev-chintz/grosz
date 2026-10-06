import { describe, expect, it } from 'vitest';
import { validateTransactionInput, type TransactionInput } from './transactions.ts';

const fuel: TransactionInput = {
  direction: 'expense',
  amount: 28_000,
  date: '2026-10-02',
  description: 'Paliwo',
  categoryId: null,
  accountId: null,
  userId: null,
  note: null,
};

describe('validateTransactionInput', () => {
  it('przepuszcza poprawną operację', () => {
    expect(validateTransactionInput(fuel)).toEqual({});
  });

  it('wskazuje błędne pola', () => {
    const errors = validateTransactionInput({ ...fuel, amount: -5, date: '2026-02-30x', description: '  ' });
    expect(Object.keys(errors).sort()).toEqual(['amount', 'date', 'description']);
  });
});
