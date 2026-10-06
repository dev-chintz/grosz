import { useEffect, useState } from 'react';
import type { ReportsResponse } from '@grosz/shared/api';
import { formatCompact, formatPLN, MONTHS_NOMINATIVE, MONTHS_SHORT, plural } from '@grosz/shared/format';
import { api } from '../api.ts';
import { Segmented } from '../components/controls.tsx';
import styles from './Reports.module.css';

type Period = '3' | '6' | '12';

const PERIODS: readonly { value: Period; label: string }[] = [
  { value: '3', label: '3 miesiące' },
  { value: '6', label: '6 miesięcy' },
  { value: '12', label: '12 miesięcy' },
];

const monthIndex = (month: string) => Number(month.slice(5)) - 1;
const percent = (share: number) => `${Math.round(share * 100)}%`;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const monthTitle = (month: string) => `${MONTHS_NOMINATIVE[monthIndex(month)]} ${month.slice(0, 4)}`;

export function Reports() {
  const [period, setPeriod] = useState<Period>('6');
  const [data, setData] = useState<ReportsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.reports(Number(period) as 3 | 6 | 12).then(
      (result) => !cancelled && (setData(result), setError(null)),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [period]);

  const shown = data && data.months.length === Number(period) ? data : null;

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>Raporty</h1>
          {shown && (
            <p className={styles.range}>
              {capitalize(monthTitle(shown.months[0]!.month))} – {monthTitle(shown.endMonth)}
            </p>
          )}
        </div>
        <Segmented label="Okres raportu" tone="ground" value={period} options={PERIODS} onChange={setPeriod} />
      </header>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!shown && !error && <p className={styles.muted}>Wczytywanie…</p>}

      {shown && <ReportBody data={shown} />}
    </>
  );
}

function ReportBody({ data }: { data: ReportsResponse }) {
  const { totals, months, categories } = data;
  const count = months.length;
  const peak = Math.max(1, ...months.map((m) => Math.max(m.income, m.fixed + m.oneOff)));

  if (totals.income === 0 && totals.expenses === 0) {
    return <p className={styles.muted}>W tym okresie nie ma jeszcze żadnych wpływów ani wydatków.</p>;
  }

  return (
    <>
      <section className={styles.tiles} aria-label="Podsumowanie okresu">
        <Tile label="Wpływy" value={formatPLN(totals.income)} note={`średnio ${formatPLN(Math.round(totals.income / count))} miesięcznie`} swatch="income" />
        <Tile label="Wydatki" value={formatPLN(totals.expenses)} note={`średnio ${formatPLN(Math.round(totals.expenses / count))} miesięcznie`} swatch="expense" />
        <Tile
          label="Bilans"
          value={formatPLN(totals.balance, { sign: true })}
          note={totals.balance >= 0 ? 'wpływy przewyższają wydatki' : 'wydatki przewyższają wpływy'}
          swatch={totals.balance >= 0 ? 'income' : 'expense'}
        />
        <Tile
          label="Stopa oszczędności"
          value={totals.savingsRate === null ? '—' : percent(totals.savingsRate)}
          note={totals.savingsRate === null ? 'brak wpływów w tym okresie' : 'część wpływów, która zostaje'}
          swatch="ink"
        />
      </section>

      <section className={styles.card} aria-labelledby="months-title">
        <div className={styles.cardHead}>
          <h2 id="months-title" className={styles.cardTitle}>
            Miesiąc po miesiącu
          </h2>
          <div className={styles.legend}>
            <span>
              <i className={styles.dotIncome} /> Wpływy
            </span>
            <span>
              <i className={styles.dotFixed} /> Wydatki stałe
            </span>
            <span>
              <i className={styles.dotOneOff} /> Wydatki jednorazowe
            </span>
          </div>
        </div>
        <div className={styles.chartScroll}>
          <ul className={styles.chart} style={{ minWidth: count * 76 }}>
            {months.map((m) => {
              const spent = m.fixed + m.oneOff;
              return (
                <li key={m.month} className={styles.column}>
                  <span className={styles.columnAmount}>{formatCompact(m.income - spent, { sign: true })}</span>
                  <div className={styles.pair} role="img" aria-label={`${capitalize(MONTHS_NOMINATIVE[monthIndex(m.month)]!)}: wpływy ${formatPLN(m.income)}, wydatki ${formatPLN(spent)}`}>
                    <span className={`${styles.bar} ${styles.barIncome}`} style={{ height: `${(m.income / peak) * 100}%` }} />
                    <span className={styles.stack} style={{ height: `${(spent / peak) * 100}%` }}>
                      <span className={styles.barOneOff} style={{ flexGrow: m.oneOff }} />
                      <span className={styles.barFixed} style={{ flexGrow: m.fixed }} />
                    </span>
                  </div>
                  <span className={styles.columnLabel}>
                    {MONTHS_SHORT[monthIndex(m.month)]}
                    {(count > 6 || m.month.endsWith('-01')) && <small>{m.month.slice(2, 4)}</small>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <p className={styles.footnote}>Liczba nad słupkami to bilans miesiąca (wpływy − wydatki).</p>
      </section>

      <section className={styles.card} aria-labelledby="categories-title">
        <div className={styles.cardHead}>
          <h2 id="categories-title" className={styles.cardTitle}>
            Wydatki według kategorii
          </h2>
          <span className={styles.cardSub}>
            {categories.length} {plural(categories.length, ['kategoria', 'kategorie', 'kategorii'])}
          </span>
        </div>
        {categories.length === 0 ? (
          <p className={styles.muted}>Brak wydatków w tym okresie.</p>
        ) : (
          <ul className={styles.categories}>
            {categories.map((c) => (
              <li key={c.name} className={styles.categoryRow}>
                <span className={styles.categoryName}>{c.name}</span>
                <span className={styles.track} aria-hidden="true">
                  <span style={{ width: `${(c.amount / categories[0]!.amount) * 100}%` }} />
                </span>
                <span className={styles.categoryAmount}>{formatPLN(c.amount)}</span>
                <span className={styles.categoryShare}>{percent(c.share)}</span>
                <span className={styles.categoryAverage}>śr. {formatPLN(c.average)} / mies.</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.includesPlanned && (
        <p className={styles.footnote}>Razem z płatnościami zaplanowanymi, które jeszcze nie zostały opłacone — tak samo jak na Pulpicie.</p>
      )}
    </>
  );
}

function Tile({ label, value, note, swatch }: { label: string; value: string; note: string; swatch: 'income' | 'expense' | 'ink' }) {
  return (
    <div className={styles.tile}>
      <span className={styles.tileLabel}>
        <i className={styles[`swatch_${swatch}`]} /> {label}
      </span>
      <strong className={styles.tileValue}>{value}</strong>
      <span className={styles.tileNote}>{note}</span>
    </div>
  );
}
