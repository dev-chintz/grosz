import { NavLink } from 'react-router';
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

export function Sidebar() {
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
          <span className={styles.avatar}>JA</span>
          <span className={styles.householdText}>
            <strong>Budżet osobisty</strong>
            <span>1 osoba · PLN</span>
          </span>
        </div>
      </div>
    </aside>
  );
}
