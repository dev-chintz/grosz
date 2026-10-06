import { describe, expect, it } from 'vitest';
import { limitState, validateCategoryInput } from './categories.ts';

describe('validateCategoryInput', () => {
  it('przepuszcza poprawną kategorię', () => {
    expect(validateCategoryInput({ name: 'Zwierzęta', direction: 'expense', monthlyLimit: 30_000 })).toEqual({});
  });

  it('nie pozwala na duplikat niezależnie od wielkości liter', () => {
    expect(validateCategoryInput({ name: 'jedzenie ', direction: 'expense', monthlyLimit: null }, ['Jedzenie']).name).toBeDefined();
  });

  it('odrzuca pustą nazwę i zły limit', () => {
    expect(Object.keys(validateCategoryInput({ name: ' ', direction: 'expense', monthlyLimit: 0 })).sort()).toEqual(['monthlyLimit', 'name']);
  });
});

describe('limitState', () => {
  it('ostrzega od 85% i po przekroczeniu', () => {
    expect(limitState(50_000, null)).toBe('none');
    expect(limitState(50_000, 100_000)).toBe('ok');
    expect(limitState(85_000, 100_000)).toBe('warning');
    expect(limitState(100_001, 100_000)).toBe('over');
  });
});
