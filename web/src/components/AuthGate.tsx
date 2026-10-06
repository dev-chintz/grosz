import { createContext, useCallback, useContext, useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { api, ApiError, UNAUTHORIZED, type AuthStatus } from '../api.ts';
import { Field, inputClass } from './controls.tsx';
import { Icon } from './Icon.tsx';
import styles from './AuthGate.module.css';

type User = NonNullable<AuthStatus['user']>;
const AuthContext = createContext<{ user: User; logout: () => Promise<void> } | null>(null);

/** Zalogowany użytkownik i wylogowanie — dostępne w całej aplikacji za bramką. */
export const useAuth = () => useContext(AuthContext)!;

/** Pokazuje aplikację tylko po zalogowaniu; przy pustej bazie — ekran pierwszego uruchomienia. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh: () => void = useCallback(() => {
    api.authStatus().then(
      (s) => (setStatus(s), setError(null)),
      // Serwer jeszcze wstaje (np. po aktualizacji na NAS) — ponawiamy, zamiast zostawić ekran błędu.
      (e: Error) => (setError(e.message), setTimeout(refresh, 3000)),
    );
  }, []);

  useEffect(() => {
    refresh();
    // Każde 401 z API (wygasła sesja) wraca do ekranu logowania.
    const onUnauthorized = () => setStatus((s) => (s ? { ...s, authenticated: false, user: null } : s));
    window.addEventListener(UNAUTHORIZED, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED, onUnauthorized);
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.logout();
    setStatus((s) => (s ? { ...s, authenticated: false, user: null } : s));
  }, []);

  if (error) return <Screen title="Łączenie…"><p className={styles.lead}>Serwer nie odpowiada ({error}). Ponawiam co kilka sekund.</p></Screen>;
  if (!status) return null;
  if (status.authenticated && status.user) return <AuthContext.Provider value={{ user: status.user, logout }}>{children}</AuthContext.Provider>;
  return status.setupRequired ? <SetupForm onDone={refresh} /> : <LoginForm onDone={refresh} />;
}

function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.logo}>
            <Icon name="coin" strokeWidth={2.2} />
          </span>
          <span className={styles.wordmark}>grosz</span>
        </div>
        <h1 className={styles.title}>{title}</h1>
        {children}
      </div>
    </main>
  );
}

function useSubmit(onDone: () => void) {
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      onDone();
    } catch (e) {
      setErrors((e as ApiError).fieldErrors ?? {});
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { errors, message, busy, run, clear: () => (setErrors({}), setMessage(null)) };
}

function LoginForm({ onDone }: { onDone: () => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const form = useSubmit(onDone);
  return (
    <Screen title="Zaloguj się">
      <form className={styles.form} onSubmit={(e) => (e.preventDefault(), void form.run(() => api.login(login, password)))}>
        <Field label="Login">
          <input className={inputClass} autoComplete="username" autoFocus value={login} onChange={(e) => (setLogin(e.target.value), form.clear())} />
        </Field>
        <Field label="Hasło">
          <input className={inputClass} type="password" autoComplete="current-password" value={password} onChange={(e) => (setPassword(e.target.value), form.clear())} />
        </Field>
        {form.message && <p role="alert" className={styles.error}>{form.message}</p>}
        <button type="submit" className={styles.submit} disabled={form.busy || !login || !password}>
          Zaloguj
        </button>
      </form>
    </Screen>
  );
}

function SetupForm({ onDone }: { onDone: () => void }) {
  const [values, setValues] = useState({ code: '', name: '', login: '', password: '' });
  const form = useSubmit(onDone);
  const set = (key: keyof typeof values) => (e: ChangeEvent<HTMLInputElement>) => (setValues((v) => ({ ...v, [key]: e.target.value })), form.clear());
  return (
    <Screen title="Pierwsze uruchomienie">
      <p className={styles.lead}>
        Załóż konto, którym będziesz się logować. Kod znajdziesz w logach aplikacji na NAS:
        <code className={styles.code}>docker compose logs app | grep Kod</code>
      </p>
      <form className={styles.form} onSubmit={(e) => (e.preventDefault(), void form.run(() => api.setup(values)))}>
        <Field label="Kod z logów" error={form.errors.code}>
          <input className={inputClass} autoFocus autoComplete="off" placeholder="XXXX-XXXX" value={values.code} onChange={set('code')} />
        </Field>
        <Field label="Imię" error={form.errors.name}>
          <input className={inputClass} autoComplete="name" value={values.name} onChange={set('name')} />
        </Field>
        <Field label="Login" error={form.errors.login}>
          <input className={inputClass} autoComplete="username" value={values.login} onChange={set('login')} />
        </Field>
        <Field label="Hasło" hint="min. 10 znaków" error={form.errors.password}>
          <input className={inputClass} type="password" autoComplete="new-password" value={values.password} onChange={set('password')} />
        </Field>
        {form.message && !Object.keys(form.errors).length && <p role="alert" className={styles.error}>{form.message}</p>}
        <button type="submit" className={styles.submit} disabled={form.busy}>
          Utwórz konto i zaloguj
        </button>
      </form>
    </Screen>
  );
}

/** Karta w Ustawieniach: zmiana hasła (wylogowuje pozostałe urządzenia). */
export function PasswordCard({ className }: { className?: string }) {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [done, setDone] = useState(false);
  const form = useSubmit(() => (setDone(true), setCurrent(''), setNext('')));
  return (
    <section aria-labelledby="password-title" className={className}>
      <h2 id="password-title" className={styles.cardTitle}>Konto</h2>
      <p className={styles.lead}>
        Zalogowano jako <strong>{user.name}</strong> ({user.login}).
      </p>
      <form className={styles.form} onSubmit={(e) => (e.preventDefault(), setDone(false), void form.run(() => api.changePassword(current, next)))}>
        <Field label="Obecne hasło" error={form.errors.current}>
          <input className={inputClass} type="password" autoComplete="current-password" value={current} onChange={(e) => (setCurrent(e.target.value), form.clear())} />
        </Field>
        <Field label="Nowe hasło" hint="min. 10 znaków" error={form.errors.next}>
          <input className={inputClass} type="password" autoComplete="new-password" value={next} onChange={(e) => (setNext(e.target.value), form.clear())} />
        </Field>
        {done && <p role="status" className={styles.lead}>Hasło zmienione. Inne urządzenia zostały wylogowane.</p>}
        <button type="submit" className={styles.submitSmall} disabled={form.busy || !current || !next}>
          Zmień hasło
        </button>
      </form>
    </section>
  );
}
