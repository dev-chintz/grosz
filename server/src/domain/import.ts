import { createHash } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import type { ImportBatchDto, ImportCommitRequest, ImportPreviewRow } from '@grosz/shared/api';
import { addDays, daysBetween, type IsoDate } from '@grosz/shared/dates';
import { merchantKey, suggestCategoryName, type ImportRow } from '@grosz/shared/import';
import type { Db } from '../db/client.ts';
import { categories, importBatches, occurrences, recurringRules, transactions } from '../db/schema.ts';
import { findForeignReferences } from './household.ts';

const MATCH_DAYS = 5;
const DUPLICATE_DAYS = 3;
/** Rachunek o zmiennej kwocie (prąd) pasuje, gdy różnica od prognozy nie przekracza 40%. */
const VARIABLE_TOLERANCE = 0.4;

export const importHash = (key: string) => createHash('sha256').update(key).digest('hex');

class ImportError extends Error {
  readonly statusCode = 400;
}

/** Podgląd: co jest nowe, co już było, co pasuje do płatności cyklicznej, a co do operacji wpisanej ręcznie. */
export async function previewImport(db: Db, householdId: string, rows: ImportRow[]): Promise<ImportPreviewRow[]> {
  if (rows.length === 0) return [];
  const hashes = rows.map((r) => importHash(r.key));
  const dates = rows.map((r) => r.date).sort();
  const from = addDays(dates[0]!, -MATCH_DAYS);
  const to = addDays(dates.at(-1)!, MATCH_DAYS);

  const [importedTx, importedOcc, planned, manual, history, categoryRows] = await Promise.all([
    db.select({ key: transactions.importKey }).from(transactions).where(and(eq(transactions.householdId, householdId), inArray(transactions.importKey, hashes))),
    db.select({ key: occurrences.importKey }).from(occurrences).where(and(eq(occurrences.householdId, householdId), inArray(occurrences.importKey, hashes))),
    db
      .select({ occurrence: occurrences, rule: recurringRules })
      .from(occurrences)
      .innerJoin(recurringRules, eq(occurrences.ruleId, recurringRules.id))
      .where(and(eq(occurrences.householdId, householdId), eq(occurrences.status, 'planned'), gte(occurrences.dueDate, from), lte(occurrences.dueDate, to))),
    db
      .select({ id: transactions.id, date: transactions.date, amount: transactions.amount, direction: transactions.direction, description: transactions.description })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), isNull(transactions.importKey), gte(transactions.date, from), lte(transactions.date, to))),
    db
      .select({ description: transactions.description, categoryId: transactions.categoryId })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), isNotNull(transactions.categoryId)))
      .orderBy(desc(transactions.date))
      .limit(2000),
    db.select({ id: categories.id, name: categories.name, direction: categories.direction }).from(categories).where(eq(categories.householdId, householdId)),
  ]);

  const alreadyImported = new Set([...importedTx, ...importedOcc].map((r) => r.key));
  // Najnowsza kategoria dla danego sklepu/kontrahenta (historia posortowana od najnowszych).
  const byMerchant = new Map<string, string>();
  for (const h of history) {
    const key = merchantKey(h.description);
    if (key && !byMerchant.has(key)) byMerchant.set(key, h.categoryId!);
  }
  const usedOccurrences = new Set<string>();
  const usedManual = new Set<string>();

  return rows.map((row, i): ImportPreviewRow => {
    const base = { key: row.key, date: row.date, direction: row.direction, amount: row.amount, description: row.description, match: null, duplicateOf: null };
    const suggestedName = suggestCategoryName(row.description);
    const suggestedCategoryId =
      byMerchant.get(row.merchant) ?? categoryRows.find((c) => c.direction === row.direction && c.name === suggestedName)?.id ?? null;

    if (alreadyImported.has(hashes[i]!)) return { ...base, status: 'imported', suggestedCategoryId, defaultAction: 'skip' };

    const occurrence = planned
      .filter(({ occurrence: o, rule }) => {
        if (usedOccurrences.has(o.id) || rule.direction !== row.direction) return false;
        if (Math.abs(daysBetween(o.dueDate, row.date)) > MATCH_DAYS) return false;
        return rule.variableAmount ? Math.abs(row.amount - o.plannedAmount) <= o.plannedAmount * VARIABLE_TOLERANCE : row.amount === o.plannedAmount;
      })
      .sort((a, b) => Math.abs(daysBetween(a.occurrence.dueDate, row.date)) - Math.abs(daysBetween(b.occurrence.dueDate, row.date)))[0];
    if (occurrence) {
      usedOccurrences.add(occurrence.occurrence.id);
      return {
        ...base,
        status: 'matched',
        suggestedCategoryId: occurrence.rule.categoryId ?? suggestedCategoryId,
        match: { occurrenceId: occurrence.occurrence.id, name: occurrence.rule.name, dueDate: occurrence.occurrence.dueDate, plannedAmount: occurrence.occurrence.plannedAmount },
        defaultAction: 'match',
      };
    }

    const duplicate = manual.find(
      (m) => !usedManual.has(m.id) && m.direction === row.direction && m.amount === row.amount && Math.abs(daysBetween(m.date, row.date)) <= DUPLICATE_DAYS,
    );
    if (duplicate) {
      usedManual.add(duplicate.id);
      return { ...base, status: 'duplicate', suggestedCategoryId, duplicateOf: { id: duplicate.id, description: duplicate.description, date: duplicate.date }, defaultAction: 'skip' };
    }
    return { ...base, status: 'new', suggestedCategoryId, defaultAction: 'create' };
  });
}

