import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { LedgerItem, OptionsResponse, TransactionsResponse } from '@grosz/shared/api';
import { addMonths, parseIso, today as todayIso, weekday, type IsoDate } from '@grosz/shared/dates';
import { formatLongDate, formatPLN, MONTHS_NOMINATIVE, WEEKDAYS } from '@grosz/shared/format';
import { api } from '../api.ts';
import { Segmented } from '../components/controls.tsx';
import { Icon } from '../components/Icon.tsx';
import { TransactionDialog } from '../components/TransactionDialog.tsx';
import { usePayment } from '../components/usePayment.tsx';
import styles from './Transactions.module.css';

type Filter = 'all' | 'oneoff' | 'recurring' | 'income' | 'due';

const FILTERS: { value: Filter; label: string; test: (i: LedgerItem) => boolean }[] = [
  { value: 'all', label: 'Wszystkie', test: () => true },
  { value: 'oneoff', label: 'Jednorazowe', test: (i) => i.kind === 'oneoff' },
  { value: 'recurring', label: 'Cykliczne', test: (i) => i.kind === 'recurring' },
  { value: 'income', label: 'Wpływy', test: (i) => i.direction === 'income' },
  { value: 'due', label: 'Do zapłaty', test: (i) => i.kind === 'recurring' && i.direction === 'expense' && i.status !== 'done' },
];

const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = addMonths(y, m, by);
  return `${next.year}-${String(next.month).padStart(2, '0')}`;
};
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const signedAmount = (i: LedgerItem) => formatPLN(i.direction === 'income' ? i.amount : -i.amount, { sign: true });

