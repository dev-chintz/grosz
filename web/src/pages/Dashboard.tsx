import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { DashboardResponse, TimelineDay } from '@grosz/shared/api';
import { addMonths, daysBetween, parseIso, today, weekday } from '@grosz/shared/dates';
import {
  formatLongDate,
  formatPLN,
  formatRelativeDays,
  formatShortDate,
  MONTHS_LOCATIVE,
  MONTHS_NOMINATIVE,
  MONTHS_SHORT,
  plural,
  splitPLN,
  WEEKDAYS,
} from '@grosz/shared/format';
import { api } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import styles from './Dashboard.module.css';

const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = addMonths(y, m, by);
  return `${next.year}-${String(next.month).padStart(2, '0')}`;
};

export function Dashboard() {
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.dashboard(month).then(
      (result) => !cancelled && setData(result),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [month, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const shown = data?.month === month ? data : null;

  return (
    <>
      <header className={styles.header}>
        <div className={styles.monthSwitch}>
          <button type="button" className={styles.iconButton} aria-label="Poprzedni miesiąc" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            <Icon name="chevronLeft" size={18} strokeWidth={2} />
          </button>
          <h1 className={styles.title}>
            {capitalize(MONTHS_NOMINATIVE[monthNumber - 1]!)} <span>{year}</span>
          </h1>
          <button type="button" className={styles.iconButton} aria-label="Następny miesiąc" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            <Icon name="chevronRight" size={18} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.search}>
            <Icon name="search" size={18} strokeWidth={2} />
            <span className="sr-only">Szukaj</span>
            <input type="search" placeholder="Szukaj transakcji…" />
          </label>
          <button type="button" className={styles.primaryButton}>
            <Icon name="plus" size={18} strokeWidth={2.2} />
            Dodaj
          </button>
        </div>
      </header>

      {error && (
        <section className={styles.card} role="alert">
          <p className={styles.errorText}>{error}</p>
          <button type="button" className={styles.ghostButton} onClick={reload}>
            Spróbuj ponownie
          </button>
        </section>
      )}

      {!shown && !error && <p className={styles.loading}>Wczytywanie…</p>}

      {shown && (
        <>
          <div className={styles.row}>
            <Hero data={shown} monthNumber={monthNumber} />
            <div className={styles.tiles}>
              <StatTiles data={shown} />
            </div>
          </div>
          <MonthTimeline key={shown.month} data={shown} />
          <div className={`${styles.row} ${styles.alignStart}`}>
            <Upcoming data={shown} onChanged={reload} />
            <Categories data={shown} />
            <Recent data={shown} />
          </div>
        </>
      )}
    </>
  );
}

function Hero({ data, monthNumber }: { data: DashboardResponse; monthNumber: number }) {
  const amount = splitPLN(data.free);
  const pct = (part: number) => (data.income > 0 ? `${Math.min(100, (part / data.income) * 100)}%` : '0%');
  const daysLabel =
    data.daysLeft === 0 ? 'miesiąc zakończony' : `${data.daysLeft} ${plural(data.daysLeft, ['dzień', 'dni', 'dni'])} do końca miesiąca`;

  return (
    <section aria-label="Podsumowanie miesiąca" className={styles.hero}>
      <div className={styles.heroTop}>
        <span>Zostaje do wydania w {MONTHS_LOCATIVE[monthNumber - 1]}</span>
        <span className={styles.heroPill}>{daysLabel}</span>
      </div>
      <div className={styles.heroAmount}>
        {amount.sign}
        {amount.whole}
        <span className={styles.heroFraction}>{amount.fraction}</span> <span className={styles.heroCurrency}>zł</span>
      </div>
      <p className={styles.heroText}>
        {data.free < 0 ? (
          <>Zaplanowane wydatki są wyższe niż wpływy. Warto coś przesunąć albo zmniejszyć.</>
        ) : data.perDay !== null ? (
          <>
            To ok. <strong>{formatPLN(Math.floor(data.perDay / 100) * 100).replace(',00', '')} dziennie</strong> na życie — już po odjęciu
            wszystkich zaplanowanych rachunków i rat do końca miesiąca.
          </>
        ) : (
          <>Tyle zostało po wszystkich wpływach i wydatkach tego miesiąca.</>
        )}
      </p>
      {data.income > 0 && (
        <div className={styles.split}>
          <div className={styles.splitBar} role="img" aria-label="Podział wpływów: stałe, jednorazowe i wolne środki">
            <span style={{ width: pct(data.fixed), background: 'var(--expense)' }} />
            <span style={{ width: pct(data.oneOff), background: 'var(--expense-soft)' }} />
            <span style={{ flex: 1, background: 'var(--accent)' }} />
          </div>
          <div className={styles.legend}>
            <span><i style={{ background: 'var(--expense)' }} />Stałe {formatPLN(data.fixed)}</span>
            <span><i style={{ background: 'var(--expense-soft)' }} />Jednorazowe {formatPLN(data.oneOff)}</span>
            <span><i style={{ background: 'var(--accent)' }} />Wolne {formatPLN(Math.max(0, data.free))}</span>
            <span className={styles.legendTotal}>z {formatPLN(data.income)} wpływów</span>
          </div>
        </div>
      )}
    </section>
  );
}

function StatTiles({ data }: { data: DashboardResponse }) {
  const paidPct = data.fixedCount ? (data.fixedPaidCount / data.fixedCount) * 100 : 0;
  const nextIncome = data.nextIncome;
  return (
    <>
      <article className={styles.tile}>
        <span className={styles.tileIcon} style={{ background: 'var(--accent)' }}>
          <Icon name="arrowUp" strokeWidth={2} />
        </span>
        <div className={styles.tileText}>
          <strong>Wpływy</strong>
          <span>
            {nextIncome
              ? `${nextIncome.name} ${formatRelativeDays(daysBetween(data.today, nextIncome.dueDate))} · ${formatShortDate(nextIncome.dueDate)}`
              : 'Wszystkie wpływy zaksięgowane'}
          </span>
        </div>
        <span className={styles.tileAmount}>{formatPLN(data.income)}</span>
      </article>
      <article className={styles.tile}>
        <span className={styles.tileIcon} style={{ background: 'var(--expense-tint)', color: 'var(--expense-text)' }}>
          <Icon name="recurring" strokeWidth={2} />
        </span>
        <div className={styles.tileText}>
          <strong>Wydatki stałe</strong>
          <span className={styles.progressRow}>
            <span className={styles.miniTrack}>
              <span style={{ width: `${paidPct}%` }} />
            </span>
            {data.fixedPaidCount} z {data.fixedCount} opłacone
          </span>
        </div>
        <span className={styles.tileAmount}>{formatPLN(data.fixed)}</span>
      </article>
      <article className={styles.tile}>
        <span className={styles.tileIcon} style={{ background: 'var(--ground)' }}>
          <Icon name="basket" strokeWidth={2} />
        </span>
        <div className={styles.tileText}>
          <strong>Jednorazowe</strong>
          <span>
            {data.oneOffCount} {plural(data.oneOffCount, ['transakcja', 'transakcje', 'transakcji'])}
            {data.oneOffCount > 0 && ` · śr. ${formatPLN(Math.round(data.oneOff / data.oneOffCount))}`}
          </span>
        </div>
        <span className={styles.tileAmount}>{formatPLN(data.oneOff)}</span>
      </article>
    </>
  );
}

function MonthTimeline({ data }: { data: DashboardResponse }) {
  const inMonth = data.today.startsWith(data.month);
  const [selected, setSelected] = useState<string>(inMonth ? data.today : data.timeline[0]!.date);
  const max = Math.max(1, ...data.timeline.map((d) => Math.abs(d.balance)));
  const day = data.timeline.find((d) => d.date === selected) ?? data.timeline[0]!;

  const barColor = (d: TimelineDay) => {
    if (d.balance < 0) return 'var(--expense)';
    if (d.events.some((e) => e.direction === 'income')) return 'var(--accent)';
    return d.date <= data.today ? 'var(--ink)' : 'var(--future)';
  };

  return (
    <section aria-labelledby="timeline-h" className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <h2 id="timeline-h" className={styles.cardTitle}>Oś miesiąca</h2>
          <p className={styles.cardSub}>Prognoza salda dzień po dniu, ze wszystkimi zaplanowanymi wpływami i płatnościami. Kliknij dzień.</p>
        </div>
        <div className={styles.legendLight}>
          <span><i style={{ background: 'var(--ink)' }} />Za nami</span>
          <span><i style={{ background: 'var(--future)' }} />Prognoza</span>
          <span><i style={{ background: 'var(--accent)' }} />Wpływ</span>
          <span><i className={styles.round} style={{ background: 'var(--expense)' }} />Płatność</span>
        </div>
      </div>

      <div className={styles.scrollX}>
        <div className={styles.bars} style={{ gridTemplateColumns: `repeat(${data.timeline.length}, minmax(0, 1fr))` }}>
          {data.timeline.map((d) => {
            const n = parseIso(d.date).day;
            const isSelected = d.date === selected;
            return (
              <button
                key={d.date}
                type="button"
                className={styles.day}
                aria-pressed={isSelected}
                aria-label={`${formatLongDate(d.date)}, saldo ${formatPLN(d.balance)}`}
                onClick={() => setSelected(d.date)}
              >
                <span className={styles.barZone}>
                  <span
                    className={styles.bar}
                    style={{
                      height: Math.max(6, Math.round((Math.abs(d.balance) / max) * 150)),
                      background: barColor(d),
                      outline: isSelected ? '2px solid var(--ink)' : undefined,
                    }}
                  />
                </span>
                <span className={styles.dots}>
                  <i style={{ background: 'var(--expense)', opacity: d.events.some((e) => e.direction === 'expense') ? 1 : 0 }} />
                  <i className={styles.incomeDot} style={{ opacity: d.events.some((e) => e.direction === 'income') ? 1 : 0 }} />
                </span>
                <span className={d.date === data.today ? `${styles.dayNumber} ${styles.today}` : styles.dayNumber}>{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.dayPanel}>
        <div className={styles.dayPanelDate}>
          <span>
            {WEEKDAYS[weekday(day.date)]}
            {day.date === data.today && ' · dziś'}
          </span>
          <strong>{formatLongDate(day.date)}</strong>
        </div>
        <div className={styles.dayPanelBalance}>
          <span>Saldo na koniec dnia</span>
          <strong className="mono">{formatPLN(day.balance)}</strong>
        </div>
        <div className={styles.chips}>
          {day.events.length === 0 && <span className={styles.muted}>Brak zaplanowanych operacji</span>}
          {day.events.map((e, i) => (
            <span key={i} className={styles.chip}>
              <i style={{ background: e.direction === 'income' ? 'var(--accent)' : 'var(--expense)' }} />
              {e.name}
              <strong className="mono">{formatPLN(e.direction === 'income' ? e.amount : -e.amount, { sign: true })}</strong>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Upcoming({ data, onChanged }: { data: DashboardResponse; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const toggle = async (id: string, paid: boolean) => {
    setBusy(id);
    setFailed(null);
    try {
      await (paid ? api.unpay(id) : api.pay(id));
      onChanged();
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="upcoming-h" className={`${styles.card} ${styles.wide}`}>
      <div className={styles.cardHeaderRow}>
        <h2 id="upcoming-h" className={styles.cardTitleSmall}>Najbliższe płatności</h2>
        <Link to="/cykliczne" className={styles.textLink}>
          Wszystkie cykliczne <Icon name="arrowRight" size={16} strokeWidth={2} />
        </Link>
      </div>
      {failed && <p className={styles.errorText} role="alert">{failed}</p>}
      {data.upcoming.length === 0 && <p className={styles.muted}>Do końca miesiąca nie ma już stałych płatności.</p>}
      <ul className={styles.list}>
        {data.upcoming.map((u) => {
          const { day, month } = parseIso(u.dueDate);
          return (
            <li key={u.occurrenceId} className={styles.payment}>
              <span className={styles.dateBlock}>
                <strong>{day}</strong>
                <span>{MONTHS_SHORT[month - 1]}</span>
              </span>
              <span className={styles.paymentText}>
                <strong className={u.paid ? styles.paidName : undefined}>{u.name}</strong>
                <span>{u.meta}</span>
              </span>
              <span className={styles.amount}>
                {u.variableAmount && '~'}
                {formatPLN(u.amount)}
              </span>
              <button
                type="button"
                className={u.paid ? styles.paidButton : styles.payButton}
                aria-pressed={u.paid}
                disabled={busy === u.occurrenceId}
                onClick={() => toggle(u.occurrenceId, u.paid)}
              >
                {u.paid && <Icon name="check" size={16} strokeWidth={2.4} />}
                {u.paid ? 'Opłacone' : 'Opłać'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Categories({ data }: { data: DashboardResponse }) {
  const total = data.categories.reduce((acc, c) => acc + c.amount, 0);
  const max = Math.max(1, ...data.categories.map((c) => c.amount));
  return (
    <section aria-labelledby="categories-h" className={styles.card}>
      <div className={styles.cardHeaderRow}>
        <h2 id="categories-h" className={styles.cardTitleSmall}>Na co idą pieniądze</h2>
        <span className={styles.muted}>{formatPLN(total)}</span>
      </div>
      {data.categories.length === 0 && <p className={styles.muted}>Brak wydatków w tym miesiącu.</p>}
      <ul className={styles.categoryList}>
        {data.categories.map((c) => (
          <li key={c.name}>
            <span className={styles.categoryRow}>
              <span>{c.name}</span>
              <span className="mono">
                {formatPLN(c.amount)} <span className={styles.muted}>· {Math.round((c.amount / total) * 100)}%</span>
              </span>
            </span>
            <span className={styles.categoryTrack}>
              <span style={{ width: `${Math.max(2, (c.amount / max) * 100)}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Recent({ data }: { data: DashboardResponse }) {
  return (
    <section aria-labelledby="recent-h" className={styles.card}>
      <div className={styles.cardHeaderRow}>
        <h2 id="recent-h" className={styles.cardTitleSmall}>Ostatnie transakcje</h2>
        <Link to="/transakcje" className={styles.textLink}>
          Wszystkie
        </Link>
      </div>
      {data.recent.length === 0 && <p className={styles.muted}>Jeszcze nic się nie wydarzyło w tym miesiącu.</p>}
      <ul className={styles.list}>
        {data.recent.map((r, i) => (
          <li key={i} className={styles.recent}>
            <span className={styles.recentDay}>{String(parseIso(r.date).day).padStart(2, '0')}</span>
            <span className={styles.paymentText}>
              <strong>{r.name}</strong>
              <span>
                {r.category} · {r.kind === 'recurring' ? 'cykliczny' : 'jednorazowy'}
              </span>
            </span>
            <span className={styles.amount}>{formatPLN(r.direction === 'income' ? r.amount : -r.amount, { sign: true })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
