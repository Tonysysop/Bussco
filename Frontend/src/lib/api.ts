import { queryOptions, type QueryClient } from "@tanstack/react-query"

export class ApiError extends Error {
  status: number
  body: unknown
  retryAfter: number | null

  constructor(response: Response, body: unknown) {
    super(`API request failed with status ${response.status}`)
    this.status = response.status
    this.body = body
    const retryAfter = Number(response.headers.get("Retry-After"))
    this.retryAfter = retryAfter > 0 ? retryAfter : null
  }
}

// Kept in memory only (docs/auth/browser-foundations.md); any token for the current Rails session works.
let csrfToken: Promise<string> | null = null

function fetchCsrfToken() {
  if (!csrfToken) {
    csrfToken = request("/api/v1/csrf").then(
      (body) => (body as { csrf_token: string }).csrf_token
    )
    csrfToken.catch(() => (csrfToken = null))
  }
  return csrfToken
}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { Accept: "application/json", ...init.headers },
  })
  // Rails' `head :accepted` sends Content-Type: application/json with an empty body.
  const text = await response.text()
  const body =
    text && response.headers.get("Content-Type")?.includes("application/json")
      ? JSON.parse(text)
      : null
  if (!response.ok) throw new ApiError(response, body)
  return body
}

export const apiGet = (path: string) => request(path)

export type Me = {
  user: {
    id: number
    full_name: string
    email: string
    email_verified: boolean
    account_status: string
    membership_status: string
  }
}

// GET that resolves to null for the one status meaning "there is none", rather than erroring.
async function getOrNull<T>(path: string, noneStatus: number) {
  try {
    return (await apiGet(path)) as T
  } catch (error) {
    if (error instanceof ApiError && error.status === noneStatus) return null
    throw error
  }
}

// Every cached application lives under this key (see applicationQuery).
const MEMBERSHIP_KEY = ["membership"]

// A 401 means signed out: it resolves to null, replacing any cached user, rather than erroring.
export const meQuery = queryOptions({
  queryKey: ["auth", "me"],
  queryFn: async ({ client }) => {
    const me = await getOrNull<Me>("/api/v1/auth/me", 401)
    // Wherever Rails reports the session over, no cached application may outlive it.
    if (!me) client.removeQueries({ queryKey: MEMBERSHIP_KEY })
    return me
  },
  // Other failures get a Try again button.
  retry: false,
})

export const APPLICATION_PATH = "/api/v1/membership/application"

// Only the fields the frontend reads (Backend/docs/membership/application.md).
export type MembershipApplication = {
  application: { submitted_at: string | null; lock_version: number }
  applicant: { full_name: string; email: string; membership_status: string }
  // null once submitted; current_stage is the first incomplete stage, or "review".
  progress: {
    stages: Record<string, "complete" | "incomplete">
    current_stage: string
    ready_to_submit: boolean
  } | null
}

// A 404 means never started. Keyed by the /me user id: on a shared computer the next person to sign
// in must never be shown the previous person's cached application.
export const applicationQuery = (userId: number) =>
  queryOptions({
    queryKey: [...MEMBERSHIP_KEY, "application", userId],
    queryFn: () => getOrNull<MembershipApplication>(APPLICATION_PATH, 404),
    retry: false,
  })

// Signed out without asking /me (an application 401, password reset, later logout): forget the user
// and every cached application, so none of it outlives the session in memory.
export function forgetSession(queryClient: QueryClient) {
  queryClient.setQueryData(meQuery.queryKey, () => null)
  queryClient.removeQueries({ queryKey: MEMBERSHIP_KEY })
}

async function send(method: string, path: string, data: unknown) {
  try {
    const body = await request(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": await fetchCsrfToken(),
      },
      body: JSON.stringify(data),
    })
    // Sign-in resets the Rails session, killing the old token; Rails returns its replacement.
    const rotated = (body as { csrf_token?: unknown } | null)?.csrf_token
    if (typeof rotated === "string") csrfToken = Promise.resolve(rotated)
    return body
  } catch (error) {
    // The Rails session (and with it the token) may have changed; fetch a fresh one next time.
    if (error instanceof ApiError && error.status === 403) csrfToken = null
    throw error
  }
}

export const apiPost = (path: string, data: unknown) => send("POST", path, data)
export const apiPatch = (path: string, data: unknown) =>
  send("PATCH", path, data)

// Message for any failure a form can't attribute to a field.
export function apiErrorMessage(error: Error) {
  // fetch rejects with a TypeError only when no response arrived.
  if (error instanceof TypeError)
    return "We couldn't reach the server. Check your connection and try again."
  if (!(error instanceof ApiError))
    return "Something went wrong on our side. Please try again."
  if (error.status === 403) return "Your session expired. Please try again."
  if (error.status === 429) {
    const minutes = Math.ceil((error.retryAfter ?? 900) / 60)
    return `Too many attempts. Try again in ${minutes} minutes.`
  }
  return "Something went wrong on our side. Please try again."
}
