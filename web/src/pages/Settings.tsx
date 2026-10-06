import { useCallback, useEffect, useState } from 'react';
import type { AccountDto, MemberDto, SettingsResponse } from '@grosz/shared/api';
import { today as todayIso } from '@grosz/shared/dates';
import { formatPLN, formatShortDate, parsePLN, plural } from '@grosz/shared/format';
import { validateAccountInput, validateHouseholdInput, validateMemberInput, type AccountInputErrors } from '@grosz/shared/settings';
import { api, ApiError, HOUSEHOLD_CHANGED, type HouseholdChange } from '../api.ts';
import { Field, inputClass } from '../components/controls.tsx';
import { PasswordCard } from '../components/AuthGate.tsx';
import { Icon } from '../components/Icon.tsx';
import styles from './Settings.module.css';

/** Daje znać sidebarowi, że zmieniła się nazwa gospodarstwa lub liczba osób. */
const announce = (change: HouseholdChange) => window.dispatchEvent(new CustomEvent(HOUSEHOLD_CHANGED, { detail: change }));
const amountText = (grosze: number) => formatPLN(grosze).replace(/\s*zł$/, '');
const dateWithYear = (date: string) => `${formatShortDate(date)} ${date.slice(0, 4)}`;

export function Settings() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    api.settings().then(
      (result) => !cancelled && (setData(result), setError(null)),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <>
      <header className={styles.header}>
        <h1 className={styles.title}>Ustawienia</h1>
      </header>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!data && !error && <p className={styles.muted}>Wczytywanie…</p>}

      {data && (
        <div className={styles.columns}>
          <HouseholdCard household={data.household} onSaved={reload} />
          <MembersCard members={data.members} onChanged={reload} onError={setError} />
          <AccountsCard accounts={data.accounts} onChanged={reload} onError={setError} />
          <DataCard />
          <PasswordCard className={styles.card} />
        </div>
      )}
    </>
  );
}

