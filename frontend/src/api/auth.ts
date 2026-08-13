import type { AuthMe, FeatureModule, AccessControl, User, Org, Role } from '@shared/types/index'

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`)
  }
  const json = await res.json() as { data: T }
  return json.data
}

export async function apiLogin(email: string, password: string): Promise<{ email: string; role: string; must_change_pw: boolean }> {
  return apiFetch('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

export async function apiLogout(): Promise<void> {
  await apiFetch('/api/v1/auth/logout', { method: 'POST' })
}

export async function fetchAuthMe(): Promise<AuthMe> {
  return apiFetch('/api/v1/auth/me')
}

export async function fetchFeatureModules(): Promise<FeatureModule[]> {
  return apiFetch('/api/v1/feature-modules')
}

export async function fetchAccessControl(): Promise<AccessControl[]> {
  return apiFetch('/api/v1/access-control')
}

export async function upsertAccessControl(entry: Omit<AccessControl, 'id'>): Promise<void> {
  await apiFetch('/api/v1/access-control', { method: 'POST', body: JSON.stringify(entry) })
}

export async function fetchUsers(): Promise<User[]> {
  return apiFetch('/api/v1/users')
}

export async function fetchOrgs(type?: string): Promise<Org[]> {
  const url = type ? `/api/v1/orgs?type=${encodeURIComponent(type)}` : '/api/v1/orgs'
  return apiFetch(url)
}

export interface CreateUserInput {
  email: string
  name: string
  /** 주 역할 — 로그인 후 첫 화면 기준 */
  role: string
  org_code: string
  /** 겸직 — 발급 시점부터 여러 화면을 쓸 계정 */
  extra_roles?: Role[]
}

export async function createUser(data: CreateUserInput): Promise<{ user: User; temp_password: string }> {
  return apiFetch('/api/v1/users', { method: 'POST', body: JSON.stringify(data) })
}

export async function updateUser(
  email: string,
  // extra_roles 는 **통째로 덮어쓴다**(추가·해제를 한 번에) — 서버가 주 역할을 빼고 저장한다
  data: { role?: string; extra_roles?: Role[]; org_code?: string; status?: string },
): Promise<User> {
  return apiFetch(`/api/v1/users/${encodeURIComponent(email)}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export async function resetUserPassword(email: string): Promise<{ temp_password: string }> {
  return apiFetch(`/api/v1/users/${encodeURIComponent(email)}/reset-password`, { method: 'POST' })
}

export async function deleteUser(email: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/v1/users/${encodeURIComponent(email)}`, { method: 'DELETE' })
}

export async function cascadeDeleteUser(email: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/v1/users/${encodeURIComponent(email)}?cascade=true`, { method: 'DELETE' })
}
