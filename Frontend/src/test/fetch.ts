import { vi } from "vitest"

type Reply =
  { status: number; body?: unknown; headers?: Record<string, string> } | Error

// Like Rails' API, sends Content-Type: application/json even with no body (`head :accepted`).
export function json({ status, body, headers }: Exclude<Reply, Error>) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

// Answers /api/v1/csrf with a fresh token each time and every other request from `replies`, in order.
export function stubFetch(...replies: Reply[]) {
  let tokens = 0
  const fetchMock = vi.fn<
    (path: string, init?: RequestInit) => Promise<Response>
  >(async (path) => {
    if (path === "/api/v1/csrf")
      return json({
        status: 200,
        body: { csrf_token: `csrf-token-${++tokens}` },
      })
    const reply = replies.shift()!
    if (reply instanceof Error) throw reply
    return json(reply)
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

export const callsTo = (
  fetchMock: ReturnType<typeof stubFetch>,
  path: string,
  method = "POST"
) =>
  fetchMock.mock.calls.filter(
    ([p, init]) => p === path && (init?.method ?? "GET") === method
  )

export const csrfHeader = ([, init]: [string, RequestInit?]) =>
  new Headers(init?.headers).get("X-CSRF-Token")
