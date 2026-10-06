import { getBankById } from '@grosz/shared/banks';
import styles from './AccountBadge.module.css';

export interface AccountBadgeProps {
  accountName: string | null;
  accountBank: string | null;
}

export function AccountBadge({ accountName, accountBank }: AccountBadgeProps) {
  if (!accountName) return null;

  const bank = accountBank ? getBankById(accountBank) : null;
  if (!bank) {
    return <span className={styles.badge}>{accountName}</span>;
  }

  return (
    <span
      className={styles.badge}
      style={{
        backgroundColor: bank.brandColor,
        color: bank.textColor,
      }}
    >
      {accountName}
    </span>
  );
}
