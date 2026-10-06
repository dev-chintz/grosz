import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { CalendarDay, CalendarEvent, CalendarResponse } from '@grosz/shared/api';
import { addMonths, parseIso, today as todayIso, weekday, type IsoDate } from '@grosz/shared/dates';
import { formatCompact, formatLongDate, formatPLN, formatShortDate, MONTHS_NOMINATIVE, plural, WEEKDAYS, WEEKDAYS_SHORT } from '@grosz/shared/format';
import { api } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { usePayment } from '../components/usePayment.tsx';
import { AccountBadge } from '../components/AccountBadge.tsx';
import styles from './Calendar.module.css';

const MAX_CHIPS = 3;

const monthOf = (date: IsoDate) => date.slice(0, 7);
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = addMonths(y, m, by);
  return `${next.year}-${String(next.month).padStart(2, '0')}`;
};
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const dotColor = (e: CalendarEvent) => (e.direction === 'income' ? 'var(--ink)' : e.kind === 'recurring' ? 'var(--expense)' : 'var(--oneoff)');

export function Calendar() {
  const [month, setMonth] = useState(() => monthOf(todayIso()));
  const [selected, setSelected] = useState<IsoDate | null>(null);
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.calendar(month).then(
      (result) => {
        if (cancelled) return;
        setData(result);
        // Domyślnie dziś, a w innym miesiącu — pierwszy dzień.
        setSelected((current) =>
          current && monthOf(current) === month ? current : monthOf(result.today) === month ? result.today : `${month}-01`,
        );
      },
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [month, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const shown = data?.month === month ? data : null;
  const day = shown?.days.find((d) => d.date === selected) ?? null;

  const pick = (d: CalendarDay) => {
    if (!d.inMonth) setMonth(monthOf(d.date));
    setSelected(d.date);
  };

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
        {data && monthOf(data.today) !== month && (
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => {
              setMonth(monthOf(data.today));
              setSelected(data.today);
            }}
          >
            Wróć do dziś
          </button>
        )}
      </header>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!shown && !error && <p className={styles.muted}>Wczytywanie…</p>}

      {shown && (
        <div className={styles.columns}>
          <section aria-label="Kalendarz miesiąca" className={styles.calendarCard}>
            <div className={styles.scrollX}>
              <div className={styles.grid} role="grid" aria-label={`${capitalize(MONTHS_NOMINATIVE[monthNumber - 1]!)} ${year}`}>
                {WEEKDAYS_SHORT.map((label, i) => (
                  <div key={label} className={i >= 5 ? `${styles.head} ${styles.weekendHead}` : styles.head} role="columnheader" aria-label={WEEKDAYS[i]}>
                    {label}
                  </div>
                ))}
                <MonthCells days={shown.days} today={shown.today} selected={selected} onPick={pick} />
              </div>
            </div>
            <div className={styles.legend}>
              <span><i className={styles.legendIncome} />Wpływ</span>
              <span><i style={{ background: 'var(--expense)' }} />Płatność cykliczna</span>
              <span><i style={{ background: 'var(--oneoff)' }} />Jednorazowa</span>
              <span><i className={styles.legendDone} />Opłacone</span>
              <span><i className={styles.legendLoad} />Obciążenie dnia</span>
            </div>
          </section>

          <aside className={styles.side}>
            {day && <DayPanel day={day} today={shown.today} onChanged={reload} />}
            <MonthSummary data={shown} onPickDay={setSelected} />
          </aside>
        </div>
      )}
    </>
  );
}

function MonthCells({ days, today, selected, onPick }: { days: CalendarDay[]; today: IsoDate; selected: IsoDate | null; onPick: (d: CalendarDay) => void }) {
  const maxOutflow = Math.max(1, ...days.filter((d) => d.inMonth).map((d) => d.outflow));
  return (
    <>
      {days.map((d) => {
        const { day } = parseIso(d.date);
        const isWeekend = weekday(d.date) >= 5;
        const classes = [styles.cell, isWeekend && styles.weekend, !d.inMonth && styles.outside, d.date === selected && styles.selected]
          .filter(Boolean)
          .join(' ');
        const label = [
          `${day} ${d.inMonth ? '' : formatShortDate(d.date).split(' ')[1]}`.trim(),
          d.holiday,
          d.events.length ? `${d.events.length} ${plural(d.events.length, ['operacja', 'operacje', 'operacji'])}, razem ${formatPLN(d.net, { sign: true })}` : 'brak operacji',
        ]
          .filter(Boolean)
          .join(', ');
        return (
          <button key={d.date} type="button" role="gridcell" className={classes} aria-label={label} aria-selected={d.date === selected} onClick={() => onPick(d)}>
            <span className={styles.cellTop}>
              <span className={d.date === today ? `${styles.dayNumber} ${styles.today}` : styles.dayNumber}>
                {day === 1 && !d.inMonth ? `1 ${formatShortDate(d.date).split(' ')[1]}` : day}
              </span>
              {d.events.length > 0 && <span className={styles.net}>{formatCompact(d.net, { sign: true })}</span>}
            </span>
            {d.holiday && <span className={styles.holiday}>{d.holiday}</span>}
            {d.events.slice(0, MAX_CHIPS).map((e, i) => (
              <span
                key={i}
                className={[styles.chip, e.direction === 'income' && styles.chipIncome, e.done && styles.chipDone].filter(Boolean).join(' ')}
              >
                <i style={{ background: dotColor(e) }} />
                <span>{e.name}</span>
              </span>
            ))}
            {d.events.length > MAX_CHIPS && <span className={styles.more}>+{d.events.length - MAX_CHIPS} więcej</span>}
            <span className={styles.load} aria-hidden="true">
              <span style={{ width: `${d.inMonth ? Math.round((d.outflow / maxOutflow) * 100) : 0}%` }} />
            </span>
          </button>
        );
      })}
    </>
  );
}