/** Zapis importu jako jednej paczki (do cofnięcia). Wiersze już zaimportowane są pomijane po kluczu. */
export async function commitImport(db: Db, householdId: string, request: ImportCommitRequest) {
  const refs = await findForeignReferences(db, householdId, { categoryId: null, accountId: request.accountId, userId: null });
  if (refs.accountId) throw new ImportError(refs.accountId);
  const categoryIds = [...new Set(request.rows.map((r) => r.categoryId).filter((id): id is string => !!id))];
  if (categoryIds.length) {
    const own = await db.select({ id: categories.id }).from(categories).where(and(eq(categories.householdId, householdId), inArray(categories.id, categoryIds)));
    if (own.length !== categoryIds.length) throw new ImportError('Nie ma takiej kategorii.');
  }

  return db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(importBatches)
      .values({ householdId, bank: request.bank, fileName: request.fileName.slice(0, 200), accountId: request.accountId })
      .returning({ id: importBatches.id });
    let created = 0;
    let matched = 0;
    for (const row of request.rows) {
      const importKey = importHash(row.key);
      if (row.action === 'create') {
        const inserted = await tx
          .insert(transactions)
          .values({
            householdId,
            accountId: request.accountId,
            categoryId: row.categoryId,
            direction: row.direction,
            date: row.date,
            amount: row.amount,
            description: row.description,
            importBatchId: batch!.id,
            importKey,
          })
          .onConflictDoNothing({ target: [transactions.householdId, transactions.importKey] })
          .returning({ id: transactions.id });
        created += inserted.length;
      } else if (row.action === 'match' && row.occurrenceId) {
        const updated = await tx
          .update(occurrences)
          .set({ status: 'paid', paidOn: row.date, actualAmount: row.amount, importBatchId: batch!.id, importKey })
          .where(and(eq(occurrences.id, row.occurrenceId), eq(occurrences.householdId, householdId), eq(occurrences.status, 'planned')))
          .returning({ id: occurrences.id });
        matched += updated.length;
      }
    }
    await tx.update(importBatches).set({ createdCount: created, matchedCount: matched }).where(eq(importBatches.id, batch!.id));
    return { batchId: batch!.id, created, matched };
  });
}

export async function listImportBatches(db: Db, householdId: string): Promise<ImportBatchDto[]> {
  const rows = await db.select().from(importBatches).where(eq(importBatches.householdId, householdId)).orderBy(desc(importBatches.createdAt)).limit(20);
  return rows.map((b) => ({ id: b.id, bank: b.bank, fileName: b.fileName, createdCount: b.createdCount, matchedCount: b.matchedCount, createdAt: b.createdAt.toISOString() }));
}

/** Cofa paczkę: usuwa utworzone operacje, a dopasowane terminy wracają do „zaplanowane”. */
export async function undoImportBatch(db: Db, householdId: string, batchId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [batch] = await tx.select({ id: importBatches.id }).from(importBatches).where(and(eq(importBatches.id, batchId), eq(importBatches.householdId, householdId)));
    if (!batch) throw Object.assign(new Error('Nie znaleziono importu.'), { statusCode: 404 });
    await tx.delete(transactions).where(eq(transactions.importBatchId, batchId));
    await tx
      .update(occurrences)
      .set({ status: 'planned', paidOn: null, actualAmount: null, importBatchId: null, importKey: null })
      .where(eq(occurrences.importBatchId, batchId));
    await tx.delete(importBatches).where(eq(importBatches.id, batchId));
  });
}

