import { useEffect, useMemo, useRef, useState } from 'react';
import type { OptionsResponse, RecurringRuleDto, SaveRuleRequest } from '@grosz/shared/api';
import { addDays, parseIso, weekday, type IsoDate } from '@grosz/shared/dates';
import { formatDateWithWeekday, formatPLN, MONTHS_LOCATIVE, parsePLN, plural, WEEKDAYS, WEEKDAYS_SHORT } from '@grosz/shared/format';
import type { RecurrenceUnit } from '@grosz/shared/recurrence';
import { summarizeSchedule, toRecurrenceRule, upcomingDates, validateRuleInput, type RuleInput, type RuleInputErrors } from '@grosz/shared/recurring';
import { api, ApiError } from '../../api.ts';
import { Field, inputClass, Segmented, Switch } from '../../components/controls.tsx';
import { Icon } from '../../components/Icon.tsx';
import styles from './RuleEditor.module.css';

type Form = Omit<RuleInput, 'amount'> & { amountText: string };
type Preset = 'week' | 'month' | 'quarter' | 'year' | 'custom';

const PRESETS: { value: Preset; label: string; unit: RecurrenceUnit; interval: number }[] = [
  { value: 'week', label: 'Tydzień', unit: 'week', interval: 1 },
  { value: 'month', label: 'Miesiąc', unit: 'month', interval: 1 },
  { value: 'quarter', label: 'Kwartał', unit: 'month', interval: 3 },
  { value: 'year', label: 'Rok', unit: 'year', interval: 1 },
  { value: 'custom', label: 'Własna', unit: 'month', interval: 2 },
];

const UNIT_FORMS: Record<RecurrenceUnit, readonly [string, string, string]> = {
  day: ['dzień', 'dni', 'dni'],
  week: ['tydzień', 'tygodnie', 'tygodni'],
  month: ['miesiąc', 'miesiące', 'miesięcy'],
  year: ['rok', 'lata', 'lat'],
};

const SHIFTED_FROM = ['z poniedziałku', 'z wtorku', 'ze środy', 'z czwartku', 'z piątku', 'z soboty', 'z niedzieli'];

function presetOf(form: Pick<Form, 'unit' | 'interval'>, custom: boolean): Preset {
  if (custom) return 'custom';
  return PRESETS.find((p) => p.value !== 'custom' && p.unit === form.unit && p.interval === form.interval)?.value ?? 'custom';
}

function initialForm(rule: RecurringRuleDto | null, options: OptionsResponse, today: IsoDate): Form {
  if (rule) {
    const { amount, ...rest } = rule;
    const input: Omit<RuleInput, 'amount'> = {
      name: rest.name, direction: rest.direction, categoryId: rest.categoryId, accountId: rest.accountId, payee: rest.payee,
      variableAmount: rest.variableAmount, unit: rest.unit, interval: rest.interval, startDate: rest.startDate,
      dayOfMonth: rest.dayOfMonth, lastDayOfMonth: rest.lastDayOfMonth, weekendRule: rest.weekendRule, endType: rest.endType,
      endDate: rest.endDate, endCount: rest.endCount, remindDaysBefore: rest.remindDaysBefore, autoBook: rest.autoBook, note: rest.note,
    };
    return { ...input, amountText: formatPLN(amount).replace(/\s*zł$/, '') };
  }
  return {
    name: '',
    direction: 'expense',
    categoryId: null,
    accountId: options.accounts[0]?.id ?? null,
    payee: null,
    amountText: '',
    variableAmount: false,
    unit: 'month',
    interval: 1,
    startDate: today,
    dayOfMonth: parseIso(today).day,
    lastDayOfMonth: false,
    weekendRule: 'next',
    endType: 'never',
    endDate: null,
    endCount: null,
    remindDaysBefore: null,
    autoBook: false,
    note: null,
  };
}

const toInput = ({ amountText, ...rest }: Form): RuleInput => ({ ...rest, amount: parsePLN(amountText) ?? 0 });

