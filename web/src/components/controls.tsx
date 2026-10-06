import type { ReactNode } from 'react';
import styles from './controls.module.css';

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  tone = 'surface',
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
  /** 'surface' na białej karcie, 'ground' na tle strony. */
  tone?: 'surface' | 'ground';
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`${styles.segmented} ${tone === 'ground' ? styles.onGround : ''}`}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={styles.segment} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className={styles.count}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode }) {
  return (
    <div className={styles.switchRow}>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className={styles.switch} onClick={() => onChange(!checked)}>
        <span />
      </button>
      <div className={styles.switchText}>
        <span>{label}</span>
        {description && <small>{description}</small>}
      </div>
    </div>
  );
}

export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {label}
        {hint && <span className={styles.fieldHint}>{hint}</span>}
      </span>
      {children}
      {error && <span className={styles.fieldError}>{error}</span>}
    </label>
  );
}

export const inputClass = styles.input;

/**
 * Wybór osoby („Kto”) w formularzach. Przy jednym domowniku pole nic nie wnosi, więc się nie pokazuje;
 * puste = wspólne.
 */
export function MemberField({ members, value, onChange }: { members: readonly { id: string; name: string }[]; value: string | null; onChange: (userId: string | null) => void }) {
  if (members.length < 2) return null;
  return (
    <Field label="Kto" hint="opcjonalnie">
      <select className={inputClass} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Wspólne</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
