import { Link } from 'react-router';

export function ComingSoon({ title }: { title: string }) {
  return (
    <section style={{ background: 'var(--surface)', borderRadius: 'var(--radius-card)', padding: 32, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h1 style={{ fontSize: 32 }}>{title}</h1>
      <p style={{ margin: 0, color: 'var(--text-2)' }}>Ten ekran jest w przygotowaniu.</p>
      <Link to="/" style={{ fontWeight: 500 }}>
        Wróć na pulpit
      </Link>
    </section>
  );
}
