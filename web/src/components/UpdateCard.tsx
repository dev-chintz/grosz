import { useCallback, useEffect, useRef, useState } from 'react';
import type { UpdateStatusResponse } from '@grosz/shared/api';
import { api } from '../api.ts';
import styles from './UpdateCard.module.css';

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '—');
const time = (iso: string) => new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Ustawienia → Aktualizacja. Po kliknięciu updater uruchamia deploy.sh na NAS-ie; karta co 2 s odpytuje status.
 * W trakcie restartu aplikacja chwilę nie odpowiada — wtedy pokazujemy „Uruchamianie nowej wersji…” i czekamy.
 */
export function UpdateCard({ className }: { className?: string }) {
  const [data, setData] = useState<UpdateStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [started, setStarted] = useState(false);
  const versionBefore = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const status = await api.updateStatus();
      setData(status);
      setRestarting(false);
      setError(null);
      return status;
    } catch (e) {
      // W trakcie aktualizacji to oczekiwane: kontener aplikacji jest właśnie podmieniany.
      if (started) setRestarting(true);
      else setError((e as Error).message);
      return null;
    }
  }, [started]);

  useEffect(() => {
    void load();
  }, [load]);

  const running = !!data?.updater.state?.running;
  useEffect(() => {
    if (!started && !running) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [started, running, load]);

  // Koniec: updater skończył, a odpowiada już nowa wersja — przeładowujemy stronę, żeby wczytać nowy frontend.
  const finished = started && data?.updater.state && !data.updater.state.running && data.updater.state.result !== null;
  const upgraded = finished && data?.updater.state?.result === 'ok' && data.current !== versionBefore.current;
  useEffect(() => {
    if (upgraded) {
      const timer = setTimeout(() => window.location.reload(), 3000);
      return () => clearTimeout(timer);
    }
  }, [upgraded]);

  const start = async () => {
    setError(null);
    versionBefore.current = data?.current ?? null;
    try {
      await api.startUpdate();
      setStarted(true);
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const state = data?.updater.state;
  const steps = state?.steps ?? [];
  const canUpdate = data?.updater.reachable && !running && (data.behind ?? 0) > 0;

  return (
    <section aria-labelledby="update-title" className={className}>
      <h2 id="update-title" className={styles.title}>Aktualizacja</h2>
      {!data && !error && <p className={styles.muted}>Sprawdzanie…</p>}
      {data && (
        <dl className={styles.versions}>
          <div>
            <dt>Zainstalowana</dt>
            <dd className="mono">{short(data.current)}</dd>
          </div>
          <div>
            <dt>Najnowsza</dt>
            <dd className="mono">{short(data.latest?.sha)}</dd>
          </div>
        </dl>
      )}
      {data?.checkError && <p className={styles.muted}>Nie udało się sprawdzić GitHuba: {data.checkError}</p>}
      {data && data.behind === 0 && !started && <p className={styles.ok}>Masz najnowszą wersję.</p>}
      {data && (data.behind ?? 0) > 0 && !running && !started && (
        <>
          <p className={styles.lead}>
            Nowe zmiany: <strong>{data.behind}</strong>
          </p>
          <ul className={styles.changes}>
            {data.changes.map((c) => (
              <li key={c.sha}>
                <span className="mono">{short(c.sha)}</span> {c.message}
              </li>
            ))}
          </ul>
        </>
      )}

      {(running || started) && (
        <ol className={styles.steps} aria-live="polite">
          {steps.map((s, i) => {
            const active = i === steps.length - 1 && running;
            return (
              <li key={i} data-state={active ? 'active' : 'done'}>
                <span className={styles.mark} aria-hidden="true">{active ? '…' : '✓'}</span>
                {s.title}
                <span className={styles.time}>{time(s.at)}</span>
              </li>
            );
          })}
          {restarting && (
            <li data-state="active">
              <span className={styles.mark} aria-hidden="true">…</span>Uruchamianie nowej wersji — strona chwilę nie odpowiada
            </li>
          )}
        </ol>
      )}
      {finished && state?.result === 'ok' && <p className={styles.ok}>Zaktualizowano. Strona za chwilę się przeładuje.</p>}
      {finished && state?.result === 'failed' && (
        <>
          <p className={styles.error}>Aktualizacja nie powiodła się — działa dotychczasowa wersja. Końcówka logu:</p>
          <pre className={styles.log}>{state.log.split('\n').slice(-15).join('\n')}</pre>
        </>
      )}

      {data && !data.updater.configured && (
        <p className={styles.muted}>Przycisk wymaga UPDATER_TOKEN w .env na NAS-ie. Do tego czasu: sh deploy/deploy.sh.</p>
      )}
      {data?.updater.configured && !data.updater.reachable && <p className={styles.error}>Updater nie odpowiada — sprawdź kontener grosz-updater na NAS-ie.</p>}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <button type="button" className={styles.button} disabled={!canUpdate || started} onClick={start}>
        {running ? 'Aktualizowanie…' : 'Aktualizuj'}
      </button>
    </section>
  );
}
