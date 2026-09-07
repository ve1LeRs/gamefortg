/** Shared hard reload to drop Telegram Mini App HTML/JS cache. */
export function hardReloadApp() {
  const next = new URL(location.href)
  const build = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : String(Date.now())
  next.searchParams.set('v', build)
  next.searchParams.set('_', String(Date.now()))
  try {
    localStorage.removeItem('gft-build-id')
  } catch {
    /* ignore */
  }
  location.replace(next.toString())
}
