// Dane zanonimizowane: układ jak w prawdziwym eksporcie Aliora, nazwy i numery wymyślone.
import { describe, expect, it } from 'vitest';
import { decodeBankFile, merchantKey, parseBankFile, suggestCategoryName } from './import.ts';

const ALIOR = [
  'Kryteria transakcji: Okres: 01-09-2026 - 30-09-2026;Typ transakcji: Uznania/Obciążenia;Produkty: 00000000000000000000000000',
  'Data transakcji;Data księgowania;Nazwa nadawcy;Nazwa odbiorcy;Szczegóły transakcji;Kwota operacji;Waluta operacji;Kwota w walucie rachunku;Waluta rachunku;Numer rachunku nadawcy;Numer rachunku odbiorcy',
  '30-09-2026;30-09-2026;Jan Kowalski;Anna Nowak;Przelew wychodzący;-300,00;PLN;-300,00;PLN;11 1111 1111 1111 1111 1111 1111;22 2222 2222 2222 2222 2222 2222',
  '28-09-2026;30-09-2026;;;ZABKA Z8161 K.1 CZESTOCHOWA PL;-1,96;PLN;-1,96;PLN;;',
  '07-09-2026;07-09-2026;ANNA NOWAK;Jan Kowalski;PRZELEW ŚRODKÓW;1000,00;PLN;1000,00;PLN;22 2222 2222 2222 2222 2222 2222;11 1111 1111 1111 1111 1111 1111',
  '07-09-2026;07-09-2026;ANNA NOWAK;Jan Kowalski;PRZELEW ŚRODKÓW;1000,00;PLN;1000,00;PLN;22 2222 2222 2222 2222 2222 2222;11 1111 1111 1111 1111 1111 1111',
  '02-09-2026;02-09-2026;PRZYKŁADOWA FIRMA SP. Z O.O.;KOWALSKI JAN;Wynagrodzenie za 8/2026;3535,85;PLN;3535,85;PLN;33 3333 3333 3333 3333 3333 3333;11 1111 1111 1111 1111 1111 1111',
  'xx-09-2026;;;;Coś dziwnego;-1,00;PLN;;;;',
  '',
].join('\n');

describe('Alior CSV', () => {
  const { rows, problems } = parseBankFile(ALIOR);

  it('czyta wiersze: datę transakcji, kierunek, kwotę w groszach i opis', () => {
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ date: '2026-09-30', direction: 'expense', amount: 30_000, description: 'Anna Nowak: Przelew wychodzący' });
    expect(rows[1]).toMatchObject({ date: '2026-09-28', amount: 196, description: 'ZABKA Z8161 K.1 CZESTOCHOWA', merchant: 'ZABKA Z K' });
    expect(rows[4]).toMatchObject({ direction: 'income', amount: 353_585 });
  });

  it('identyczne operacje tego samego dnia mają różne klucze', () => {
    expect(rows[2]!.key).not.toBe(rows[3]!.key);
  });

  it('ten sam plik daje te same klucze (ponowny import = duplikaty)', () => {
    expect(parseBankFile(ALIOR).rows.map((r) => r.key)).toEqual(rows.map((r) => r.key));
  });

  it('zgłasza nieczytelne wiersze zamiast je pomijać po cichu', () => {
    expect(problems).toEqual([{ line: 8, reason: 'nieczytelna data „xx-09-2026”' }]);
  });

  it('odrzuca nieznany format', () => {
    expect(() => parseBankFile('a;b;c')).toThrow(/Nieznany format/);
  });
});

describe('pomocnicze', () => {
  it('dekoduje Windows-1250, gdy plik nie jest w UTF-8', () => {
    const bytes = new Uint8Array([0x9c, 0x6c, 0x69, 0x77, 0x6b, 0x61]); // „śliwka” w Windows-1250
    expect(decodeBankFile(bytes.buffer)).toBe('śliwka');
  });

  it('podpowiada kategorie po słowach kluczowych', () => {
    expect(suggestCategoryName('JMP S.A. BIEDRONKA 392 CZESTOCHOWA')).toBe('Jedzenie');
    expect(suggestCategoryName('ebok.myorlen.pl Warszawa')).toBe('Mieszkanie');
    expect(suggestCategoryName('APTEKA SW. LUKASZA')).toBe('Sport i zdrowie');
    expect(suggestCategoryName('Revolut**1158* Dublin')).toBeNull();
  });

  it('klucz sklepu bez cyfr i polskich znaków', () => {
    expect(merchantKey('Łódź Żabka 12')).toBe('LODZ ZABKA');
  });
});
