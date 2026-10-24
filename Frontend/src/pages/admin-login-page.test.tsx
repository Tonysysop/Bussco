import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { callsTo, csrfHeader, stubFetch } from "@/test/fetch"
import { renderRoute } from "@/test/render"

const SESSION = "/api/v1/admin/auth/session"
const ADMIN_ME = "/api/v1/admin/auth/me"
const MEMBER_ME = "/api/v1/auth/me"
const ADMIN = {
  id: 7,
  full_name: "Sam Admin",
  email: "sam@example.com",
  admin_role: "super_admin",
}
const NO_ADMIN = {
  path: ADMIN_ME,
  status: 401,
  body: { error: "unauthenticated" },
}
const IS_ADMIN = { path: ADMIN_ME, status: 200, body: { user: ADMIN } }
const SIGNED_IN = { status: 201, body: { user: ADMIN, csrf_token: "rotated" } }
const INVALID = { status: 401, body: { error: "invalid_credentials" } }

const emailInput = () => screen.getByLabelText("Corporate Email Address")
const passwordInput = () => screen.getByLabelText("Password")
const submitButton = () =>
  screen.getByRole("button", { name: /Sign In to Admin Portal/ })
const sentBody = (call: [string, RequestInit?]) =>
  JSON.parse(call[1]!.body as string)

async function fillAndSubmit(
  email = " Sam@Example.com ",
  password = "a password"
) {
  await screen.findByRole("heading", { name: "Welcome Back" })
  const user = userEvent.setup()
  if (email) await user.type(emailInput(), email)
  if (password) await user.type(passwordInput(), password)
  await user.click(submitButton())
  return user
}

afterEach(() => vi.restoreAllMocks())

