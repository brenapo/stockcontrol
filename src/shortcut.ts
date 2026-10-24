// Home-screen shortcuts open /app?go=new or /app?go=list; read once, then clean the URL
export function takeShortcut(): 'new' | 'list' | null {
  const go = new URLSearchParams(location.search).get('go')
  if (go) history.replaceState(null, '', location.pathname)
  return go === 'new' || go === 'list' ? go : null
}
