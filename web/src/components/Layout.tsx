import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar.tsx';
import styles from './Layout.module.css';

export function Layout() {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <div className={styles.content}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
