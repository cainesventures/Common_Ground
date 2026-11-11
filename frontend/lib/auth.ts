const TOKEN_KEY = 'cg_access_token'
const HINT_KEY = 'cg_user_hint'
const RETURN_KEY = 'cg_auth_return'

/**
 * Sign-in leaves the site for Google and comes back to /auth/callback, which
 * used to always send people to the home page. Someone who signed in to vote
 * on a bill lost the bill. sessionStorage survives that round trip because it
 * stays in the same tab, and an abandoned sign-in can't leak into another tab.
 */
function saveReturnPath(): void {
  try {
    const { pathname, search, hash } = window.location
    sessionStorage.setItem(RETURN_KEY, pathname + search + hash)
  } catch {
    // Storage blocked: the callback falls back to the home page.
  }
}

/** Read and clear the page to return to after sign-in; '/' if none or unsafe. */
export function takeReturnPath(): string {
  let path: string | null = null
  try {
    path = sessionStorage.getItem(RETURN_KEY)
    sessionStorage.removeItem(RETURN_KEY)
  } catch {
    return '/'
  }
  // Same-site paths only: '//host' and '/\host' are read as other origins.
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return '/'
  if (path.startsWith('/auth/') || path.startsWith('/login')) return '/'
  return path
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function isLoggedIn(): boolean {
  return !!getToken()
}

export function getUserHint(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(HINT_KEY) || ''
}

export function setUserHint(email: string): void {
  localStorage.setItem(HINT_KEY, email)
}

/**
 * Kick off the Google OAuth flow directly — skips the /login intermediate
 * page.  Includes the stored user hint (if any) so Google can preselect the
 * account when the user has multiple Google sessions.
 */
export function startGoogleSignIn(): void {
  if (typeof window === 'undefined') return
  saveReturnPath()
  const hint = getUserHint()
  const url = hint
    ? `/api/auth/google?hint=${encodeURIComponent(hint)}`
    : '/api/auth/google'
  window.location.href = url
}
