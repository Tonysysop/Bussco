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

describe("passportPhotoQuery", () => {
  const A = { id: 1, email: "ada@example.com" }
  const B = { id: 2, email: "bola@example.com" }
  const PHOTO = "/api/v1/membership/application/passport_photo"
  const image = (owner: string) => ({
    path: PHOTO,
    status: 200,
    raw: "photo",
    headers: { "X-Applicant-Id": owner },
  })

  it("returns the photo only when Rails names the requesting applicant as its owner", async () => {
    const { createQueryClient, passportPhotoQuery } = await loadApi()
    const fetchMock = stubFetch(image("1"))
    const blob = await createQueryClient().fetchQuery(
      passportPhotoQuery(A, "sum")
    )

    expect(await blob.text()).toBe("photo")
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" })
  })

  it("rejects a photo answered for another sign-in, never caches it, and rechecks /me", async () => {
    const { createQueryClient, IdentityMismatch, meQuery, passportPhotoQuery } =
      await loadApi()
    stubFetch(image("2"), {
      path: "/api/v1/auth/me",
      status: 200,
      body: { user: B },
    })
    const client = createQueryClient()
    client.setQueryData(meQuery.queryKey, { user: { ...A } } as never)

    await expect(
      client.fetchQuery(passportPhotoQuery(A, "sum"))
    ).rejects.toBeInstanceOf(IdentityMismatch)
    expect(
      client.getQueryData(passportPhotoQuery(A, "sum").queryKey)
    ).toBeUndefined()
    expect(client.getQueryState(meQuery.queryKey)?.isInvalidated).toBe(true)
  })

  it("is keyed per applicant and per photo, and forgotten with the session", async () => {
    const { createQueryClient, forgetSession, passportPhotoQuery } =
      await loadApi()
    const client = createQueryClient()
    const key = passportPhotoQuery(A, "sum").queryKey
    expect(key).not.toEqual(passportPhotoQuery(B, "sum").queryKey)
    expect(key).not.toEqual(passportPhotoQuery(A, "other").queryKey)

    client.setQueryData(key, new Blob(["photo"]))
    forgetSession(client)
    expect(client.getQueryData(key)).toBeUndefined()
  })
})

describe("application writes name their applicant", () => {
  const ADA = { id: 1, email: "ada@example.com" }
  const APP = "/api/v1/membership/application"

  it("sends the /me user's id with the write", async () => {
    const { startApplication } = await loadApi()
    const fetchMock = stubFetch({
      status: 201,
      body: {
        application: {},
        applicant: { email: ADA.email },
        progress: null,
      },
    })
    await startApplication(ADA)

    const [call] = callsTo(fetchMock, APP)
    expect(new Headers(call[1]?.headers).get("X-Applicant-Id")).toBe("1")
  })

  it("treats Rails refusing a write for another sign-in as an identity mismatch", async () => {
    const { startApplication, IdentityMismatch } = await loadApi()
    stubFetch({ status: 409, body: { error: "identity_mismatch" } })

    await expect(startApplication(ADA)).rejects.toBeInstanceOf(IdentityMismatch)
  })
})
