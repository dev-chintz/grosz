import { useEffect, useRef, useState } from 'react';
import type { LedgerItem, OptionsResponse } from '@grosz/shared/api';
import { addDays, type IsoDate } from '@grosz/shared/dates';
import { formatPLN, parsePLN } from '@grosz/shared/format';
import { validateTransactionInput, type TransactionInput, type TransactionInputErrors } from '@grosz/shared/transactions';
import { api, ApiError } from '../api.ts';
import { Field, inputClass, MemberField, Segmented } from './controls.tsx';
import styles from './TransactionDialog.module.css';

type Form = Omit<TransactionInput, 'amount'> & { amountText: string };

const emptyForm = (options: OptionsResponse, date: IsoDate): Form => ({
  direction: 'expense',
  amountText: '',
  date,
  description: '',
  categoryId: null,
  accountId: options.accounts[0]?.id ?? null,
  userId: null,
  note: null,
});

const fromItem = (item: LedgerItem): Form => ({
  direction: item.direction,
  amountText: formatPLN(item.amount).replace(/\s*zł$/, ''),
  date: item.date,
  description: item.name,
  categoryId: item.categoryId,
  accountId: item.accountId,
  userId: item.userId,
  note: item.note,
});

/**
 * Okno dodawania i edycji operacji jednorazowej. Otwarte, gdy `open` = true;
 * `item` = null oznacza nową operację.
 */
export function TransactionDialog({
  open,
  item,
  options,
  today,
  onClose,
  onSaved,
}: {
  open: boolean;
  item: LedgerItem | null;
  options: OptionsResponse | null;
  today: IsoDate;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<TransactionInputErrors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && options) {
      setForm(item ? fromItem(item) : emptyForm(options, today));
      setErrors({});
      setMessage(null);
      setConfirmDelete(false);
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [open, item, options, today]);

  if (!options) return null;

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setErrors((e) => ({ ...e, [key === 'amountText' ? 'amount' : key]: undefined }));
    setMessage(null);
  };

  const submit = async () => {
    if (!form) return;
    const { amountText, ...rest } = form;
    const input: TransactionInput = { ...rest, amount: parsePLN(amountText) ?? 0 };
    const clientErrors = validateTransactionInput(input);
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      return;
    }
    setBusy(true);
    try {
      if (item) await api.updateTransaction(item.id, input);
      else await api.createTransaction(input);
      onSaved();
      onClose();
    } catch (e) {
      setErrors((e as ApiError).fieldErrors ?? {});
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!item) return;
    setBusy(true);
    try {
      await api.deleteTransaction(item.id);
      onSaved();
      onClose();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const categories = options.categories.filter((c) => c.direction === form?.direction);
  const quickDates: [string, IsoDate][] = [
    ['Dziś', today],
    ['Wczoraj', addDays(today, -1)],
    ['Przedwczoraj', addDays(today, -2)],
  ];

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="tx-title" onClose={onClose}>
      {form && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className={styles.head}>
            <h2 id="tx-title">{item ? 'Edycja operacji' : 'Nowa operacja'}</h2>
            <button type="button" className={styles.close} aria-label="Zamknij" onClick={onClose}>
              ×
            </button>
          </div>

          <Segmented
            label="Rodzaj"
            value={form.direction}
            options={[
              { value: 'expense', label: 'Wydatek' },
              { value: 'income', label: 'Wpływ' },
            ]}
            onChange={(direction) => setForm((f) => (f ? { ...f, direction, categoryId: null } : f))}
          />

          <Field label="Kwota" error={errors.amount}>
            <span className={`${inputClass} ${styles.amount}`} aria-invalid={!!errors.amount}>
              <input
                inputMode="decimal"
                autoFocus
                value={form.amountText}
                placeholder="0,00"
                onChange={(e) => set('amountText', e.target.value)}
              />
              <span>zł</span>
            </span>
          </Field>

          <Field label="Opis" error={errors.description}>
            <input
              className={inputClass}
              value={form.description}
              aria-invalid={!!errors.description}
              placeholder={form.direction === 'income' ? 'np. Zwrot podatku' : 'np. Zakupy spożywcze'}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>

          <div className={styles.dateRow}>
            <Field label="Data" error={errors.date}>
              <input className={inputClass} type="date" value={form.date} aria-invalid={!!errors.date} onChange={(e) => set('date', e.target.value)} />
            </Field>
            <div className={styles.quickDates} role="group" aria-label="Szybki wybór daty">
              {quickDates.map(([label, date]) => (
                <button key={label} type="button" aria-pressed={form.date === date} onClick={() => set('date', date)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.grid2}>
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
            <MemberField members={options.members} value={form.userId} onChange={(userId) => set('userId', userId)} />
          </div>

          <Field label="Notatka" hint="opcjonalnie" error={errors.note}>
            <textarea className={inputClass} value={form.note ?? ''} onChange={(e) => set('note', e.target.value || null)} />
          </Field>

          {message && (
            <p role="alert" className={styles.error}>
              {message}
            </p>
          )}

          <div className={styles.footer}>
            {item &&
              (confirmDelete ? (
                <span className={styles.confirm}>
                  Na pewno usunąć?
                  <button type="button" className={styles.deleteButton} disabled={busy} onClick={remove}>
                    Usuń
                  </button>
                  <button type="button" className={styles.linkButton} onClick={() => setConfirmDelete(false)}>
                    Nie
                  </button>
                </span>
              ) : (
                <button type="button" className={styles.linkDanger} onClick={() => setConfirmDelete(true)}>
                  Usuń operację
                </button>
              ))}
            <button type="button" className={styles.ghostButton} onClick={onClose}>
              Anuluj
            </button>
            <button type="submit" className={styles.saveButton} disabled={busy}>
              {item ? 'Zapisz' : 'Dodaj'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
