type Tab = 'store' | 'library' | 'profile'

const ICONS: Record<Tab, React.ReactNode> = {
  store: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 9h16l-1.2 10.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8L4 9Z" />
      <path d="M8 9V7a4 4 0 0 1 8 0v2" />
    </svg>
  ),
  library: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="6" height="16" rx="1" />
      <rect x="11" y="4" width="4" height="16" rx="1" />
      <rect x="17" y="4" width="4" height="16" rx="1" />
    </svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.8-3.5 4.6-5 8-5s6.2 1.5 8 5" />
    </svg>
  ),
}

const LABELS: Record<Tab, string> = {
  store: 'Магазин',
  library: 'Библиотека',
  profile: 'Профиль',
}

export function TabNav({
  active,
  onChange,
}: {
  active: Tab
  onChange: (tab: Tab) => void
}) {
  return (
    <nav className="tab-nav" aria-label="Навигация">
      {(['store', 'library', 'profile'] as Tab[]).map((tab) => (
        <button
          key={tab}
          type="button"
          className={`tab-btn ${active === tab ? 'active' : ''}`}
          onClick={() => onChange(tab)}
        >
          {ICONS[tab]}
          <span>{LABELS[tab]}</span>
        </button>
      ))}
    </nav>
  )
}

export type { Tab }
