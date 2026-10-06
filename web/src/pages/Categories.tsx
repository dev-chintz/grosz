import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { CategoriesResponse, CategoryDto } from '@grosz/shared/api';
import { validateCategoryInput, type CategoryInputErrors } from '@grosz/shared/categories';
import { addMonths, parseIso, today as todayIso } from '@grosz/shared/dates';
import { formatPLN, MONTHS_LOCATIVE, MONTHS_NOMINATIVE, MONTHS_SHORT, parsePLN, plural } from '@grosz/shared/format';
import { api, ApiError } from '../api.ts';
import { Field, inputClass } from '../components/controls.tsx';
import { Icon } from '../components/Icon.tsx';
import dialogStyles from '../components/TransactionDialog.module.css';
import styles from './Categories.module.css';

type Direction = 'expense' | 'income';

const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = addMonths(y, m, by);
  return `${next.year}-${String(next.month).padStart(2, '0')}`;
};
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const amountText = (grosze: number | null) => (grosze === null ? '' : formatPLN(grosze).replace(/\s*zł$/, ''));

export function Categories() {
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const [data, setData] = useState<CategoriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [deleting, setDeleting] = useState<CategoryDto | null>(null);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    api.categories(month).then(
      (result) => !cancelled && (setData(result), setError(null)),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [month, reloadKey]);

  const shown = data?.month === month ? data : null;
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const expenses = shown?.categories.filter((c) => c.direction === 'expense') ?? [];
  const incomes = shown?.categories.filter((c) => c.direction === 'income') ?? [];
  const withLimit = expenses.filter((c) => c.monthlyLimit !== null);
  const over = withLimit.filter((c) => c.limitState === 'over');

  const move = async (list: CategoryDto[], index: number, by: -1 | 1) => {
    const ids = list.map((c) => c.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved!);
    try {
      await api.reorderCategories(ids);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>Kategorie</h1>
          <div className={styles.monthSwitch}>
            <button type="button" className={styles.iconButton} aria-label="Poprzedni miesiąc" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
              <Icon name="chevronLeft" size={18} strokeWidth={2} />
            </button>
            <span className={styles.monthName} aria-live="polite">
              {capitalize(MONTHS_NOMINATIVE[monthNumber - 1]!)} {year}
            </span>
            <button type="button" className={styles.iconButton} aria-label="Następny miesiąc" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
              <Icon name="chevronRight" size={18} strokeWidth={2} />
            </button>
          </div>
        </div>
        {shown && (
          <div className={styles.pills}>
            {withLimit.length > 0 && (
              <span className={styles.pill}>
                Limity w normie: <strong>{withLimit.length - over.length} z {withLimit.length}</strong>
              </span>
            )}
            {over.length > 0 && (
              <span className={`${styles.pill} ${styles.pillOver}`}>
                Przekroczone: <strong>{over.map((c) => c.name).join(', ')}</strong>
              </span>
            )}
            {shown.uncategorized.expense > 0 && (
              <Link to="/transakcje" className={styles.pill}>
                Wydatki bez kategorii: <strong className="mono">{formatPLN(shown.uncategorized.expense)}</strong>
              </Link>
            )}
          </div>
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
          <Section
            title="Wydatki"
            direction="expense"
            categories={expenses}
            monthNumber={monthNumber}
            onChanged={reload}
            onMove={(i, by) => move(expenses, i, by)}
            onDelete={setDeleting}
          />
          <Section
            title="Wpływy"
            direction="income"
            categories={incomes}
            monthNumber={monthNumber}
            onChanged={reload}
            onMove={(i, by) => move(incomes, i, by)}
            onDelete={setDeleting}
          />
        </div>
      )}

      <DeleteDialog
        category={deleting}
        others={shown?.categories.filter((c) => c.direction === deleting?.direction && c.id !== deleting?.id) ?? []}
        onClose={() => setDeleting(null)}
        onDeleted={reload}
      />
    </>
  );
}

function Section({
  title,
  direction,
  categories,
  monthNumber,
  onChanged,
  onMove,
  onDelete,
}: {
  title: string;
  direction: Direction;
  categories: CategoryDto[];
  monthNumber: number;
  onChanged: () => void;
  onMove: (index: number, by: -1 | 1) => void;
  onDelete: (c: CategoryDto) => void;
}) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const total = categories.reduce((s, c) => s + c.total, 0);
  const scale = Math.max(1, ...categories.map((c) => Math.max(c.total, c.monthlyLimit ?? 0)));
  const names = categories.map((c) => c.name);

  return (
    <section aria-labelledby={`${direction}-title`} className={direction === 'expense' ? `${styles.card} ${styles.wide}` : styles.card}>
      <div className={styles.cardHead}>
        <h2 id={`${direction}-title`} className={styles.cardTitle}>
          {title}
        </h2>
        <span className={styles.muted}>
          w {MONTHS_LOCATIVE[monthNumber - 1]}: <strong className="mono">{formatPLN(total)}</strong>
        </span>
      </div>

      <ul className={styles.list}>
        {categories.map((c, i) =>
          editing === c.id ? (
            <li key={c.id}>
              <CategoryForm
                direction={direction}
                initial={c}
                existingNames={names.filter((n) => n !== c.name)}
                onCancel={() => setEditing(null)}
                onSaved={() => (setEditing(null), onChanged())}
              />
            </li>
          ) : (
            <li key={c.id} className={styles.row}>
              <div className={styles.order}>
                <button type="button" aria-label={`Przesuń wyżej: ${c.name}`} disabled={i === 0} onClick={() => onMove(i, -1)}>
                  <Icon name="chevronUp" size={16} strokeWidth={2} />
                </button>
                <button type="button" aria-label={`Przesuń niżej: ${c.name}`} disabled={i === categories.length - 1} onClick={() => onMove(i, 1)}>
                  <Icon name="chevronDown" size={16} strokeWidth={2} />
                </button>
              </div>
              <CategoryRow category={c} scale={scale} />
              <div className={styles.rowActions}>
                <button type="button" className={styles.iconButton} aria-label={`Edytuj: ${c.name}`} onClick={() => setEditing(c.id)}>
                  <Icon name="pencil" size={16} strokeWidth={2} />
                </button>
                <button type="button" className={`${styles.iconButton} ${styles.danger}`} aria-label={`Usuń: ${c.name}`} onClick={() => onDelete(c)}>
                  <Icon name="trash" size={16} strokeWidth={2} />
                </button>
              </div>
            </li>
          ),
        )}
      </ul>

      {editing === 'new' ? (
        <CategoryForm direction={direction} initial={null} existingNames={names} onCancel={() => setEditing(null)} onSaved={() => (setEditing(null), onChanged())} />
      ) : (
        <button type="button" className={styles.addButton} onClick={() => setEditing('new')}>
          <Icon name="plus" size={16} strokeWidth={2.2} />
          Dodaj kategorię {direction === 'expense' ? 'wydatków' : 'wpływów'}
        </button>
      )}
    </section>
  );
}

