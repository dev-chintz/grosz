import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { OptionsResponse, RecurringListResponse, RecurringRuleDto } from '@grosz/shared/api';
import { formatPLN, formatShortDate, MONTHS_SHORT } from '@grosz/shared/format';
import { parseIso } from '@grosz/shared/dates';
import { api } from '../api.ts';
import { Segmented } from '../components/controls.tsx';
import { Icon } from '../components/Icon.tsx';
import { RuleEditor } from './recurring/RuleEditor.tsx';
import { AccountBadge } from '../components/AccountBadge.tsx';
import styles from './Recurring.module.css';

type Filter = 'all' | 'expense' | 'income' | 'paused' | 'ending';

const FILTERS: { value: Filter; label: string; test: (r: RecurringRuleDto) => boolean }[] = [
  { value: 'all', label: 'Wszystkie', test: () => true },
  { value: 'expense', label: 'Wydatki', test: (r) => r.direction === 'expense' && r.status === 'active' },
  { value: 'income', label: 'Wpływy', test: (r) => r.direction === 'income' && r.status === 'active' },
  { value: 'paused', label: 'Wstrzymane', test: (r) => r.status === 'paused' },
  { value: 'ending', label: 'Kończące się', test: (r) => r.status === 'active' && r.schedule.endingSoon },
];

const monthYear = (date: string) => {
  const { year, month } = parseIso(date);
  return `${MONTHS_SHORT[month - 1]} ${year}`;
};

export function Recurring() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<RecurringListResponse | null>(null);
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, opts] = await Promise.all([api.recurring(), api.options()]);
      setData(list);
      setOptions(opts);
      setError(null);
      return list;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Bez wybranej pozycji pokazujemy w edytorze najbliższą płatność.
  useEffect(() => {
    if (!id && data?.rules[0]) navigate(`/cykliczne/${data.rules[0].id}`, { replace: true });
  }, [id, data, navigate]);

  const isNew = id === 'nowy';
  const selected = data?.rules.find((r) => r.id === id) ?? null;
  const filtered = useMemo(() => data?.rules.filter(FILTERS.find((f) => f.value === filter)!.test) ?? [], [data, filter]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, data?.rules.filter(f.test).length ?? 0])), [data]);
  const nextExpense = data?.rules.find((r) => r.direction === 'expense' && r.status === 'active' && r.schedule.next);

  const confirmLeave = (event: MouseEvent) => {
    if (dirty && !window.confirm('Masz niezapisane zmiany. Porzucić je?')) event.preventDefault();
  };

  const onSaved = async (savedId: string | null) => {
    setDirty(false);
    const list = await load();
    if (savedId) navigate(`/cykliczne/${savedId}`, { replace: true });
    else if (list?.rules[0]) navigate(`/cykliczne/${list.rules[0].id}`, { replace: true });
    else navigate('/cykliczne', { replace: true });
  };

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>Cykliczne</h1>
          {data && (
            <div className={styles.pills}>
              <span className={styles.pillDark}>
                ≈ <strong>{formatPLN(data.monthlyExpenses)}</strong> / miesiąc
              </span>
              <span className={styles.pill}>
                <strong>{formatPLN(data.monthlyExpenses * 12)}</strong> / rok
              </span>
              {nextExpense?.schedule.next && (
                <span className={styles.pill}>
                  Najbliższa: {nextExpense.name} · {formatShortDate(nextExpense.schedule.next.dueDate)}
                </span>
              )}
            </div>
          )}
        </div>
        <Link to="/cykliczne/nowy" className={styles.primaryButton} onClick={confirmLeave}>
          <Icon name="plus" size={18} strokeWidth={2.2} />
          Nowa płatność cykliczna
        </Link>
      </header>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <div className={styles.columns}>
        <section aria-label="Lista płatności cyklicznych" className={styles.listColumn}>
          <Segmented label="Filtr" tone="ground" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: counts[f.value] }))} />
          <div className={styles.list}>
            {!data && !error && <p className={styles.muted}>Wczytywanie…</p>}
            {data && filtered.length === 0 && <p className={styles.muted}>Nic tu nie ma.</p>}
            {filtered.map((r) => (
              <Link
                key={r.id}
                to={`/cykliczne/${r.id}`}
                className={r.status === 'paused' ? `${styles.row} ${styles.paused}` : styles.row}
                aria-current={r.id === id ? 'true' : undefined}
                onClick={confirmLeave}
              >
                <span className={styles.initial}>{r.name.charAt(0).toUpperCase()}</span>
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>
                    <strong>{r.name}</strong>
                    <AccountBadge accountName={r.accountName} accountBank={r.accountBank} />
                    {r.direction === 'income' && <span className={`${styles.badge} ${styles.badgeIncome}`}>wpływ</span>}
                    {r.variableAmount && <span className={styles.badge}>kwota zmienna</span>}
                    {r.status === 'paused' && <span className={styles.badge}>wstrzymane od {monthYear(r.pausedFrom ?? data!.today)}</span>}
                    {r.status === 'active' && r.schedule.endingSoon && r.schedule.last && (
                      <span className={`${styles.badge} ${styles.badgeEnding}`}>kończy się {monthYear(r.schedule.last)}</span>
                    )}
                  </span>
                  <span className={styles.rowMeta}>
                    {r.categoryName ?? 'Bez kategorii'} · {r.frequencyLabel}
                  </span>
                  {r.endType === 'count' && r.schedule.total && (
                    <span className={styles.progress}>
                      <span className={styles.track}>
                        <span style={{ width: `${(r.schedule.done / r.schedule.total) * 100}%` }} />
                      </span>
                      <span className="mono">
                        {r.schedule.done} / {r.schedule.total} za nami
                      </span>
                    </span>
                  )}
                </span>
                <span className={styles.rowSide}>
                  <strong className="mono">
                    {r.direction === 'income' ? '+' : ''}
                    {r.variableAmount ? '~' : ''}
                    {formatPLN(r.amount)}
                  </strong>
                  <span>{r.status === 'paused' ? 'wstrzymane' : r.schedule.next ? formatShortDate(r.schedule.next.dueDate) : 'zakończone'}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        {data && options && (isNew || selected) && (
          <RuleEditor
            key={id}
            rule={isNew ? null : selected}
            options={options}
            today={data.today}
            onDirtyChange={setDirty}
            onSaved={onSaved}
          />
        )}
        {data && id && !isNew && !selected && (
          <section className={styles.editorEmpty}>
            <p className={styles.muted}>Nie ma takiej płatności — mogła zostać usunięta.</p>
          </section>
        )}
      </div>
    </>
  );
}