function DayPanel({ day, today, onChanged }: { day: CalendarDay; today: IsoDate; onChanged: () => void }) {
  const payment = usePayment(onChanged);
  const busy = payment.busy;
  const failed = payment.error;

  const toggle = (e: CalendarEvent) => {
    if (!e.occurrenceId) return;
    if (e.done) void payment.unpay(e.occurrenceId);
    else payment.pay({ occurrenceId: e.occurrenceId, name: e.name, amount: e.amount, variableAmount: e.variableAmount, direction: e.direction });
  };

  const status = (e: CalendarEvent) => {
    if (e.kind === 'oneoff') return e.done ? 'zaksięgowane' : 'zaplanowane';
    if (e.done) return e.direction === 'income' ? 'zaksięgowany' : 'opłacone';
    return day.date < today ? 'zaległe' : 'zaplanowane';
  };

  return (
    <section aria-labelledby="day-title" className={styles.dayPanel}>
      <div className={styles.dayHead}>
        <span>
          {WEEKDAYS[weekday(day.date)]}
          {day.date === today && ' · dziś'}
        </span>
        <h2 id="day-title">{formatLongDate(day.date)}</h2>
        {day.holiday && <span className={styles.dayHoliday}>{day.holiday} — dzień wolny od pracy</span>}
      </div>

      {failed && (
        <p role="alert" className={styles.dayError}>
          {failed}
        </p>
      )}
      {payment.dialog}
      {day.events.length === 0 && <p className={styles.dayEmpty}>Tego dnia nic nie jest zaplanowane.</p>}
      <ul className={styles.dayEvents}>
        {day.events.map((e, i) => (
          <li key={i}>
            <i style={{ background: e.direction === 'income' ? 'var(--accent)' : dotColor(e) }} />
            <span className={styles.dayEventText}>
              <strong className={e.done ? styles.struck : undefined}>{e.name}</strong>
              <AccountBadge accountName={e.accountName} accountBank={e.accountBank} />
              <span>
                {e.kind === 'recurring' ? (e.direction === 'income' ? 'wpływ cykliczny' : 'cykliczny') : e.direction === 'income' ? 'wpływ' : 'jednorazowy'} · {status(e)}
                {e.shiftedFrom && ` · przesunięte z ${formatShortDate(e.shiftedFrom)}`}
              </span>
            </span>
            <span className={styles.dayAmount}>
              {e.variableAmount && !e.done ? '~' : ''}
              {formatPLN(e.direction === 'income' ? e.amount : -e.amount, { sign: true })}
            </span>
            {e.occurrenceId && (
              <button
                type="button"
                className={e.done ? styles.undoButton : styles.payButton}
                disabled={busy === e.occurrenceId}
                onClick={() => toggle(e)}
                aria-label={`${e.done ? 'Cofnij oznaczenie' : e.direction === 'income' ? 'Oznacz jako otrzymany' : 'Oznacz jako opłacone'}: ${e.name}`}
              >
                {e.done ? 'Cofnij' : e.direction === 'income' ? 'Wpłynęło' : 'Opłać'}
              </button>
            )}
          </li>
        ))}
      </ul>

      {day.balance !== null && (
        <div className={styles.dayBalance}>
          <span>Saldo na koniec dnia</span>
          <strong className="mono">{formatPLN(day.balance)}</strong>
        </div>
      )}
    </section>
  );
}

function MonthSummary({ data, onPickDay }: { data: CalendarResponse; onPickDay: (date: IsoDate) => void }) {
  const s = data.summary;
  const lastDay = data.days.filter((d) => d.inMonth).at(-1)!;
  return (
    <section aria-labelledby="summary-title" className={styles.summary}>
      <h2 id="summary-title" className={styles.summaryTitle}>
        {capitalize(MONTHS_NOMINATIVE[parseIso(lastDay.date).month - 1]!)} w liczbach
      </h2>
      <div className={styles.progress}>
        <div className={styles.progressRow}>
          <span>Płatności cykliczne opłacone</span>
          <strong className="mono">
            {s.fixedPaidCount} z {s.fixedCount}
          </strong>
        </div>
        <span className={styles.progressTrack}>
          <span style={{ width: `${s.fixedTotal ? (s.fixedPaid / s.fixedTotal) * 100 : 0}%` }} />
        </span>
        <span className={styles.progressNote}>
          {formatPLN(s.fixedPaid)} z {formatPLN(s.fixedTotal)}
        </span>
      </div>
      <div className={styles.stats}>
        <div>
          <span>Zostało do zapłaty</span>
          <strong className="mono">{formatPLN(s.toPay)}</strong>
        </div>
        <div>
          <span>Najcięższy dzień</span>
          {s.heaviestDay ? (
            <button type="button" className={styles.statLink} onClick={() => onPickDay(s.heaviestDay!.date)}>
              {formatShortDate(s.heaviestDay.date)} · {formatCompact(s.heaviestDay.amount)} zł
            </button>
          ) : (
            <strong>—</strong>
          )}
        </div>
        <div>
          <span>Wpływy w miesiącu</span>
          <strong className="mono">{formatPLN(s.income)}</strong>
        </div>
        <div>
          <span>Saldo {formatShortDate(lastDay.date)}</span>
          <strong className="mono">{formatPLN(s.endBalance)}</strong>
        </div>
      </div>
      <Link to="/cykliczne" className={styles.textLink}>
        Zarządzaj płatnościami cyklicznymi <Icon name="arrowRight" size={16} strokeWidth={2} />
      </Link>
    </section>
  );
}
