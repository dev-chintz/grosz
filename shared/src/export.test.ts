import { describe, expect, it } from 'vitest';
import type { LedgerItem } from './api.ts';
import { csvAmount, csvText, ledgerToCsv, toCsv } from './export.ts';

const item = (patch: Partial<LedgerItem>): LedgerItem => ({
  kind: 'oneoff',
  id: 'x',
  ruleId: null,
  date: '2026-10-05',
  name: 'Zakupy',
  direction: 'expense',
  amount: 12_345,
  plannedAmount: null,
  variableAmount: false,
  categoryId: null,
  categoryName: 'Jedzenie',
  accountId: null,
  accountName: 'Konto',
  userId: null,
  userName: null,
  note: null,
  status: 'done',
  ...patch,
});

describe('csvAmount', () => {
  it('formatuje grosze jako liczbę z przecinkiem, bez separatora tysięcy', () => {
    expect(csvAmount(123_456)).toBe('1234,56');
    expect(csvAmount(5)).toBe('0,05');
    expect(csvAmount(0)).toBe('0,00');
    expect(csvAmount(-62_000)).toBe('-620,00');
  });
});

describe('csvText', () => {
  it('ujmuje w cudzysłów tekst ze średnikiem, cudzysłowem i nową linią, podwajając cudzysłowy', () => {
    expect(csvText('a;b')).toBe('"a;b"');
    expect(csvText('mówi "cześć"')).toBe('"mówi ""cześć"""');
    expect(csvText('linia 1\nlinia 2')).toBe('"linia 1\nlinia 2"');
    expect(csvText('zwykły tekst z ąęł')).toBe('zwykły tekst z ąęł');
  });

  it('zabezpiecza komórki, które Excel wykonałby jako formułę', () => {
    for (const dangerous of ['=SUM(A1:A9)', '+48123', '-1+1', '@cmd', '=HYPERLINK("http://x";"y")']) {
      expect(csvText(dangerous).replace(/^"/, '').startsWith("'")).toBe(true);
    }
  });

  it('puste i brakujące wartości to pusta komórka', () => {
    expect(csvText(null)).toBe('');
    expect(csvText(undefined)).toBe('');
  });
});

describe('toCsv', () => {
  it('zaczyna od BOM (polskie litery w Excelu), łączy średnikami i kończy wiersze CRLF', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('\uFEFFa;b\r\nc;d\r\n');
  });
});

describe('ledgerToCsv', () => {
  it('ma nagłówek, kwoty ze znakiem i sortuje od najstarszej', () => {
    const csv = ledgerToCsv([
      item({ date: '2026-10-09', name: 'Pensja', direction: 'income', amount: 800_000, kind: 'recurring', categoryName: 'Wypłata' }),
      item({ date: '2026-10-02', name: 'Kawa', amount: 1_250 }),
    ]);
    const lines = csv.replace('\uFEFF', '').trimEnd().split('\r\n');
    expect(lines[0]).toBe('Data;Rodzaj;Nazwa;Kategoria;Konto;Osoba;Kierunek;Kwota;Kwota zaplanowana;Status;Notatka');
    expect(lines[1]).toBe('2026-10-02;jednorazowa;Kawa;Jedzenie;Konto;;wydatek;-12,50;;zrealizowana;');
    expect(lines[2]).toBe('2026-10-09;cykliczna;Pensja;Wypłata;Konto;;wpływ;8000,00;;zrealizowana;');
  });

  it('pokazuje kwotę zaplanowaną tylko wtedy, gdy rachunek wyszedł inny, oraz statusy po polsku', () => {
    const csv = ledgerToCsv([item({ kind: 'recurring', name: 'Prąd', amount: 18_000, plannedAmount: 15_000, status: 'overdue' })]);
    expect(csv).toContain(';-180,00;-150,00;po terminie;');
  });

  it('nazwa zaczynająca się od = nie trafia do pliku jako formuła', () => {
    const csv = ledgerToCsv([item({ name: '=HYPERLINK("http://zlosliwy";"kliknij")', note: '-cmd' })]);
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).toContain(";'-cmd");
    expect(csv).not.toMatch(/;=HYPERLINK/);
  });

  it('kolumna „Osoba” pokazuje domownika, a dla operacji wspólnej jest pusta', () => {
    const csv = ledgerToCsv([item({ name: 'Zakupy dla Ani', userId: 'u1', userName: 'Anna' }), item({ name: 'Wspólne', date: '2026-10-06' })]);
    const lines = csv.replace('\uFEFF', '').trimEnd().split('\r\n');
    expect(lines[1]!.split(';')[5]).toBe('Anna');
    expect(lines[2]!.split(';')[5]).toBe('');
  });

  it('pusta lista to sam nagłówek', () => {
    expect(ledgerToCsv([]).replace('\uFEFF', '').trimEnd().split('\r\n')).toHaveLength(1);
  });
});
