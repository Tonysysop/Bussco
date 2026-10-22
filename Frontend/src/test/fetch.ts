import { vi } from "vitest"

// A reply with `path` answers only that path; untagged replies answer everything else, in order.
type Reply =
  | {
      status: number
      body?: unknown
      // A non-JSON body sent as-is, like Rails' send_data (the passport photo).
      raw?: string
      headers?: Record<string, string>
      path?: string
    }
  | Error

// Like Rails' API, sends Content-Type: application/json even with no body (`head :accepted`).
export function json({ status, body, raw, headers }: Exclude<Reply, Error>) {
  if (raw !== undefined)
    return new Response(raw, {
      status,
      headers: { "Content-Type": "image/png", ...headers },
    })
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
    const pathOf = (r: Reply) => (r instanceof Error ? undefined : r.path)
    const forPath = replies.findIndex((r) => pathOf(r) === path)
    const index =
      forPath !== -1 ? forPath : replies.findIndex((r) => !pathOf(r))
    if (index === -1) throw new Error(`stubFetch: no reply left for ${path}`)
    const [reply] = replies.splice(index, 1)
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
