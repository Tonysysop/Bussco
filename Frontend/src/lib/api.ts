import { queryOptions } from "@tanstack/react-query"

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

// A 401 means signed out: it resolves to null, replacing any cached user, rather than erroring.
export const meQuery = queryOptions({
  queryKey: ["auth", "me"],
  queryFn: async (): Promise<Me | null> => {
    try {
      return (await apiGet("/api/v1/auth/me")) as Me
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null
      throw error
    }
  },
  // Other failures get a Try again button.
  retry: false,
})

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
