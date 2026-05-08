const TOKEN_KEY = 'cg_access_token'
const HINT_KEY = 'cg_user_hint'

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
