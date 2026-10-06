import { useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { plural } from '@grosz/shared/format';
import { api, HOUSEHOLD_CHANGED, type HouseholdChange } from '../api.ts';
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
  const [household, setHousehold] = useState<{ name: string; currency: string; memberCount: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.settings().then(
      (result) => !cancelled && setHousehold({ ...result.household, memberCount: result.members.length }),
      () => undefined, // karta gospodarstwa jest tylko ozdobą — brak danych nie blokuje nawigacji
    );
    // Ustawienia ogłaszają zmianę nazwy lub liczby osób, żeby karta w sidebarze nie czekała na przeładowanie strony.
    const onChanged = (event: Event) => setHousehold((h) => (h ? { ...h, ...(event as CustomEvent<HouseholdChange>).detail } : h));
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
            <span>
              {household ? `${household.memberCount} ${plural(household.memberCount, ['osoba', 'osoby', 'osób'])}` : ''} · {household?.currency ?? 'PLN'}
            </span>
          </span>
        </div>
      </div>
    </aside>
  );
}
