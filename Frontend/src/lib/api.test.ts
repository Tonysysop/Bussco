import { describe, expect, it, vi } from "vitest"

import { callsTo, csrfHeader, stubFetch } from "@/test/fetch"

async function loadApi() {
  // Fresh module so each test starts without a cached CSRF token.
  vi.resetModules()
  return import("@/lib/api")
}

describe("api CSRF handling", () => {
  it("adopts the token Rails rotates on sign-in instead of the dead one", async () => {
    const { apiPatch, apiPost } = await loadApi()
    const fetchMock = stubFetch(
      { status: 200, body: { email_verified: true, csrf_token: "rotated" } },
      { status: 202 }
    )

    await apiPatch("/api/v1/auth/email_verification", {})
    await apiPost("/api/v1/auth/email_verification", {})

    const [verify] = callsTo(
      fetchMock,
      "/api/v1/auth/email_verification",
      "PATCH"
    )
    const [resend] = callsTo(fetchMock, "/api/v1/auth/email_verification")
    expect(csrfHeader(verify)).toBe("csrf-token-1")
    expect(csrfHeader(resend)).toBe("rotated")
    expect(callsTo(fetchMock, "/api/v1/csrf", "GET")).toHaveLength(1)
  })
})

describe("api response bodies", () => {
  // The stub sends Content-Type: application/json on these, as Rails' `head` does.
  it.each([202, 204])(
    "treats an empty %i as success with no body",
    async (status) => {
      const { apiPost } = await loadApi()
      stubFetch({ status })
      await expect(apiPost("/api/v1/x", {})).resolves.toBeNull()
    }
  )

  it("still parses a JSON body", async () => {
    const { apiPost } = await loadApi()
    stubFetch({ status: 201, body: { user: { email: "ada@example.com" } } })
    await expect(apiPost("/api/v1/x", {})).resolves.toEqual({
      user: { email: "ada@example.com" },
    })
  })

  it("reports a failed request as a connection problem", async () => {
    const { apiPost, apiErrorMessage } = await loadApi()
    stubFetch(new TypeError("Failed to fetch"))
    const error = await apiPost("/api/v1/x", {}).catch((e: Error) => e)
    expect(apiErrorMessage(error as Error)).toBe(
      "We couldn't reach the server. Check your connection and try again."
    )
  })

  it("does not call an unreadable response a connection problem", async () => {
    const { apiPost, apiErrorMessage } = await loadApi()
    const headers = { "Content-Type": "application/json" }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        path === "/api/v1/csrf"
          ? new Response(JSON.stringify({ csrf_token: "t" }), { headers })
          : new Response("<html>", { headers })
      )
    )
    const error = await apiPost("/api/v1/x", {}).catch((e: Error) => e)
    expect(apiErrorMessage(error as Error)).toBe(
      "Something went wrong on our side. Please try again."
    )
  })
})
