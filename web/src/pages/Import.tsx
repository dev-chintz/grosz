import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { ImportAction, ImportBatchDto, ImportPreviewRow, OptionsResponse } from '@grosz/shared/api';
import { formatPLN, formatShortDate } from '@grosz/shared/format';
import { decodeBankFile, parseBankFile, type ParseResult } from '@grosz/shared/import';
import { api } from '../api.ts';
import { Field, inputClass } from '../components/controls.tsx';
import { Icon } from '../components/Icon.tsx';
import styles from './Import.module.css';

type Decision = { action: ImportAction; categoryId: string | null };

const STATUS_LABEL: Record<ImportPreviewRow['status'], string> = {
  new: 'nowa',
  matched: 'płatność cykliczna',
  duplicate: 'możliwy duplikat',
  imported: 'już zaimportowana',
};

export function Import() {
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; parsed: ParseResult } | null>(null);
  const [rows, setRows] = useState<ImportPreviewRow[] | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [batches, setBatches] = useState<ImportBatchDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; matched: number } | null>(null);

  const loadBatches = useCallback(() => api.importBatches().then(setBatches, () => undefined), []);
  useEffect(() => {
    api.options().then((o) => (setOptions(o), setAccountId(o.accounts[0]?.id ?? null)), (e: Error) => setError(e.message));
    void loadBatches();
  }, [loadBatches]);

  const onFile = async (selected: File | undefined) => {
    setError(null);
    setRows(null);
    setResult(null);
    if (!selected) return;
    try {
      const parsed = parseBankFile(decodeBankFile(await selected.arrayBuffer()));
      setFile({ name: selected.name, parsed });
      setBusy(true);
      const preview = await api.importPreview(parsed.rows);
      setRows(preview.rows);
      setDecisions(Object.fromEntries(preview.rows.map((r) => [r.key, { action: r.defaultAction, categoryId: r.suggestedCategoryId }])));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const decide = (key: string, change: Partial<Decision>) => setDecisions((d) => ({ ...d, [key]: { ...d[key]!, ...change } }));

  const counts = useMemo(() => {
    const values = Object.values(decisions);
    return { create: values.filter((d) => d.action === 'create').length, match: values.filter((d) => d.action === 'match').length };
  }, [decisions]);

  const commit = async () => {
    if (!rows || !file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.importCommit({
        bank: file.parsed.bank,
        fileName: file.name,
        accountId,
        rows: rows
          .filter((r) => r.status !== 'imported')
          .map((r) => ({
            key: r.key,
            date: r.date,
            direction: r.direction,
            amount: r.amount,
            description: r.description,
            categoryId: decisions[r.key]!.categoryId,
            action: decisions[r.key]!.action,
            occurrenceId: r.match?.occurrenceId ?? null,
          })),
      });
      setResult(res);
      setRows(null);
      setFile(null);
      void loadBatches();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const undo = async (batch: ImportBatchDto) => {
    if (!window.confirm(`Cofnąć import „${batch.fileName}”? Usunie ${batch.createdCount} operacji i odznaczy ${batch.matchedCount} płatności.`)) return;
    try {
      await api.undoImport(batch.id);
      void loadBatches();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <header className={styles.header}>
        <div>
          <Link to="/transakcje" className={styles.back}>
            <Icon name="chevronLeft" size={16} strokeWidth={2} /> Transakcje
          </Link>
          <h1 className={styles.title}>Import wyciągu</h1>
        </div>
      </header>

      <section className={styles.card}>
        <p className={styles.lead}>
          <strong>Alior:</strong> bankowość internetowa → Historia operacji → wybierz okres → eksport do <strong>CSV</strong>. Ten sam plik możesz wgrać ponownie — zaimportowane operacje zostaną pominięte.
        </p>
        <div className={styles.pickRow}>
          <Field label="Plik CSV z banku">
            <input className={inputClass} type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
          </Field>
          <Field label="Na konto">
            <select className={inputClass} value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value || null)}>
              {options?.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {busy && <p className={styles.muted}>Analizuję…</p>}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {file?.parsed.problems.length ? (
          <p className={styles.error}>
            Pominięte nieczytelne wiersze: {file.parsed.problems.map((p) => `linia ${p.line} (${p.reason})`).join(', ')}
          </p>
        ) : null}
        {result && (
          <p className={styles.ok}>
            Zaimportowano: {result.created} nowych operacji, {result.matched} płatności cyklicznych oznaczonych jako opłacone.{' '}
            <Link to="/transakcje">Zobacz transakcje</Link>
          </p>
        )}
      </section>

      {rows && (
        <section className={styles.card} aria-label="Podgląd importu">
          <div className={styles.summary}>
            <span>
              Wierszy: <strong>{rows.length}</strong> · do dodania: <strong>{counts.create}</strong> · do odhaczenia: <strong>{counts.match}</strong>
            </span>
            <button type="button" className={styles.primary} disabled={busy || counts.create + counts.match === 0} onClick={commit}>
              Importuj
            </button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Opis</th>
                  <th className={styles.right}>Kwota</th>
                  <th>Kategoria</th>
                  <th>Co zrobić</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = decisions[r.key]!;
                  const categories = options?.categories.filter((c) => c.direction === r.direction) ?? [];
                  return (
                    <tr key={r.key} data-skip={d.action === 'skip'}>
                      <td className="mono">{formatShortDate(r.date)}</td>
                      <td>
                        <span className={styles.desc}>{r.description}</span>
                        <span className={styles.badge} data-status={r.status}>
                          {STATUS_LABEL[r.status]}
                          {r.match && `: ${r.match.name} (${formatShortDate(r.match.dueDate)})`}
                          {r.duplicateOf && `: „${r.duplicateOf.description}”`}
                        </span>
                      </td>
                      <td className={`mono ${styles.right}`}>{formatPLN(r.direction === 'income' ? r.amount : -r.amount, { sign: true })}</td>
                      <td>
                        <select
                          className={styles.select}
                          aria-label={`Kategoria: ${r.description}`}
                          value={d.categoryId ?? ''}
                          disabled={r.status === 'imported' || d.action !== 'create'}
                          onChange={(e) => decide(r.key, { categoryId: e.target.value || null })}
                        >
                          <option value="">Bez kategorii</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className={styles.select}
                          aria-label={`Akcja: ${r.description}`}
                          value={d.action}
                          disabled={r.status === 'imported'}
                          onChange={(e) => decide(r.key, { action: e.target.value as ImportAction })}
                        >
                          <option value="create">Dodaj</option>
                          {r.match && <option value="match">Odhacz płatność</option>}
                          <option value="skip">Pomiń</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {batches.length > 0 && (
        <section className={styles.card} aria-labelledby="batches-title">
          <h2 id="batches-title" className={styles.cardTitle}>
            Ostatnie importy
          </h2>
          <ul className={styles.batches}>
            {batches.map((b) => (
              <li key={b.id}>
                <span>
                  {new Date(b.createdAt).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })} · {b.fileName}
                </span>
                <span className={styles.muted}>
                  {b.createdCount} dodanych, {b.matchedCount} odhaczonych
                </span>
                <button type="button" className={styles.ghost} onClick={() => void undo(b)}>
                  Cofnij
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
