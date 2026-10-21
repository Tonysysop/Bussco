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
  const body = response.headers
    .get("Content-Type")
    ?.includes("application/json")
    ? await response.json()
    : null
  if (!response.ok) throw new ApiError(response, body)
  return body
}

export async function apiPost(path: string, data: unknown) {
  try {
    return await request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": await fetchCsrfToken(),
      },
      body: JSON.stringify(data),
    })
  } catch (error) {
    // The Rails session (and with it the token) may have changed; fetch a fresh one next time.
    if (error instanceof ApiError && error.status === 403) csrfToken = null
    throw error
  }
}