function HouseholdCard({ household, onSaved }: { household: SettingsResponse['household']; onSaved: () => void }) {
  const [name, setName] = useState(household.name);
  const [errors, setErrors] = useState<{ name?: string }>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const submit = async () => {
    const clientErrors = validateHouseholdInput({ name });
    if (Object.keys(clientErrors).length) return setErrors(clientErrors);
    setBusy(true);
    try {
      await api.updateHousehold({ name });
      announce({ name: name.trim() });
      setSaved(true);
      onSaved();
    } catch (e) {
      setErrors((e as ApiError).fieldErrors ?? { name: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="household-title" className={styles.card}>
      <h2 id="household-title" className={styles.cardTitle}>
        Gospodarstwo
      </h2>
      <form
        className={styles.stack}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Nazwa" error={errors.name}>
          <input className={inputClass} value={name} aria-invalid={!!errors.name} onChange={(e) => (setName(e.target.value), setErrors({}), setSaved(false))} />
        </Field>
        <p className={styles.muted}>
          Waluta: <strong>{household.currency}</strong> — wszystkie kwoty w aplikacji są w złotych.
        </p>
        <div className={styles.buttons}>
          <button type="submit" className={styles.saveButton} disabled={busy || name.trim() === household.name}>
            Zapisz
          </button>
          {saved && (
            <span role="status" className={styles.saved}>
              <Icon name="check" size={16} strokeWidth={2.2} /> Zapisano
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

function AccountsCard({ accounts, onChanged, onError }: { accounts: AccountDto[]; onChanged: () => void; onError: (message: string | null) => void }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);
  const names = accounts.map((a) => a.name);

  const run = async (action: () => Promise<unknown>) => {
    try {
      onError(null);
      await action();
      setArchiving(null);
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const renderRow = (a: AccountDto) =>
    editing === a.id ? (
      <li key={a.id}>
        <AccountForm initial={a} existingNames={names.filter((n) => n !== a.name)} onCancel={() => setEditing(null)} onSaved={() => (setEditing(null), onChanged())} />
      </li>
    ) : (
      <li key={a.id} className={styles.row} data-archived={a.archived}>
        <div className={styles.rowMain}>
          <strong>{a.name}</strong>
          <span className={styles.meta}>
            saldo początkowe <span className="mono">{formatPLN(a.openingBalance)}</span> na {dateWithYear(a.openingDate)}
          </span>
          <span className={styles.meta}>
            {[
              a.rulesCount > 0 && `${a.rulesCount} ${plural(a.rulesCount, ['płatność cykliczna', 'płatności cykliczne', 'płatności cyklicznych'])}`,
              a.transactionsCount > 0 && `${a.transactionsCount} ${plural(a.transactionsCount, ['operacja', 'operacje', 'operacji'])}`,
            ]
              .filter(Boolean)
              .join(' · ') || 'bez przypisanych płatności'}
          </span>
        </div>
        {archiving === a.id ? (
          <div className={styles.confirm} role="group" aria-label={`Archiwizacja: ${a.name}`}>
            <span>Konto zniknie z formularzy i prognozy salda.</span>
            <button type="button" className={styles.dangerButton} onClick={() => run(() => api.archiveAccount(a.id))}>
              Archiwizuj
            </button>
            <button type="button" className={styles.ghostButton} onClick={() => setArchiving(null)}>
              Anuluj
            </button>
          </div>
        ) : (
          <div className={styles.rowActions}>
            <button type="button" className={styles.iconButton} aria-label={`Edytuj: ${a.name}`} onClick={() => setEditing(a.id)}>
              <Icon name="pencil" size={16} strokeWidth={2} />
            </button>
            {a.archived ? (
              <button type="button" className={styles.ghostButton} onClick={() => run(() => api.restoreAccount(a.id))}>
                Przywróć
              </button>
            ) : (
              <button type="button" className={styles.ghostButton} disabled={active.length <= 1} title={active.length <= 1 ? 'Musi zostać co najmniej jedno aktywne konto.' : undefined} onClick={() => setArchiving(a.id)}>
                Archiwizuj
              </button>
            )}
          </div>
        )}
      </li>
    );

  return (
    <section aria-labelledby="accounts-title" className={`${styles.card} ${styles.wide}`}>
      <div className={styles.cardHead}>
        <h2 id="accounts-title" className={styles.cardTitle}>
          Konta
        </h2>
        <span className={styles.muted}>Salda początkowe są punktem wyjścia prognozy salda na Pulpicie i w Kalendarzu.</span>
      </div>

      <ul className={styles.list}>{active.map(renderRow)}</ul>

      {editing === 'new' ? (
        <AccountForm initial={null} existingNames={names} onCancel={() => setEditing(null)} onSaved={() => (setEditing(null), onChanged())} />
      ) : (
        <button type="button" className={styles.addButton} onClick={() => setEditing('new')}>
          <Icon name="plus" size={16} strokeWidth={2.2} />
          Dodaj konto
        </button>
      )}

      {archived.length > 0 && (
        <details className={styles.archived}>
          <summary>Zarchiwizowane ({archived.length})</summary>
          <ul className={styles.list}>{archived.map(renderRow)}</ul>
        </details>
      )}
    </section>
  );
}

function AccountForm({ initial, existingNames, onCancel, onSaved }: { initial: AccountDto | null; existingNames: string[]; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [balance, setBalance] = useState(initial ? amountText(initial.openingBalance) : '0,00');
  const [openingDate, setOpeningDate] = useState(initial?.openingDate ?? todayIso());
  const [errors, setErrors] = useState<AccountInputErrors>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsed = parsePLN(balance);
    const input = { name, openingBalance: parsed ?? Number.NaN, openingDate };
    const clientErrors = validateAccountInput(input, existingNames);
    if (Object.keys(clientErrors).length) return setErrors(clientErrors);
    setBusy(true);
    try {
      if (initial) await api.updateAccount(initial.id, input);
      else await api.createAccount(input);
      onSaved();
    } catch (e) {
      setErrors((e as ApiError).fieldErrors ?? { name: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const touch = <T,>(set: (value: T) => void) => (value: T) => (set(value), setErrors({}));

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
        <input className={inputClass} autoFocus value={name} aria-invalid={!!errors.name} onChange={(e) => touch(setName)(e.target.value)} />
      </Field>
      <Field label="Saldo początkowe" hint="może być ujemne" error={errors.openingBalance}>
        <span className={`${inputClass} ${styles.amountInput}`} aria-invalid={!!errors.openingBalance}>
          <input inputMode="decimal" value={balance} onChange={(e) => touch(setBalance)(e.target.value)} />
          <span>zł</span>
        </span>
      </Field>
      <Field label="Na dzień" error={errors.openingDate}>
        <input className={inputClass} type="date" value={openingDate} aria-invalid={!!errors.openingDate} onChange={(e) => touch(setOpeningDate)(e.target.value)} />
      </Field>
      <div className={styles.buttons}>
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

function DataCard() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const invalidRange = from !== '' && to !== '' && from > to;
  const query = new URLSearchParams([...(from ? [['from', from]] : []), ...(to ? [['to', to]] : [])]).toString();

  return (
    <section aria-labelledby="data-title" className={styles.card}>
      <h2 id="data-title" className={styles.cardTitle}>
        Dane
      </h2>

      <div className={styles.exportBlock}>
        <h3>Pełna kopia</h3>
        <p className={styles.muted}>Konta, kategorie, płatności cykliczne z historią kwot, terminy i operacje w jednym pliku JSON.</p>
        <a className={styles.downloadButton} href="/api/export/backup" download>
          <Icon name="download" size={16} strokeWidth={2} />
          Pobierz kopię (JSON)
        </a>
      </div>

      <div className={styles.exportBlock}>
        <h3>Operacje do Excela</h3>
        <p className={styles.muted}>Plik CSV ze średnikami i polskimi znakami. Zaplanowane terminy są tylko te, które aplikacja już wygenerowała (kilka miesięcy do przodu).</p>
        <div className={styles.dateRow}>
          <Field label="Od" hint="puste = od początku">
            <input className={inputClass} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Do" hint="puste = do końca">
            <input className={inputClass} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        {invalidRange && (
          <p role="alert" className={styles.error}>
            Data „od” nie może być późniejsza niż „do”.
          </p>
        )}
        {invalidRange ? (
          <button type="button" className={styles.downloadButton} disabled>
            <Icon name="download" size={16} strokeWidth={2} />
            Pobierz operacje (CSV)
          </button>
        ) : (
          <a className={styles.downloadButton} href={`/api/export/transactions${query ? `?${query}` : ''}`} download>
            <Icon name="download" size={16} strokeWidth={2} />
            Pobierz operacje (CSV)
          </a>
        )}
      </div>

      <p className={styles.muted}>Pliki zawierają wszystkie dane finansowe gospodarstwa — przechowuj je w bezpiecznym miejscu.</p>
    </section>
  );
}

function MembersCard({ members, onChanged, onError }: { members: MemberDto[]; onChanged: () => void; onError: (message: string | null) => void }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const names = members.map((m) => m.name);

  const remove = async (member: MemberDto) => {
    try {
      onError(null);
      await api.deleteMember(member.id);
      setDeleting(null);
      announce({ memberCount: members.length - 1 });
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const added = () => {
    setEditing(null);
    announce({ memberCount: members.length + 1 });
    onChanged();
  };

  return (
    <section aria-labelledby="members-title" className={styles.card}>
      <div className={styles.cardHead}>
        <h2 id="members-title" className={styles.cardTitle}>
          Domownicy
        </h2>
        <span className={styles.muted}>
          Do osoby można przypisać operację lub płatność (pole „Kto”). Aplikacja nie ma logowania, więc lista nie ogranicza nikomu dostępu.
        </span>
      </div>

      <ul className={styles.list}>
        {members.map((m) => {
          const used = m.transactionsCount + m.rulesCount;
          return editing === m.id ? (
            <li key={m.id}>
              <MemberForm initial={m} existingNames={names.filter((n) => n !== m.name)} onCancel={() => setEditing(null)} onSaved={() => (setEditing(null), onChanged())} />
            </li>
          ) : (
            <li key={m.id} className={styles.row}>
              <div className={styles.rowMain}>
                <strong>{m.name}</strong>
                <span className={styles.meta}>
                  {[
                    m.transactionsCount > 0 && `${m.transactionsCount} ${plural(m.transactionsCount, ['operacja', 'operacje', 'operacji'])}`,
                    m.rulesCount > 0 && `${m.rulesCount} ${plural(m.rulesCount, ['płatność cykliczna', 'płatności cykliczne', 'płatności cyklicznych'])}`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'bez przypisanych operacji'}
                </span>
              </div>
              {deleting === m.id ? (
                <div className={styles.confirm} role="group" aria-label={`Usuwanie: ${m.name}`}>
                  <span>{used > 0 ? `Przypisane operacje i płatności (${used}) staną się wspólne.` : 'Usunąć osobę z listy?'}</span>
                  <button type="button" className={styles.dangerButton} onClick={() => remove(m)}>
                    Usuń
                  </button>
                  <button type="button" className={styles.ghostButton} onClick={() => setDeleting(null)}>
                    Anuluj
                  </button>
                </div>
              ) : (
                <div className={styles.rowActions}>
                  <button type="button" className={styles.iconButton} aria-label={`Edytuj: ${m.name}`} onClick={() => setEditing(m.id)}>
                    <Icon name="pencil" size={16} strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    aria-label={`Usuń: ${m.name}`}
                    disabled={members.length <= 1}
                    title={members.length <= 1 ? 'Musi zostać co najmniej jedna osoba.' : undefined}
                    onClick={() => setDeleting(m.id)}
                  >
                    Usuń
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {editing === 'new' ? (
        <MemberForm initial={null} existingNames={names} onCancel={() => setEditing(null)} onSaved={added} />
      ) : (
        <button type="button" className={styles.addButton} onClick={() => setEditing('new')}>
          <Icon name="plus" size={16} strokeWidth={2.2} />
          Dodaj osobę
        </button>
      )}
    </section>
  );
}

function MemberForm({ initial, existingNames, onCancel, onSaved }: { initial: MemberDto | null; existingNames: string[]; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [errors, setErrors] = useState<{ name?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const clientErrors = validateMemberInput({ name }, existingNames);
    if (Object.keys(clientErrors).length) return setErrors(clientErrors);
    setBusy(true);
    try {
      if (initial) await api.updateMember(initial.id, { name });
      else await api.createMember({ name });
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
      <Field label="Imię lub nazwa" error={errors.name}>
        <input className={inputClass} autoFocus value={name} aria-invalid={!!errors.name} onChange={(e) => (setName(e.target.value), setErrors({}))} />
      </Field>
      <div className={styles.buttons}>
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