function CategoryRow({ category: c, scale }: { category: CategoryDto; scale: number }) {
  const uses = [
    c.rulesCount > 0 && `${c.rulesCount} ${plural(c.rulesCount, ['cykliczna', 'cykliczne', 'cyklicznych'])}`,
    c.transactionsCount > 0 && `${c.transactionsCount} ${plural(c.transactionsCount, ['operacja', 'operacje', 'operacji'])}`,
  ].filter(Boolean);
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const historyMax = Math.max(1, ...c.history.map((h) => h.total), c.total);
  // Średnia ma sens dopiero, gdy są dane z poprzednich miesięcy.
  const hasHistory = c.history.some((h) => h.total > 0);

  return (
    <div className={styles.rowMain}>
      <div className={styles.rowTop}>
        <span className={styles.name}>
          <strong>{c.name}</strong>
          <span className={styles.meta}>{uses.length ? uses.join(' · ') : 'nieużywana'}</span>
        </span>
        <span className={styles.amounts}>
          <strong className="mono">{formatPLN(c.total)}</strong>
          {c.monthlyLimit !== null && <span className="mono"> z {formatPLN(c.monthlyLimit)}</span>}
        </span>
      </div>

      <div className={styles.bar} aria-hidden="true">
        <span className={styles.barDone} style={{ width: pct(c.done) }} data-state={c.limitState} />
        <span className={styles.barPlanned} style={{ width: pct(Math.max(0, c.total - c.done)) }} />
        {c.monthlyLimit !== null && <i className={styles.limitMark} style={{ left: pct(c.monthlyLimit) }} />}
      </div>

      <div className={styles.rowBottom}>
        <span className={styles.status} data-state={c.limitState}>
          {c.limitState === 'over' && `Limit przekroczony o ${formatPLN(c.total - c.monthlyLimit!)}`}
          {c.limitState === 'warning' && `Blisko limitu — zostało ${formatPLN(c.monthlyLimit! - c.total)}`}
          {c.limitState === 'ok' && `Zostało ${formatPLN(c.monthlyLimit! - c.total)}`}
          {c.limitState === 'none' &&
            (c.total === 0
              ? 'Brak operacji w tym miesiącu'
              : c.done === 0
                ? 'Wszystko jeszcze zaplanowane'
                : c.done < c.total
                  ? `Już ${formatPLN(c.done)}, reszta zaplanowana`
                  : c.direction === 'expense'
                    ? 'Bez limitu'
                    : 'Zaksięgowane')}
        </span>
        {hasHistory && <span className={styles.history} title="Ostatnie 3 miesiące i bieżący">
          <span className={styles.spark} aria-hidden="true">
            {[...c.history, { month: 'now', total: c.total }].map((h) => (
              <i key={h.month} style={{ height: `${Math.max(8, (h.total / historyMax) * 100)}%` }} data-current={h.month === 'now'} />
            ))}
          </span>
          <span>
            śr. {formatPLN(c.average)}
            <span className="sr-only">
              {' '}
              (ostatnie miesiące: {c.history.map((h) => `${MONTHS_SHORT[parseIso(`${h.month}-01`).month - 1]} ${formatPLN(h.total)}`).join(', ')})
            </span>
          </span>
        </span>}
      </div>
    </div>
  );
}

