// Liniowe ikony 24×24 (stroke = currentColor), jak w mockupie. Bez emoji.

const PATHS = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="2" />
      <rect x="14" y="3" width="7" height="5" rx="2" />
      <rect x="14" y="12" width="7" height="9" rx="2" />
      <rect x="3" y="16" width="7" height="5" rx="2" />
    </>
  ),
  transactions: <path d="M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3" />,
  recurring: (
    <>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a3 3 0 0 1 3-3h15" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a3 3 0 0 1-3 3H3" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  tag: (
    <>
      <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </>
  ),
  chart: <path d="M3 21h18M6 17v-6M11 17V6M16 17v-4M21 17V9" />,
  settings: (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  basket: (
    <>
      <path d="M6 2l1.5 4M18 2l-1.5 4M3 6h18l-2 14H5z" />
      <path d="M9 11v5M15 11v5" />
    </>
  ),
  pause: <path d="M9 5v14M15 5v14" />,
  pencil: <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />,
  chevronUp: <path d="M6 15l6-6 6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  play: <path d="M7 5l12 7-12 7z" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  download: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  coin: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 8.5v7" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, strokeWidth = 1.8 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