export function RuleEditor({
  rule,
  options,
  today,
  onDirtyChange,
  onSaved,
}: {
  rule: RecurringRuleDto | null;
  options: OptionsResponse;
  today: IsoDate;
  onDirtyChange: (dirty: boolean) => void;
  /** id zapisanej reguły; null po usunięciu. */
  onSaved: (id: string | null) => void | Promise<void>;
}) {
  const initial = useMemo(() => initialForm(rule, options, today), [rule, options, today]);
  const [form, setForm] = useState<Form>(initial);
  const [customFrequency, setCustomFrequency] = useState(() => presetOf(initial, false) === 'custom');
  const [applyMode, setApplyMode] = useState<'today' | 'date'>('today');
  const [applyFrom, setApplyFrom] = useState<IsoDate>(today);
  const [errors, setErrors] = useState<RuleInputErrors>({});
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string }>({ kind: 'idle' });
  const deleteDialog = useRef<HTMLDialogElement>(null);

  // Po zapisie lub wstrzymaniu lista się przeładowuje — formularz przyjmuje stan z serwera.
  useEffect(() => {
    setForm(initial);
    setCustomFrequency(presetOf(initial, false) === 'custom');
  }, [initial]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key === 'amountText' ? 'amount' : key]: undefined }));
    if (status.kind === 'saved' || status.kind === 'error') setStatus({ kind: 'idle' });
  };

  const input = toInput(form);
  const monthBased = form.unit === 'month' || form.unit === 'year';
  const preset = presetOf(form, customFrequency);
  const categories = options.categories.filter((c) => c.direction === form.direction);

  // Podgląd liczony tym samym kodem co serwer — pokazuje się, gdy dane harmonogramu są poprawne.
  const scheduleErrors = validateRuleInput({ ...input, name: 'x', amount: Math.max(1, input.amount) });
  const recurrence = Object.keys(scheduleErrors).length === 0 ? toRecurrenceRule(input) : null;
  const preview = recurrence ? upcomingDates(recurrence, today, 5) : [];
  const summary = recurrence ? summarizeSchedule(recurrence, today) : null;

  const pickPreset = (value: Preset) => {
    const p = PRESETS.find((x) => x.value === value)!;
    setCustomFrequency(value === 'custom');
    setForm((f) => ({ ...f, unit: p.unit, interval: p.interval }));
  };

  const pickWeekday = (target: number) => {
    // Tydzień liczy się od daty pierwszej płatności — przesuwamy ją na najbliższy wybrany dzień.
    const shift = (target - weekday(form.startDate) + 7) % 7;
    set('startDate', addDays(form.startDate, shift));
  };

  const save = async () => {
    const clientErrors = validateRuleInput(input);
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      setStatus({ kind: 'error', message: 'Popraw zaznaczone pola.' });
      return;
    }
    setStatus({ kind: 'saving' });
    try {
      const body: SaveRuleRequest = { ...input, ...(rule ? { applyFrom: applyMode === 'date' ? applyFrom : today } : {}) };
      const id = rule ? (await api.updateRule(rule.id, body), rule.id) : (await api.createRule(body)).id;
      setStatus({ kind: 'saved' });
      await onSaved(id);
    } catch (e) {
      const error = e as ApiError;
      setErrors(error.fieldErrors ?? {});
      setStatus({ kind: 'error', message: error.message });
    }
  };

  const runAction = async (action: () => Promise<unknown>, after: string | null) => {
    setStatus({ kind: 'saving' });
    try {
      await action();
      setStatus({ kind: 'idle' });
      await onSaved(after);
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message });
    }
  };

  const err = (key: keyof RuleInput) => errors[key];
  const dayLabel = (d: number | 'last') => (d === 'last' ? 'Ostatni dzień miesiąca' : `${d}. dzień miesiąca`);
  const selectedDay: number | 'last' = form.lastDayOfMonth ? 'last' : (form.dayOfMonth ?? parseIso(form.startDate).day);

  return (
    <section aria-labelledby="editor-title" className={styles.editor}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.eyebrow}>{rule ? (rule.status === 'paused' ? 'Edycja · wstrzymane' : 'Edycja') : 'Nowa płatność cykliczna'}</span>
          <h2 id="editor-title" className={styles.title}>
            {form.name.trim() || 'Bez nazwy'}
          </h2>
        </div>
        {rule && (
          <>
            {rule.status === 'paused' ? (
              <button type="button" className={styles.iconButton} aria-label="Wznów" title="Wznów" onClick={() => runAction(() => api.resumeRule(rule.id), rule.id)}>
                <Icon name="play" size={18} strokeWidth={2} />
              </button>
            ) : (
              <button type="button" className={styles.iconButton} aria-label="Wstrzymaj" title="Wstrzymaj" onClick={() => runAction(() => api.pauseRule(rule.id), rule.id)}>
                <Icon name="pause" size={18} strokeWidth={2} />
              </button>
            )}
            <button type="button" className={`${styles.iconButton} ${styles.danger}`} aria-label="Usuń" title="Usuń" onClick={() => deleteDialog.current?.showModal()}>
              <Icon name="trash" size={18} strokeWidth={2} />
            </button>
          </>
        )}
      </div>

      <fieldset className={styles.section}>
        <legend className={styles.legend}>Podstawowe</legend>
        <Segmented
          label="Rodzaj"
          value={form.direction}
          options={[
            { value: 'expense', label: 'Wydatek' },
            { value: 'income', label: 'Wpływ' },
          ]}
          onChange={(direction) => setForm((f) => ({ ...f, direction, categoryId: null }))}
        />
        <Field label="Nazwa" error={err('name')}>
          <input className={inputClass} value={form.name} aria-invalid={!!err('name')} onChange={(e) => set('name', e.target.value)} placeholder={form.direction === 'income' ? 'np. Wypłata' : 'np. Czynsz'} />
        </Field>
        <div className={styles.grid2}>
          <Field label="Kwota" error={err('amount')}>
            <span className={`${inputClass} ${styles.amount}`} aria-invalid={!!err('amount')}>
              <input inputMode="decimal" value={form.amountText} onChange={(e) => set('amountText', e.target.value)} placeholder="0,00" />
              <span>zł</span>
            </span>
          </Field>
          <Field label="Kategoria">
            <select className={inputClass} value={form.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value || null)}>
              <option value="">Bez kategorii</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Konto">
            <select className={inputClass} value={form.accountId ?? ''} onChange={(e) => set('accountId', e.target.value || null)}>
              <option value="">—</option>
              {options.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Odbiorca" hint="opcjonalnie">
            <input className={inputClass} value={form.payee ?? ''} onChange={(e) => set('payee', e.target.value || null)} />
          </Field>
        </div>
        <Switch
          checked={form.variableAmount}
          onChange={(v) => set('variableAmount', v)}
          label="Kwota zmienna"
          description="Dla rachunków typu prąd czy gaz: kwota to prognoza, a przy opłaceniu wpisujesz rzeczywistą."
        />
      </fieldset>

      <fieldset className={styles.section}>
        <legend className={styles.legend}>Harmonogram</legend>
        <div className={styles.group}>
          <span className={styles.groupLabel}>Powtarzaj co</span>
          <Segmented label="Częstotliwość" value={preset} options={PRESETS} onChange={pickPreset} />
        </div>

        {preset === 'custom' && (
          <div className={styles.inline}>
            <span>Co</span>
            <input
              className={`${inputClass} ${styles.narrow}`}
              type="number"
              min={1}
              max={99}
              aria-label="Odstęp"
              value={form.interval}
              aria-invalid={!!err('interval')}
              onChange={(e) => set('interval', Number(e.target.value))}
            />
            <select className={`${inputClass} ${styles.auto}`} aria-label="Jednostka" value={form.unit} onChange={(e) => set('unit', e.target.value as RecurrenceUnit)}>
              {(Object.keys(UNIT_FORMS) as RecurrenceUnit[]).map((u) => (
                <option key={u} value={u}>
                  {plural(form.interval || 2, UNIT_FORMS[u])}
                </option>
              ))}
            </select>
            {err('interval') && <span className={styles.error}>{err('interval')}</span>}
          </div>
        )}

        <Field
          label="Pierwsza płatność"
          error={err('startDate')}
          hint={form.unit === 'year' && form.startDate ? `co roku w ${MONTHS_LOCATIVE[parseIso(form.startDate).month - 1]}` : undefined}
        >
          <input className={inputClass} type="date" value={form.startDate} aria-invalid={!!err('startDate')} onChange={(e) => set('startDate', e.target.value)} />
        </Field>

        {form.unit === 'week' && (
          <div className={styles.group}>
            <span className={styles.groupLabel}>Dzień tygodnia</span>
            <div className={styles.weekdays}>
              {WEEKDAYS_SHORT.map((label, i) => (
                <button key={label} type="button" aria-pressed={weekday(form.startDate) === i} aria-label={WEEKDAYS[i]} className={styles.dayButton} onClick={() => pickWeekday(i)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {monthBased && (
          <div className={styles.group}>
            <span className={styles.groupLabel}>
              Dzień płatności
              <span className={styles.groupHint}>
                {selectedDay === 'last' ? 'ostatni dzień każdego miesiąca' : selectedDay >= 29 ? 'w krótszych miesiącach: ostatni dzień' : `${selectedDay}. dzień okresu`}
              </span>
            </span>
            <div className={styles.dayGrid}>
              {[...Array.from({ length: 31 }, (_, i) => i + 1), 'last' as const].map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={selectedDay === d}
                  aria-label={dayLabel(d)}
                  className={styles.dayButton}
                  onClick={() => setForm((f) => ({ ...f, dayOfMonth: d === 'last' ? null : d, lastDayOfMonth: d === 'last' }))}
                >
                  {d === 'last' ? 'ost.' : d}
                </button>
              ))}
            </div>
          </div>
        )}

        <Field label="Gdy termin wypada w weekend lub święto">
          <select className={inputClass} value={form.weekendRule} onChange={(e) => set('weekendRule', e.target.value as Form['weekendRule'])}>
            <option value="next">Przesuń na następny dzień roboczy</option>
            <option value="previous">Przesuń na poprzedni dzień roboczy</option>
            <option value="none">Zostaw bez zmian (np. płatność kartą)</option>
          </select>
        </Field>
      </fieldset>

      <fieldset className={styles.section}>
        <legend className={styles.legend}>Czas trwania</legend>
        <Segmented
          label="Zakończenie"
          value={form.endType}
          options={[
            { value: 'never', label: 'Bezterminowo' },
            { value: 'until', label: 'Do daty' },
            { value: 'count', label: 'Liczba płatności' },
          ]}
          onChange={(endType) => setForm((f) => ({ ...f, endType, endCount: endType === 'count' ? (f.endCount ?? 12) : f.endCount, endDate: endType === 'until' ? (f.endDate ?? addDays(today, 365)) : f.endDate }))}
        />
        {form.endType === 'until' && (
          <Field label="Ostatnia płatność nie później niż" error={err('endDate')}>
            <input className={inputClass} type="date" value={form.endDate ?? ''} aria-invalid={!!err('endDate')} onChange={(e) => set('endDate', e.target.value || null)} />
          </Field>
        )}
        {form.endType === 'count' && (
          <Field label="Łączna liczba płatności" error={err('endCount')} hint="licząc od pierwszej płatności">
            <input
              className={inputClass}
              type="number"
              min={1}
              value={form.endCount ?? ''}
              aria-invalid={!!err('endCount')}
              onChange={(e) => set('endCount', e.target.value === '' ? null : Number(e.target.value))}
            />
          </Field>
        )}
        {form.endType === 'never' && <p className={styles.note}>Płatność powtarza się, dopóki jej nie wstrzymasz albo nie ustawisz końca.</p>}
        {form.endType !== 'never' && summary?.total && (
          <div className={styles.summary}>
            <span className={styles.summaryTrack}>
              <span style={{ width: `${(summary.done / summary.total) * 100}%` }} />
            </span>
            <span>
              Za nami {summary.done} z {summary.total}. Zostało <strong>{summary.remaining}</strong> {plural(summary.remaining ?? 0, ['płatność', 'płatności', 'płatności'])}
              {input.amount > 0 && (
                <>
                  , razem <strong className="mono">{formatPLN((summary.remaining ?? 0) * input.amount)}</strong>
                </>
              )}
              {summary.last && (
                <>
                  . Ostatnia: <strong>{formatDateWithWeekday(summary.last)}</strong>
                </>
              )}
              .
            </span>
          </div>
        )}
      </fieldset>

      <fieldset className={styles.section}>
        <legend className={styles.legend}>Przypomnienia i księgowanie</legend>
        <div className={styles.inline}>
          <Switch checked={form.remindDaysBefore !== null} onChange={(on) => set('remindDaysBefore', on ? 3 : null)} label="Przypomnij" />
          {form.remindDaysBefore !== null && (
            <>
              <input
                className={`${inputClass} ${styles.narrow}`}
                type="number"
                min={0}
                max={60}
                aria-label="Dni przed terminem"
                value={form.remindDaysBefore}
                onChange={(e) => set('remindDaysBefore', Number(e.target.value))}
              />
              <span>{plural(form.remindDaysBefore, ['dzień', 'dni', 'dni'])} przed terminem</span>
            </>
          )}
        </div>
        <Switch
          checked={form.autoBook}
          onChange={(v) => set('autoBook', v)}
          label="Księguj automatycznie"
          description="W dniu płatności oznacz jako opłacone (np. stałe zlecenie w banku)."
        />
        <Field label="Notatka" hint="opcjonalnie">
          <textarea className={inputClass} value={form.note ?? ''} onChange={(e) => set('note', e.target.value || null)} />
        </Field>
      </fieldset>

      {rule && rule.amountHistory.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.legend}>Historia kwoty</h3>
          <ul className={styles.history}>
            {rule.amountHistory.map((v, i) => (
              <li key={v.effectiveFrom} className={i > 0 ? styles.historyOld : undefined}>
                <span>od {formatDateWithWeekday(v.effectiveFrom)}</span>
                <strong className="mono">{formatPLN(v.amount)}</strong>
              </li>
            ))}
          </ul>
          <p className={styles.note}>Nowa kwota zapisze się od daty wybranej w „Zmiany obowiązują od” — przeszłe miesiące się nie zmienią.</p>
        </div>
      )}

      <div className={styles.section}>
        <h3 className={styles.legend}>Najbliższe terminy</h3>
        {preview.length === 0 && <p className={styles.note}>{recurrence ? 'Brak kolejnych terminów — płatność się zakończyła.' : 'Uzupełnij harmonogram, żeby zobaczyć terminy.'}</p>}
        <ol className={styles.preview}>
          {preview.map((o) => (
            <li key={o.index}>
              <span className={styles.previewNo}>{form.endType === 'count' ? `${o.index + 1}.` : ''}</span>
              <span className={styles.previewDate}>
                <strong>{formatDateWithWeekday(o.dueDate)}</strong>
                {o.shifted && (
                  <small>
                    przesunięte {SHIFTED_FROM[weekday(o.nominalDate)]}, {formatDateWithWeekday(o.nominalDate).split(', ')[1]}
                  </small>
                )}
              </span>
              <span className="mono">
                {form.variableAmount ? '~' : ''}
                {input.amount > 0 ? formatPLN(input.amount) : '—'}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className={styles.footer}>
        {rule && (
          <div className={styles.applyFrom}>
            <Field label="Zmiany obowiązują od">
              <select className={inputClass} value={applyMode} onChange={(e) => setApplyMode(e.target.value as 'today' | 'date')}>
                <option value="today">dziś (opłacone zostają bez zmian)</option>
                <option value="date">wybranej daty…</option>
              </select>
            </Field>
            {applyMode === 'date' && (
              <input className={inputClass} type="date" aria-label="Data, od której obowiązują zmiany" value={applyFrom} onChange={(e) => setApplyFrom(e.target.value)} />
            )}
          </div>
        )}
        <div className={styles.buttons}>
          <span className={styles.status} role="status">
            {status.kind === 'saving' && 'Zapisywanie…'}
            {status.kind === 'saved' && 'Zapisano'}
            {status.kind === 'error' && <span className={styles.error}>{status.message}</span>}
          </span>
          <button type="button" className={styles.ghostButton} disabled={!dirty || status.kind === 'saving'} onClick={() => { setForm(initial); setErrors({}); setStatus({ kind: 'idle' }); }}>
            Anuluj
          </button>
          <button type="button" className={styles.saveButton} disabled={status.kind === 'saving' || (!!rule && !dirty)} onClick={save}>
            {rule ? 'Zapisz zmiany' : 'Dodaj płatność'}
          </button>
        </div>
      </div>

      {rule && (
        <dialog ref={deleteDialog} className={styles.dialog} aria-labelledby="delete-title">
          <h3 id="delete-title">Usunąć „{rule.name}”?</h3>
          <p>
            Zniknie też historia jej płatności, a przeszłe salda się przeliczą. Jeśli płatność po prostu się skończyła, lepiej ustaw datę zakończenia albo ją
            wstrzymaj.
          </p>
          <form method="dialog" className={styles.dialogButtons}>
            <button className={styles.ghostButton} value="cancel">
              Anuluj
            </button>
            <button
              className={styles.deleteButton}
              value="delete"
              onClick={(e) => {
                e.preventDefault();
                deleteDialog.current?.close();
                void runAction(() => api.deleteRule(rule.id), null);
              }}
            >
              Usuń na stałe
            </button>
          </form>
        </dialog>
      )}
    </section>
  );
}
