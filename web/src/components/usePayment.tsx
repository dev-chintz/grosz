import { useEffect, useRef, useState } from 'react';
import { formatPLN, parsePLN } from '@grosz/shared/format';
import { api } from '../api.ts';
import { Field, inputClass } from './controls.tsx';
import styles from './TransactionDialog.module.css';

export interface PayTarget {
  occurrenceId: string;
  name: string;
  /** Kwota zaplanowana (prognoza) w groszach. */
  amount: number;
  variableAmount: boolean;
  direction: 'expense' | 'income';
}

/**
 * Opłacanie terminu cyklicznego. Stała kwota — od razu; kwota zmienna (np. prąd) —
 * najpierw pytamy o rzeczywistą kwotę z rachunku, żeby salda liczyły się z prawdziwych danych.
 */
export function usePayment(onChanged: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<PayTarget | null>(null);

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pay = (target: PayTarget) => {
    if (target.variableAmount) setAsking(target);
    else void run(target.occurrenceId, () => api.pay(target.occurrenceId));
  };

  const unpay = (occurrenceId: string) => run(occurrenceId, () => api.unpay(occurrenceId));

  const dialog = (
    <ActualAmountDialog
      target={asking}
      onCancel={() => setAsking(null)}
      onConfirm={(amount) => {
        const target = asking!;
        setAsking(null);
        void run(target.occurrenceId, () => api.pay(target.occurrenceId, amount));
      }}
    />
  );

  return { pay, unpay, busy, error, dialog };
}

function ActualAmountDialog({ target, onCancel, onConfirm }: { target: PayTarget | null; onCancel: () => void; onConfirm: (amount: number) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (target) {
      setText(formatPLN(target.amount).replace(/\s*zł$/, ''));
      setError(null);
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [target]);

  const submit = () => {
    const amount = parsePLN(text);
    if (amount === null || amount <= 0) {
      setError('Podaj kwotę większą od zera.');
      return;
    }
    onConfirm(amount);
  };

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby="pay-title" onClose={onCancel}>
      {target && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className={styles.head}>
            <h2 id="pay-title">{target.name}</h2>
          </div>
          <p className={styles.lead}>
            Kwota zmienna — prognoza to {formatPLN(target.amount)}. Wpisz kwotę z {target.direction === 'income' ? 'wpływu' : 'rachunku'}.
          </p>
          <Field label={target.direction === 'income' ? 'Kwota, która wpłynęła' : 'Zapłacona kwota'} error={error ?? undefined}>
            <span className={`${inputClass} ${styles.amount}`} aria-invalid={!!error}>
              <input inputMode="decimal" autoFocus value={text} onChange={(e) => (setText(e.target.value), setError(null))} />
              <span>zł</span>
            </span>
          </Field>
          <div className={styles.footer}>
            <button type="button" className={styles.ghostButton} onClick={onCancel}>
              Anuluj
            </button>
            <button type="submit" className={styles.saveButton}>
              {target.direction === 'income' ? 'Zapisz wpływ' : 'Oznacz jako opłacone'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