function CategoryForm({
  direction,
  initial,
  existingNames,
  onCancel,
  onSaved,
}: {
  direction: Direction;
  initial: CategoryDto | null;
  existingNames: string[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [limit, setLimit] = useState(amountText(initial?.monthlyLimit ?? null));
  const [errors, setErrors] = useState<CategoryInputErrors>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const monthlyLimit = direction === 'expense' && limit.trim() ? (parsePLN(limit) ?? -1) : null;
    const input = { name, direction, monthlyLimit };
    const clientErrors = validateCategoryInput(input, existingNames);
    if (Object.keys(clientErrors).length) return setErrors(clientErrors);
    setBusy(true);
    try {
      if (initial) await api.updateCategory(initial.id, { name, monthlyLimit });
      else await api.createCategory(input);
      onSaved();
    } catch (e) {
      setErrors((e as ApiError).fieldErrors ?? { name: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <Field label="Nazwa" error={errors.name}>
        <input className={inputClass} autoFocus value={name} aria-invalid={!!errors.name} onChange={(e) => (setName(e.target.value), setErrors({}))} />
      </Field>
      {direction === 'expense' && (
        <Field label="Limit miesięczny" hint="puste = bez limitu" error={errors.monthlyLimit}>
          <span className={`${inputClass} ${styles.limitInput}`} aria-invalid={!!errors.monthlyLimit}>
            <input inputMode="decimal" value={limit} placeholder="bez limitu" onChange={(e) => (setLimit(e.target.value), setErrors({}))} />
            <span>zł</span>
          </span>
        </Field>
      )}
      <div className={styles.formButtons}>
        <button type="button" className={styles.ghostButton} onClick={onCancel}>
          Anuluj
        </button>
        <button type="submit" className={styles.saveButton} disabled={busy}>
          {initial ? 'Zapisz' : 'Dodaj'}
        </button>
      </div>
    </form>
  );
}

function DeleteDialog({ category, others, onClose, onDeleted }: { category: CategoryDto | null; others: CategoryDto[]; onClose: () => void; onDeleted: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [moveTo, setMoveTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (category) {
      setMoveTo(others[0]?.id ?? '');
      setError(null);
      if (!el.open) el.showModal();
    } else if (el.open) el.close();
    // Domyślny cel ustawiamy tylko przy otwarciu — `others` to nowa tablica przy każdym renderze.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const used = category ? category.rulesCount + category.transactionsCount : 0;

  const confirm = async () => {
    if (!category) return;
    setBusy(true);
    try {
      await api.deleteCategory(category.id, used > 0 && moveTo ? moveTo : null);
      onDeleted();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className={dialogStyles.dialog} aria-labelledby="delete-category-title" onClose={onClose}>
      {category && (
        <div className={dialogStyles.form}>
          <div className={dialogStyles.head}>
            <h2 id="delete-category-title">Usunąć „{category.name}”?</h2>
          </div>
          {used > 0 ? (
            <>
              <p className={dialogStyles.lead}>
                Kategoria jest używana:{' '}
                {[
                  category.rulesCount > 0 && `${category.rulesCount} ${plural(category.rulesCount, ['płatność cykliczna', 'płatności cykliczne', 'płatności cyklicznych'])}`,
                  category.transactionsCount > 0 && `${category.transactionsCount} ${plural(category.transactionsCount, ['operacja', 'operacje', 'operacji'])}`,
                ]
                  .filter(Boolean)
                  .join(' i ')}
                . Wybierz, dokąd {used === 1 ? 'ją' : 'je'} przenieść — historia i sumy zostaną zachowane.
              </p>
              <Field label="Przenieś do">
                <select className={inputClass} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                  {others.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="">Bez kategorii</option>
                </select>
              </Field>
            </>
          ) : (
            <p className={dialogStyles.lead}>Kategoria nie jest nigdzie używana.</p>
          )}
          {error && (
            <p role="alert" className={dialogStyles.error}>
              {error}
            </p>
          )}
          <div className={dialogStyles.footer}>
            <button type="button" className={dialogStyles.ghostButton} onClick={onClose}>
              Anuluj
            </button>
            <button type="button" className={styles.deleteButton} disabled={busy} onClick={confirm}>
              {used > 0 ? 'Przenieś i usuń' : 'Usuń'}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