export function Transactions() {
  const [params, setParams] = useSearchParams();
  const month = params.get('month') ?? todayIso().slice(0, 7);
  const query = params.get('q')?.trim() ?? '';
  const [searchText, setSearchText] = useState(query);
  const [data, setData] = useState<TransactionsResponse | null>(null);
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<{ item: LedgerItem | null } | null>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const payment = usePayment(reload);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.transactions(query ? { q: query } : { month }).then(
      (result) => !cancelled && setData(result),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [month, query, reloadKey]);

  useEffect(() => {
    api.options().then(setOptions, () => {});
  }, []);

  // Wyszukiwanie po chwili bezczynności — bez przycisku „Szukaj”.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchText.trim() === query) return;
      setParams((p) => {
        const next = new URLSearchParams(p);
        if (searchText.trim()) next.set('q', searchText.trim());
        else next.delete('q');
        return next;
      }, { replace: true });
    }, 300);
    return () => clearTimeout(handle);
  }, [searchText, query, setParams]);

  const setMonth = (m: string) => setParams({ month: m });
  const shown = data && (query ? data.query === query : data.month === month) ? data : null;
  const filtered = useMemo(() => shown?.items.filter(FILTERS.find((f) => f.value === filter)!.test) ?? [], [shown, filter]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, shown?.items.filter(f.test).length ?? 0])), [shown]);

  const groups = useMemo(() => {
    const map = new Map<IsoDate, LedgerItem[]>();
    for (const item of filtered) map.set(item.date, [...(map.get(item.date) ?? []), item]);
    return [...map.entries()];
  }, [filtered]);

  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const today = data?.today ?? todayIso();

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>Transakcje</h1>
          {query ? (
            <div className={styles.monthSwitch}>
              <span className={styles.searchLabel}>Wyniki dla „{query}” w całej historii</span>
              <button type="button" className={styles.linkButton} onClick={() => (setSearchText(''), setParams({ month }))}>
                Wyczyść
              </button>
            </div>
          ) : (
            <div className={styles.monthSwitch}>
              <button type="button" className={styles.iconButton} aria-label="Poprzedni miesiąc" onClick={() => setMonth(shiftMonth(month, -1))}>
                <Icon name="chevronLeft" size={18} strokeWidth={2} />
              </button>
              <span className={styles.monthName} aria-live="polite">
                {capitalize(MONTHS_NOMINATIVE[monthNumber - 1]!)} {year}
              </span>
              <button type="button" className={styles.iconButton} aria-label="Następny miesiąc" onClick={() => setMonth(shiftMonth(month, 1))}>
                <Icon name="chevronRight" size={18} strokeWidth={2} />
              </button>
            </div>
          )}
        </div>
        <div className={styles.actions}>
          <label className={styles.search}>
            <Icon name="search" size={18} strokeWidth={2} />
            <span className="sr-only">Szukaj w transakcjach</span>
            <input type="search" placeholder="Szukaj w całej historii…" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
          </label>
          <button type="button" className={styles.primaryButton} onClick={() => setEditing({ item: null })}>
            <Icon name="plus" size={18} strokeWidth={2.2} />
            Dodaj
          </button>
        </div>
      </header>

      {shown && (
        <div className={styles.pills}>
          <span className={styles.pill}>
            Wpływy <strong className="mono">{formatPLN(shown.totals.income, { sign: true })}</strong>
          </span>
          <span className={styles.pill}>
            Wydatki <strong className="mono">{formatPLN(-shown.totals.expense)}</strong>
          </span>
          <span className={styles.pillDark}>
            Bilans <strong className="mono">{formatPLN(shown.totals.income - shown.totals.expense, { sign: true })}</strong>
          </span>
          {shown.limited && <span className={styles.pill}>Pokazano 200 najnowszych wyników — doprecyzuj wyszukiwanie</span>}
        </div>
      )}

      {(error || payment.error) && (
        <p role="alert" className={styles.error}>
          {error ?? payment.error}
        </p>
      )}

      <Segmented label="Filtr" tone="ground" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: counts[f.value] }))} />

      <section aria-label="Lista operacji" className={styles.list}>
        {!shown && !error && <p className={styles.empty}>Wczytywanie…</p>}
        {shown && groups.length === 0 && (
          <div className={styles.empty}>
            <p>{query ? 'Nic nie znaleziono.' : filter === 'all' ? 'W tym miesiącu nie ma jeszcze żadnych operacji.' : 'Brak operacji tego rodzaju.'}</p>
            {!query && filter === 'all' && (
              <button type="button" className={styles.primaryButton} onClick={() => setEditing({ item: null })}>
                <Icon name="plus" size={18} strokeWidth={2.2} />
                Dodaj pierwszą
              </button>
            )}
          </div>
        )}
        {groups.map(([date, items]) => {
          const net = items.reduce((sum, i) => sum + (i.direction === 'income' ? i.amount : -i.amount), 0);
          const { year: y } = parseIso(date);
          return (
            <div key={date} className={styles.group}>
              <h2 className={styles.dayHeader}>
                <span>
                  {WEEKDAYS[weekday(date)]}, <strong>{formatLongDate(date)}</strong>
                  {query && ` ${y}`}
                  {date === today && <span className={styles.todayBadge}>dziś</span>}
                </span>
                <span className="mono">{formatPLN(net, { sign: true })}</span>
              </h2>
              <ul className={styles.rows}>
                {items.map((item) => (
                  <Row
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    busy={payment.busy === item.id}
                    onEdit={() => setEditing({ item })}
                    onPay={() => payment.pay({ occurrenceId: item.id, name: item.name, amount: item.amount, variableAmount: item.variableAmount, direction: item.direction })}
                    onUnpay={() => payment.unpay(item.id)}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <TransactionDialog open={editing !== null} item={editing?.item ?? null} options={options} today={today} onClose={() => setEditing(null)} onSaved={reload} />
      {payment.dialog}
    </>
  );
}

function Row({ item, busy, onEdit, onPay, onUnpay }: { item: LedgerItem; busy: boolean; onEdit: () => void; onPay: () => void; onUnpay: () => void }) {
  const income = item.direction === 'income';
  const meta = [item.categoryName ?? 'Bez kategorii', item.accountName, item.kind === 'recurring' ? 'cykliczna' : 'jednorazowa'].filter(Boolean).join(' · ');
  const content = (
    <>
      <span className={income ? `${styles.icon} ${styles.iconIncome}` : item.kind === 'recurring' ? `${styles.icon} ${styles.iconRecurring}` : styles.icon}>
        <Icon name={income ? 'arrowUp' : item.kind === 'recurring' ? 'recurring' : 'basket'} size={18} strokeWidth={2} />
      </span>
      <span className={styles.text}>
        <span className={styles.nameLine}>
          <strong>{item.name}</strong>
          {item.status === 'overdue' && <span className={`${styles.badge} ${styles.badgeOverdue}`}>zaległe</span>}
          {item.status === 'planned' && <span className={styles.badge}>zaplanowane</span>}
          {item.variableAmount && item.status !== 'done' && <span className={styles.badge}>kwota zmienna</span>}
        </span>
        <span className={styles.meta}>
          {meta}
          {item.plannedAmount !== null && ` · prognoza ${formatPLN(item.plannedAmount)}`}
        </span>
        {item.note && <span className={styles.note}>{item.note}</span>}
      </span>
    </>
  );

  return (
    <li className={item.status === 'done' ? styles.row : `${styles.row} ${styles.pending}`}>
      {item.kind === 'oneoff' ? (
        <button type="button" className={styles.main} onClick={onEdit} aria-label={`Edytuj: ${item.name}, ${signedAmount(item)}`}>
          {content}
        </button>
      ) : (
        <Link to={`/cykliczne/${item.ruleId}`} className={styles.main} aria-label={`${item.name}, ${signedAmount(item)} — otwórz ustawienia płatności cyklicznej`}>
          {content}
        </Link>
      )}
      <span className={income ? `${styles.amount} ${styles.amountIncome}` : styles.amount}>
        {item.variableAmount && item.status !== 'done' ? '~' : ''}
        {signedAmount(item)}
      </span>
      {item.kind === 'recurring' &&
        (item.status === 'done' ? (
          <button type="button" className={styles.undoButton} disabled={busy} onClick={onUnpay} aria-label={`Cofnij oznaczenie: ${item.name}`}>
            Cofnij
          </button>
        ) : (
          <button type="button" className={styles.payButton} disabled={busy} onClick={onPay}>
            {income ? 'Wpłynęło' : 'Opłać'}
          </button>
        ))}
      {item.kind === 'oneoff' && <span className={styles.actionSpacer} aria-hidden="true" />}
    </li>
  );
}
