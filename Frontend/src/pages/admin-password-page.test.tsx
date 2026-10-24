import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { callsTo, csrfHeader, stubFetch } from "@/test/fetch"
import { renderRoute } from "@/test/render"

const LOGIN = "/api/v1/admin/auth/session"
const ADMIN_ME = "/api/v1/admin/auth/me"
const PASSWORD = "/api/v1/admin/auth/password"
const ROOT = {
  id: 1,
  full_name: "System Admin",
  email: "root@example.com",
  admin_role: "super_admin",
  must_change_password: true,
}
const CHANGED = { ...ROOT, must_change_password: false }
const NO_ADMIN = {
  path: ADMIN_ME,
  status: 401,
  body: { error: "unauthenticated" },
}
const TEMPORARY = { path: ADMIN_ME, status: 200, body: { user: ROOT } }
const FULL = { path: ADMIN_ME, status: 200, body: { user: CHANGED } }
const SAVED = {
  path: PASSWORD,
  status: 200,
  body: { user: CHANGED, csrf_token: "after-change" },
}

const field = (label: string) => screen.getByLabelText(label)
const sentBody = (call: [string, RequestInit?]) =>
  JSON.parse(call[1]!.body as string)

async function fill(
  current = "TEMPORARY-password-1234",
  next = "a brand new password",
  confirm = next
) {
  const user = userEvent.setup()
  await screen.findByRole("heading", { name: "Set your password" })
  if (current) await user.type(field("Temporary password"), current)
  if (next) await user.type(field("New password"), next)
  if (confirm) await user.type(field("Confirm new password"), confirm)
  await user.click(screen.getByRole("button", { name: "Save new password" }))
  return user
}

afterEach(() => vi.restoreAllMocks())

describe("AdminPasswordPage", () => {
  it("keeps an admin with a temporary password on /admin/password, whatever admin page they open", async () => {
    stubFetch(TEMPORARY, TEMPORARY, TEMPORARY)
    const router = await renderRoute("/admin/members")
    await screen.findByRole("heading", { name: "Set your password" })
    expect(router.state.location.pathname).toBe("/admin/password")
    expect(screen.queryByText("Super Admin")).not.toBeInTheDocument()
  })

  it("sends a temporary-password sign-in straight to the password page, ignoring next", async () => {
    stubFetch(
      NO_ADMIN,
      { path: LOGIN, status: 201, body: { user: ROOT, csrf_token: "rotated" } },
      TEMPORARY
    )
    const router = await renderRoute("/admin/login?next=%2Fadmin%2Fmembers")
    const user = userEvent.setup()
    await user.type(
      await screen.findByLabelText("Corporate Email Address"),
      ROOT.email
    )
    await user.type(field("Password"), "TEMPORARY-password-1234")
    await user.click(
      screen.getByRole("button", { name: /Sign In to Admin Portal/ })
    )

    await screen.findByRole("heading", { name: "Set your password" })
    expect(router.state.location.pathname).toBe("/admin/password")
  })

  it("changes the password with the rotated token, then opens the portal", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem")
    const fetchMock = stubFetch(TEMPORARY, SAVED, FULL)
    const router = await renderRoute("/admin/password")

    await fill()

    expect(await screen.findByText("Super Admin")).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/admin")
    const [call] = callsTo(fetchMock, PASSWORD, "PATCH")
    expect(sentBody(call)).toEqual({
      current_password: "TEMPORARY-password-1234",
      password: "a brand new password",
    })
    expect(csrfHeader(call)).toBe("csrf-token-1")
    expect(setItem).not.toHaveBeenCalled()
  })

  it("checks the fields before sending anything", async () => {
    const fetchMock = stubFetch(TEMPORARY)
    await renderRoute("/admin/password")

    await fill("", "short", "different")
    expect(screen.getByText("Enter your current password.")).toBeInTheDocument()
    expect(
      screen.getByText("Password is too short (minimum is 12 characters)")
    ).toBeInTheDocument()
    expect(screen.getByText("Passwords don't match")).toBeInTheDocument()
    expect(field("Temporary password")).toHaveFocus()
    expect(field("New password")).toHaveAccessibleDescription(
      expect.stringContaining("Password is too short")
    )
    expect(callsTo(fetchMock, PASSWORD, "PATCH")).toHaveLength(0)
  })

  it("refuses reusing the current password, client side", async () => {
    stubFetch(TEMPORARY)
    await renderRoute("/admin/password")
    await fill("the same password", "the same password")
    expect(
      screen.getByText("Password must be different from the current password")
    ).toBeInTheDocument()
  })

  it("shows a wrong current password on its field and clears it", async () => {
    stubFetch(TEMPORARY, {
      path: PASSWORD,
      status: 422,
      body: { error: "invalid_current_password" },
    })
    await renderRoute("/admin/password")

    await fill()

    expect(
      await screen.findByText("Your current password is incorrect.")
    ).toBeInTheDocument()
    expect(field("Temporary password")).toHaveValue("")
    expect(field("Temporary password")).toHaveFocus()
    expect(field("Temporary password")).toHaveAttribute("aria-invalid", "true")
  })

  it("shows Rails' password rule errors and connection failures", async () => {
    stubFetch(
      TEMPORARY,
      {
        path: PASSWORD,
        status: 422,
        body: { errors: { password: ["is too long (maximum is 72 bytes)"] } },
      },
      new TypeError("Failed to fetch")
    )
    await renderRoute("/admin/password")

    const user = await fill()
    expect(
      await screen.findByText("Password is too long (maximum is 72 bytes)")
    ).toBeInTheDocument()

    await user.type(field("New password"), "!")
    await user.type(field("Confirm new password"), "!")
    await user.click(screen.getByRole("button", { name: "Save new password" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server."
    )
  })

  it("returns to sign-in when the session ended", async () => {
    stubFetch(
      TEMPORARY,
      { path: PASSWORD, status: 401, body: { error: "unauthenticated" } },
      NO_ADMIN
    )
    const router = await renderRoute("/admin/password")

    await fill()

    await screen.findByRole("heading", { name: "Welcome Back" })
    expect(router.state.location.pathname).toBe("/admin/login")
  })

  it("offers sign-out on the forced change, and a voluntary change for other admins", async () => {
    stubFetch(FULL)
    await renderRoute("/admin/password")
    await screen.findByRole("heading", { name: "Change your password" })
    expect(field("Current password")).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Back to the portal" })
    ).toHaveAttribute("href", "/admin")
    expect(
      screen.queryByRole("button", { name: "Sign out" })
    ).not.toBeInTheDocument()
  })
})
