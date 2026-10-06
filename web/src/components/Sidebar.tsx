import { useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { api, HOUSEHOLD_CHANGED } from '../api.ts';
import { Icon, type IconName } from './Icon.tsx';
import styles from './Sidebar.module.css';

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Pulpit', icon: 'dashboard' },
  { to: '/transakcje', label: 'Transakcje', icon: 'transactions' },
  { to: '/cykliczne', label: 'Cykliczne', icon: 'recurring' },
  { to: '/kalendarz', label: 'Kalendarz', icon: 'calendar' },
  { to: '/kategorie', label: 'Kategorie', icon: 'tag' },
  { to: '/raporty', label: 'Raporty', icon: 'chart' },
  { to: '/ustawienia', label: 'Ustawienia', icon: 'settings' },
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toLocaleUpperCase('pl'))
    .join('');

export function Sidebar() {
  const [household, setHousehold] = useState<{ name: string; currency: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.settings().then(
      (result) => !cancelled && setHousehold(result.household),
      () => undefined, // karta gospodarstwa jest tylko ozdobą — brak danych nie blokuje nawigacji
    );
    // Ustawienia ogłaszają zmianę nazwy, żeby karta w sidebarze nie czekała na przeładowanie strony.
    const onChanged = (event: Event) => setHousehold((h) => (h ? { ...h, name: (event as CustomEvent<string>).detail } : h));
    window.addEventListener(HOUSEHOLD_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(HOUSEHOLD_CHANGED, onChanged);
    };
  }, []);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.logo}>
          <Icon name="coin" strokeWidth={2.2} />
        </span>
        <span className={styles.wordmark}>grosz</span>
      </div>

      <nav aria-label="Główna nawigacja" className={styles.nav}>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}>
            <Icon name={item.icon} />
            {item.label}
            <span className={styles.dot} aria-hidden="true" />
          </NavLink>
        ))}
      </nav>

      <div className={styles.household}>
        <div className={styles.householdRow}>
          <span className={styles.avatar}>{household ? initials(household.name) : ''}</span>
          <span className={styles.householdText}>
            <strong>{household?.name ?? '…'}</strong>
            <span>1 osoba · {household?.currency ?? 'PLN'}</span>
          </span>
        </div>
      </div>
    </aside>
  );
}
