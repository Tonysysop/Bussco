import { act, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { focusManager } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { safeAdminPath } from "@/components/admin-layout"
import { callsTo, csrfHeader, stubFetch } from "@/test/fetch"
import { renderRoute } from "@/test/render"

const SESSION = "/api/v1/admin/auth/session"
const ADMIN_ME = "/api/v1/admin/auth/me"
const MEMBER_ME = "/api/v1/auth/me"
const ADMIN = {
  id: 7,
  full_name: "Tia Admin",
  email: "tia@example.com",
  admin_role: "treasurer",
}
const NO_ADMIN = {
  path: ADMIN_ME,
  status: 401,
  body: { error: "unauthenticated" },
}
const IS_ADMIN = { path: ADMIN_ME, status: 200, body: { user: ADMIN } }

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("admin routes", () => {
  it("shows the signed-in admin after a refresh, with the role Rails reports", async () => {
    const fetchMock = stubFetch(IS_ADMIN)
    await renderRoute("/admin")

    expect(await screen.findByText("Tia Admin")).toBeInTheDocument()
    expect(screen.getByText("Treasurer")).toBeInTheDocument()
    expect(callsTo(fetchMock, MEMBER_ME, "GET")).toHaveLength(0)
  })

  it("sends visitors without an admin session to the admin login, remembering the page", async () => {
    stubFetch(NO_ADMIN)
    const router = await renderRoute("/admin/members?tab=new")

    await screen.findByRole("heading", { name: "Welcome Back" })
    expect(router.state.location.pathname).toBe("/admin/login")
    expect(new URLSearchParams(router.state.location.search).get("next")).toBe(
      "/admin/members?tab=new"
    )
    expect(
      screen.queryByText("Your session has expired")
    ).not.toBeInTheDocument()
  })

  it("never treats a member session as an admin one", async () => {
    // A signed-in member: member /me would answer 200, admin /me answers 401.
    const fetchMock = stubFetch(NO_ADMIN, {
      path: MEMBER_ME,
      status: 200,
      body: { user: { id: 1 } },
    })
    const router = await renderRoute("/admin")

    await screen.findByRole("heading", { name: "Welcome Back" })
    expect(router.state.location.pathname).toBe("/admin/login")
    expect(callsTo(fetchMock, MEMBER_ME, "GET")).toHaveLength(0)
  })

  it("sends unknown admin pages to /admin for a signed-in admin", async () => {
    stubFetch(IS_ADMIN, IS_ADMIN)
    const router = await renderRoute("/admin/nope")
    await screen.findByText("Tia Admin")
    expect(router.state.location.pathname).toBe("/admin")
  })

  it("re-asks Rails when the cached answer is stale, and an ended session returns to login as expired", async () => {
    stubFetch(IS_ADMIN, NO_ADMIN)
    const router = await renderRoute("/admin")
    await screen.findByText("Tia Admin")

    // 30 s later the answer is stale; focusing the window re-asks Rails, which now says no session.
    const now = Date.now()
    vi.spyOn(Date, "now").mockReturnValue(now + 31_000)
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })

    expect(
      await screen.findByText("Your session has expired")
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/admin/login")
    expect(
      new URLSearchParams(router.state.location.search).get("reason")
    ).toBe("expired")
  })

  it("re-checks the session on navigation inside /admin once the answer is stale", async () => {
    const fetchMock = stubFetch(IS_ADMIN, NO_ADMIN)
    const router = await renderRoute("/admin")
    await screen.findByText("Tia Admin")

    await act(() => router.navigate("/admin/elsewhere"))
    expect(callsTo(fetchMock, ADMIN_ME, "GET")).toHaveLength(1) // still fresh: no request

    const now = Date.now()
    vi.spyOn(Date, "now").mockReturnValue(now + 31_000)
    await act(() => router.navigate("/admin/another"))

    expect(
      await screen.findByText("Your session has expired")
    ).toBeInTheDocument()
    expect(callsTo(fetchMock, ADMIN_ME, "GET")).toHaveLength(2)
  })

  it("signs out with the CSRF token, forgets the admin and leaves member endpoints alone", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem")
    const fetchMock = stubFetch(
      IS_ADMIN,
      { path: SESSION, status: 200, body: { csrf_token: "after-logout" } },
      NO_ADMIN
    )
    const router = await renderRoute("/admin")
    const user = userEvent.setup()

    await user.click(await screen.findByRole("button", { name: "Sign out" }))

    await screen.findByRole("heading", { name: "Welcome Back" })
    expect(router.state.location.pathname).toBe("/admin/login")
    expect(router.state.location.search).toBe("")
    expect(
      screen.queryByText("Your session has expired")
    ).not.toBeInTheDocument()
    const [call] = callsTo(fetchMock, SESSION, "DELETE")
    expect(csrfHeader(call)).toBe("csrf-token-1")
    expect(
      fetchMock.mock.calls.some(([path]) => path.startsWith("/api/v1/auth/"))
    ).toBe(false)
    expect(setItem).not.toHaveBeenCalled()
  })

  it("stays signed in and says so when sign-out fails", async () => {
    stubFetch(IS_ADMIN, new TypeError("Failed to fetch"))
    const router = await renderRoute("/admin")
    const user = userEvent.setup()

    await user.click(await screen.findByRole("button", { name: "Sign out" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't sign you out"
    )
    expect(router.state.location.pathname).toBe("/admin")
  })
})

describe("safeAdminPath", () => {
  it("keeps internal admin pages only", () => {
    expect(safeAdminPath("/admin/members?tab=new#top")).toBe(
      "/admin/members?tab=new#top"
    )
    expect(safeAdminPath("/admin")).toBe("/admin")
    for (const unsafe of [
      null,
      "",
      "//evil.example/admin",
      "https://evil.example/admin",
      "/\\evil.example",
      "/apply",
      "/admin/login",
      "/admin/../login",
      "/admin/%2e%2e/apply",
      "javascript:alert(1)",
      "/administrator",
    ])
      expect(safeAdminPath(unsafe)).toBe("/admin")
  })
})
