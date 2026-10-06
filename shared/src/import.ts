// Import wyciągów bankowych: wspólny format wiersza i czytniki banków (na razie Alior, CSV z „Historii operacji”).

import { toIso, type IsoDate } from './dates.ts';
import { parsePLN } from './format.ts';

export interface ImportRow {
  /** Klucz wiersza do wykrywania duplikatów między importami (serwer zapisuje jego skrót). */
  key: string;
  date: IsoDate;
  direction: 'expense' | 'income';
  /** W groszach, > 0. */
  amount: number;
  description: string;
  /** Znormalizowana nazwa kontrahenta/sklepu — po niej podpowiadamy kategorię z wcześniejszych importów. */
  merchant: string;
}

export interface ParseResult {
  bank: 'alior';
  rows: ImportRow[];
  /** Wiersze, których nie udało się odczytać (numer linii i powód) — pokazujemy je w podglądzie. */
  problems: { line: number; reason: string }[];
}

/** Bajty pliku → tekst: UTF-8, a gdy to nie UTF-8 — Windows-1250 (starsze eksporty polskich banków). */
export function decodeBankFile(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1250').decode(bytes);
  }
}

const ALIOR_HEADER = 'Data transakcji;Data księgowania;Nazwa nadawcy;Nazwa odbiorcy;Szczegóły transakcji;Kwota operacji';

/** Klucz sklepu/kontrahenta: wielkie litery, bez polskich znaków i cyfr, pierwsze 3 słowa („ZABKA Z8161 K.1 …” → „ZABKA Z K”). */
export function merchantKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toUpperCase()
    .replace(/[^A-Z ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(' ');
}

/** „ZABKA Z8161 K.1 CZESTOCHOWA PL” → bez końcowego kodu kraju; przelewy: „Kontrahent: tytuł”. */
function describe(counterparty: string, details: string): string {
  const cleanDetails = details.replace(/\s+[A-Z]{2}$/, '').replace(/\s+/g, ' ').trim();
  const text = counterparty ? `${counterparty}: ${cleanDetails}` : cleanDetails;
  return text.slice(0, 200);
}

export function parseAliorCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((l) => l.startsWith(ALIOR_HEADER));
  if (headerIndex < 0) throw new Error('To nie wygląda na eksport „Historii operacji” z Aliora (brak nagłówka „Data transakcji;…”).');

  const rows: ImportRow[] = [];
  const problems: ParseResult['problems'] = [];
  const seen = new Map<string, number>();

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const cells = line.split(';');
    const [txDate, , sender = '', recipient = '', details = '', amountText = '', currency = '', , , senderAccount = '', recipientAccount = ''] = cells;
    const lineNo = i + 1;
    const dateMatch = /^(\d{2})-(\d{2})-(\d{4})$/.exec(txDate ?? '');
    if (!dateMatch) {
      problems.push({ line: lineNo, reason: `nieczytelna data „${txDate}”` });
      continue;
    }
    const signed = parsePLN(amountText);
    if (signed === null || signed === 0) {
      problems.push({ line: lineNo, reason: `nieczytelna kwota „${amountText}”` });
      continue;
    }
    if (currency && currency !== 'PLN') {
      problems.push({ line: lineNo, reason: `waluta ${currency} — na razie tylko PLN` });
      continue;
    }
    const direction = signed < 0 ? 'expense' : 'income';
    // Kontrahent to druga strona: przy wydatku odbiorca, przy wpływie nadawca.
    const counterparty = (direction === 'expense' ? recipient : sender).trim();
    const date = toIso(Number(dateMatch[3]), Number(dateMatch[2]), Number(dateMatch[1]));
    // Identyczne operacje tego samego dnia (np. trzy przelewy po 1000 zł) rozróżnia kolejność w pliku.
    const base = ['alior', date, signed, details.trim(), sender.trim(), recipient.trim(), senderAccount.replace(/\s/g, ''), recipientAccount.replace(/\s/g, '')].join('|');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    rows.push({
      key: `${base}|${n}`,
      date,
      direction,
      amount: Math.abs(signed),
      description: describe(counterparty, details),
      // Z gotowego opisu — tak samo liczymy klucz dla zapisanych operacji, żeby podpowiedzi z historii pasowały.
      merchant: merchantKey(describe(counterparty, details)),
    });
  }
  return { bank: 'alior', rows, problems };
}

/** Rozpoznaje bank po zawartości i czyta plik. Kolejne banki dopisujemy tutaj. */
export function parseBankFile(text: string): ParseResult {
  if (text.includes(ALIOR_HEADER)) return parseAliorCsv(text);
  throw new Error('Nieznany format pliku. Obsługiwany: Alior — CSV z „Historii operacji”.');
}

/** Podpowiedzi kategorii po słowach kluczowych (nazwy kategorii z domyślnego budżetu). Pierwsze trafienie wygrywa. */
const KEYWORDS: [RegExp, string][] = [
  [/EBOK\.MYORLEN|TAURON|PGE |ENEA|ENERGA|INNOGY|E\.ON|WYWOZ SMIECI|SMIECI|CZYNSZ|WODOCIAG|SPOLDZIELNIA/i, 'Mieszkanie'],
  [/WYNAGRODZENIE|PENSJA/i, 'Wynagrodzenie'],
  [/RAT[AY]|KREDYT|SMARTNEY|POZYCZK/i, 'Raty'],
  [/ZABKA|ŻABKA|BIEDRONKA|LIDL|KAUFLAND|DINO|CARREFOUR|MAKRO|AUCHAN|NETTO|STOKROTKA|LEWIATAN|ALDI|PIEKARNI|SEMEX|TGTG/i, 'Jedzenie'],
  [/APTEKA|BADAJ|LUX ?MED|MEDICOVER|ENEL-MED|DENT|SILOWNI|FITNESS|BENEFIT/i, 'Sport i zdrowie'],
  [/ORLEN|\bBP\b|SHELL|CIRCLE K|MOYA|AMIC|PKP|INTERCITY|JAKDOJADE|UBER|BOLT|PARKING/i, 'Transport'],
  [/APPLE\.COM|NETFLIX|SPOTIFY|GOOGLE|YOUTUBE|DISNEY|HBO|MAX\.COM|CANAL|ORANGE|T-MOBILE|PLAY |PLUS |UPC|VECTRA/i, 'Abonamenty'],
];

export function suggestCategoryName(description: string): string | null {
  return KEYWORDS.find(([pattern]) => pattern.test(description))?.[1] ?? null;
}
