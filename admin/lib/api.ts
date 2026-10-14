export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '')

const TOKEN_KEY = 'distriar_admin_token'

export function getAdminToken() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(TOKEN_KEY)
}

export function setAdminToken(token: string | null) {
  if (typeof window === 'undefined') return
  if (token) window.localStorage.setItem(TOKEN_KEY, token)
  else window.localStorage.removeItem(TOKEN_KEY)
}

export function apiUrl(path: string) {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

export class ApiError extends Error {
  status: number
  detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

type RequestOptions = RequestInit & {
  businessScope?: string
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { businessScope, headers: initialHeaders, ...request } = options
  const headers = new Headers(initialHeaders)
  const token = getAdminToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (businessScope) headers.set('X-Business-Scope', businessScope)
  if (request.body && !(request.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(apiUrl(path), {
    ...request,
    headers,
    cache: 'no-store',
  })
  if (!response.ok) {
    let detail = `Error ${response.status}`
    try {
      const payload = await response.json()
      detail = String(payload?.detail || payload?.error || detail)
    } catch {
      // Keep the status-based message when the API does not return JSON.
    }
    throw new ApiError(response.status, detail)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function adminLogin(username: string, password: string, businessScope: string) {
  const body = new URLSearchParams({ username, password, scope: businessScope })
  const response = await fetch(apiUrl('/admin/auth/token'), {
    method: 'POST',
    body,
    cache: 'no-store',
  })
  if (!response.ok) {
    let detail = 'Usuario o contraseña incorrectos.'
    try {
      const payload = await response.json()
      detail = String(payload?.detail || detail)
    } catch {
      // Keep the friendly default.
    }
    throw new ApiError(response.status, detail)
  }
  const payload = await response.json() as { access_token: string }
  setAdminToken(payload.access_token)
  return payload
}

export function websocketUrl(path = '/ws/products') {
  if (typeof window === 'undefined') return ''
  const configured = apiUrl(path)
  const url = new URL(configured, window.location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}