describe("AdminLoginPage", () => {
  it("signs in, confirms the admin with /admin/auth/me and opens /admin, never asking for the member", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem")
    const fetchMock = stubFetch(NO_ADMIN, SIGNED_IN, IS_ADMIN)
    const router = await renderRoute("/admin/login")

    await fillAndSubmit()

    await screen.findByRole("heading", { level: 1, name: "Overview" })
    expect(router.state.location.pathname).toBe("/admin")
    const [call] = callsTo(fetchMock, SESSION)
    expect(sentBody(call)).toEqual({
      email: "sam@example.com",
      password: "a password",
    })
    expect(csrfHeader(call)).toBe("csrf-token-1")
    expect(callsTo(fetchMock, ADMIN_ME, "GET")).toHaveLength(2)
    expect(callsTo(fetchMock, MEMBER_ME, "GET")).toHaveLength(0)
    expect(setItem).not.toHaveBeenCalled()
  })

  it("shows the design's field messages, marks the fields invalid and sends nothing", async () => {
    const fetchMock = stubFetch(NO_ADMIN)
    await renderRoute("/admin/login")
    await screen.findByRole("heading", { name: "Welcome Back" })
    const user = userEvent.setup()

    await user.click(submitButton())
    expect(
      screen.getByText("Enter your corporate email address.")
    ).toBeInTheDocument()
    expect(screen.getByText("Enter your password.")).toBeInTheDocument()
    expect(emailInput()).toHaveAttribute("aria-invalid", "true")
    expect(emailInput()).toHaveAccessibleDescription(
      "Enter your corporate email address."
    )
    expect(passwordInput()).toHaveAccessibleDescription("Enter your password.")
    expect(emailInput()).toHaveFocus()

    await user.type(emailInput(), "t.adebayo@")
    expect(
      screen.queryByText("Enter your corporate email address.")
    ).not.toBeInTheDocument()
    await user.click(submitButton())
    expect(
      screen.getByText("Enter a valid email address, e.g. name@company.com.")
    ).toBeInTheDocument()

    await user.type(passwordInput(), "x")
    expect(screen.queryByText("Enter your password.")).not.toBeInTheDocument()
    expect(callsTo(fetchMock, SESSION)).toHaveLength(0)
  })

  it("gives one generic answer for rejected credentials, clears only the password, and hides it on edit", async () => {
    stubFetch(NO_ADMIN, INVALID)
    await renderRoute("/admin/login")

    const user = await fillAndSubmit()

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Incorrect email or password")
    expect(alert).toHaveTextContent("Check your details and try again.")
    expect(emailInput()).toHaveValue(" Sam@Example.com ")
    expect(passwordInput()).toHaveValue("")
    expect(passwordInput()).toHaveFocus()

    await user.type(passwordInput(), "y")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("shows the pending state once and ignores repeated submits", async () => {
    let finish: (response: Response) => void = () => {}
    const fetchMock = stubFetch(NO_ADMIN)
    const realFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((path, init) =>
      path === SESSION
        ? new Promise<Response>((resolve) => (finish = resolve))
        : realFetch(path, init)
    )
    await renderRoute("/admin/login")

    const user = await fillAndSubmit()

    const busy = screen.getByRole("button", { name: /Signing in/ })
    expect(busy).toBeDisabled()
    expect(
      screen.getByRole("form", { name: "Administrator sign in" })
    ).toHaveAttribute("aria-busy", "true")
    expect(screen.getByRole("status")).toHaveTextContent("Signing in…")
    expect(emailInput()).toHaveAttribute("readonly")
    await user.keyboard("{Enter}")
    expect(callsTo(fetchMock, SESSION)).toHaveLength(1)
    finish(
      new Response(JSON.stringify(INVALID.body), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    )
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Incorrect email or password"
    )
  })

  it("explains rate limits, rejected requests and lost connections", async () => {
    stubFetch(
      NO_ADMIN,
      {
        status: 429,
        body: { error: "rate_limited" },
        headers: { "Retry-After": "900" },
      },
      { status: 403, body: { error: "invalid_csrf_token" } },
      new TypeError("Failed to fetch")
    )
    await renderRoute("/admin/login")

    const user = await fillAndSubmit()
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Try again in 15 minutes."
    )

    await user.type(passwordInput(), "a password")
    await user.click(submitButton())
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't verify this request. Please try again."
    )

    await user.click(submitButton())
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server."
    )
  })

  it("retries only the session check when it fails after Rails accepted the sign-in", async () => {
    const fetchMock = stubFetch(
      NO_ADMIN,
      SIGNED_IN,
      // The check of the new session gets no usable answer (an unreachable or failing server).
      { path: ADMIN_ME, status: 503 },
      IS_ADMIN
    )
    const router = await renderRoute("/admin/login")

    const user = await fillAndSubmit()

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't confirm your sign-in"
    )
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Try again" }))

    await screen.findByRole("heading", { level: 1, name: "Overview" })
    expect(router.state.location.pathname).toBe("/admin")
    expect(callsTo(fetchMock, SESSION)).toHaveLength(1)
  })

  it("says so when the sign-in was accepted but no admin session reached the browser", async () => {
    stubFetch(NO_ADMIN, SIGNED_IN, NO_ADMIN)
    await renderRoute("/admin/login")

    await fillAndSubmit()

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "didn't keep the admin session"
    )
    expect(passwordInput()).toBeInTheDocument()
  })

  it("explains an expired session from the guard's redirect", async () => {
    stubFetch(NO_ADMIN)
    await renderRoute("/admin/login?reason=expired")

    const status = (
      await screen.findByText("Your session has expired")
    ).closest("[role=status]")
    expect(status).toHaveTextContent("Your session has expired")
    expect(status).toHaveTextContent("For your security, please sign in again.")
  })

  it("sends a signed-in admin straight on, to a safe next page only", async () => {
    stubFetch(IS_ADMIN)
    const router = await renderRoute(
      "/admin/login?next=%2F%2Fevil.example%2Fadmin"
    )
    await screen.findByRole("heading", { level: 1, name: "Overview" })
    expect(router.state.location.pathname).toBe("/admin")
  })

  it("toggles the password's visibility accessibly", async () => {
    stubFetch(NO_ADMIN)
    await renderRoute("/admin/login")
    await screen.findByRole("heading", { name: "Welcome Back" })
    const user = userEvent.setup()

    const toggle = screen.getByRole("button", { name: "Show password" })
    expect(toggle).toHaveAttribute("aria-pressed", "false")
    expect(toggle).toHaveAttribute("aria-controls", "admin-password")
    await user.click(toggle)
    expect(passwordInput()).toHaveAttribute("type", "text")
    expect(
      screen.getByRole("button", { name: "Hide password" })
    ).toHaveAttribute("aria-pressed", "true")
  })

  it("links back to the member portal", async () => {
    stubFetch(NO_ADMIN)
    await renderRoute("/admin/login")
    expect(
      await screen.findByRole("link", { name: "Return to Member Portal" })
    ).toHaveAttribute("href", "/login")
    await waitFor(() =>
      expect(
        screen.queryByText("Checking your sign-in…")
      ).not.toBeInTheDocument()
    )
  })
})
