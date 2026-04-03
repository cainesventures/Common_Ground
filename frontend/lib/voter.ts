const KEY = 'cg_voter_token'

/** Returns the anonymous voter UUID, creating one on first call and persisting it to localStorage. */
export function getVoterToken(): string {
  if (typeof window === 'undefined') return ''
  let token = localStorage.getItem(KEY)
  if (!token) {
    token = crypto.randomUUID()
    localStorage.setItem(KEY, token)
  }
  return token
}
