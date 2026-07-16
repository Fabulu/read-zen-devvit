// Stamp data-theme on <html> so the CSS token overrides resolve on first paint.
// Source of truth: an explicit ?theme= override (future Devvit theme bridge), else
// the OS/Reddit-app color scheme via prefers-color-scheme. data-theme wins over the
// media query in both directions, so the override is authoritative when present.

function set(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.theme = theme
}

export function applyTheme(): void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const forced = new URLSearchParams(location.search).get('theme')
  if (forced === 'dark' || forced === 'light') {
    set(forced)
    return
  }
  set(mq.matches ? 'dark' : 'light')
  mq.addEventListener('change', e => set(e.matches ? 'dark' : 'light'))
}
