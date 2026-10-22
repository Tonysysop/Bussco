import { act, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { callsTo, csrfHeader, stubFetch } from "@/test/fetch"
import { renderRoute } from "@/test/render"

const SESSION = "/api/v1/auth/session"
const ME = "/api/v1/auth/me"
const USER = {
  id: 1,
  full_name: "Ada Obi",
  email: "ada@example.com",
  email_verified: true,
  account_status: "active",
  membership_status: "not_started",
}
const SIGNED_OUT = { status: 401, body: { error: "unauthenticated" } }
const SIGNED_IN = { status: 200, body: { user: USER } }
const LOGGED_IN = { status: 201, body: { user: USER, csrf_token: "rotated" } }

const emailInput = () => screen.getByLabelText("Work Email Address")
const passwordInput = () => screen.getByLabelText("Password")
const submitButton = () => screen.getByRole("button", { name: /Sign In/ })
const sentBody = (call: [string, RequestInit?]) =>
  JSON.parse(call[1]!.body as string)

async function fillAndSubmit(email = " Ada@Example.com ", password = "secret") {
  await screen.findByRole("heading", { name: "Welcome back" })
  const user = userEvent.setup()
  if (email) await user.type(emailInput(), email)
  if (password) await user.type(passwordInput(), password)
  await user.click(submitButton())
  return user
}

describe("LoginPage", () => {
  it("signs in with normalized values and opens /apply as the returned user", async () => {
    const fetchMock = stubFetch(SIGNED_OUT, LOGGED_IN, SIGNED_IN)
    const router = await renderRoute("/login")

    await fillAndSubmit()

    expect(
      await screen.findByRole("heading", { name: "Welcome, Ada Obi" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/apply")
    const [call] = callsTo(fetchMock, SESSION)
    expect(sentBody(call)).toEqual({
      email: "ada@example.com",
      password: "secret",
    })
    expect(csrfHeader(call)).toBe("csrf-token-1")
  })

  it("uses the CSRF token Rails rotates on sign-in for the next request", async () => {
    const fetchMock = stubFetch(SIGNED_OUT, LOGGED_IN, SIGNED_IN, {
      status: 202,
    })
    const router = await renderRoute("/login")
    await fillAndSubmit()
    await screen.findByRole("heading", { name: "Welcome, Ada Obi" })

    await act(() =>
      router.navigate("/verify-email", {
        state: { email: "ada@example.com", codeSentAt: 0 },
      })
    )
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Resend code" }))

    const [resend] = callsTo(fetchMock, "/api/v1/auth/email_verification")
    expect(csrfHeader(resend)).toBe("rotated")
  })

  it("keeps the session across reloads: a valid cookie skips the form", async () => {
    const fetchMock = stubFetch(SIGNED_IN, SIGNED_IN)
    const router = await renderRoute("/login")

    expect(
      await screen.findByRole("heading", { name: "Welcome, Ada Obi" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/apply")
    expect(callsTo(fetchMock, SESSION)).toHaveLength(0)
    expect(callsTo(fetchMock, ME, "GET").length).toBeGreaterThan(0)
  })

  it("shows a status, not the form, while checking the session", async () => {
    stubFetch(SIGNED_OUT)
    await renderRoute("/login")

    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking your sign-in…"
    )
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
    expect(
      await screen.findByRole("heading", { name: "Welcome back" })
    ).toBeInTheDocument()
  })

  it("offers a retry instead of the form when the session check fails", async () => {
    stubFetch(new TypeError("Failed to fetch"), SIGNED_OUT)
    await renderRoute("/login")

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server."
    )
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }))
    expect(
      await screen.findByRole("heading", { name: "Welcome back" })
    ).toBeInTheDocument()
  })

  it("gives one generic answer for wrong credentials, then clears and focuses the password", async () => {
    stubFetch(SIGNED_OUT, {
      status: 401,
      body: { error: "invalid_credentials" },
    })
    await renderRoute("/login")

    await fillAndSubmit()

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Incorrect email or password."
    )
    expect(passwordInput()).toHaveValue("")
    expect(passwordInput()).toHaveFocus()
    expect(emailInput()).toHaveValue("Ada@Example.com")
  })

  it("sends an unverified account to email verification with its address", async () => {
    stubFetch(SIGNED_OUT, {
      status: 403,
      body: { error: "email_not_verified" },
    })
    const router = await renderRoute("/login")

    await fillAndSubmit()

    expect(
      await screen.findByRole("heading", { name: "Verify your email" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/verify-email")
    expect(screen.getByText("ada@example.com")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Resend code" })
    ).toBeInTheDocument()
  })

  it("shows Zod errors under each field and sends nothing", async () => {
    const fetchMock = stubFetch(SIGNED_OUT)
    await renderRoute("/login")

    const user = await fillAndSubmit("", "")
    expect(screen.getByText("Email can't be blank")).toBeInTheDocument()
    expect(screen.getByText("Password can't be blank")).toBeInTheDocument()
    expect(emailInput()).toHaveAttribute("aria-describedby", "email-error")
    expect(passwordInput()).toHaveAttribute("aria-invalid", "true")

    await user.type(emailInput(), "nope")
    await user.click(submitButton())
    expect(screen.getByText("Email is invalid")).toBeInTheDocument()
    expect(callsTo(fetchMock, SESSION)).toHaveLength(0)
  })

  it("after verifying an unverified login, lands on /apply without bouncing through /login", async () => {
    stubFetch(
      SIGNED_OUT,
      { status: 403, body: { error: "email_not_verified" } },
      {
        status: 200,
        body: { email_verified: true, user: USER, csrf_token: "r" },
      },
      SIGNED_IN,
      SIGNED_IN
    )
    const router = await renderRoute("/login")
    const visited: string[] = []
    router.subscribe((state) => visited.push(state.location.pathname))

    const user = await fillAndSubmit()
    await screen.findByRole("heading", { name: "Verify your email" })
    await user.type(screen.getByLabelText("Verification code"), "123456")
    await user.click(screen.getByRole("button", { name: "Verify Email" }))

    await screen.findByRole("heading", { name: "Welcome, Ada Obi" })
    expect(visited).not.toContain("/login")
  })

  it.each([
    [{ status: 500 }, "Something went wrong on our side. Please try again."],
    [
      new TypeError("Failed to fetch"),
      "We couldn't reach the server. Check your connection and try again.",
    ],
    [
      {
        status: 429,
        body: { error: "rate_limited" },
        headers: { "Retry-After": "900" },
      },
      "Too many attempts. Try again in 15 minutes.",
    ],
  ])(
    "shows an alert for API failures (%#) and keeps the form usable",
    async (reply, message) => {
      stubFetch(SIGNED_OUT, reply)
      await renderRoute("/login")

      await fillAndSubmit()

      expect(await screen.findByRole("alert")).toHaveTextContent(message)
      expect(submitButton()).toBeEnabled()
      expect(passwordInput()).toHaveValue("secret")
    }
  )

  it("on a CSRF rejection, says so and fetches a new token for the next attempt", async () => {
    const fetchMock = stubFetch(
      SIGNED_OUT,
      { status: 403, body: { error: "invalid_csrf_token" } },
      LOGGED_IN,
      SIGNED_IN
    )
    await renderRoute("/login")

    const user = await fillAndSubmit()
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session expired. Please try again."
    )
    await user.click(submitButton())

    await screen.findByRole("heading", { name: "Welcome, Ada Obi" })
    expect(callsTo(fetchMock, SESSION).map(csrfHeader)).toEqual([
      "csrf-token-1",
      "csrf-token-2",
    ])
  })

  it("shows a loading button and sends one request however often it is submitted", async () => {
    const fetchMock = stubFetch(SIGNED_OUT, LOGGED_IN, SIGNED_IN)
    const reply = fetchMock.getMockImplementation()!
    let release!: () => void
    fetchMock.mockImplementation(async (path, init) => {
      if (path === SESSION) await new Promise<void>((r) => (release = r))
      return reply(path, init)
    })
    await renderRoute("/login")

    const user = await fillAndSubmit()
    const pending = screen.getByRole("button", { name: "Signing in…" })
    expect(pending).toBeDisabled()
    await user.keyboard("{Enter}")
    await user.dblClick(pending)

    await act(async () => release())
    await screen.findByRole("heading", { name: "Welcome, Ada Obi" })
    expect(callsTo(fetchMock, SESSION)).toHaveLength(1)
  })

  it("toggles password visibility with an accessible button", async () => {
    stubFetch(SIGNED_OUT)
    await renderRoute("/login")
    await screen.findByRole("heading", { name: "Welcome back" })
    const toggle = screen.getByRole("button", { name: "Show password" })

    expect(passwordInput()).toHaveAttribute("type", "password")
    expect(passwordInput()).toHaveAttribute("autocomplete", "current-password")
    await userEvent.setup().click(toggle)
    expect(passwordInput()).toHaveAttribute("type", "text")
    expect(toggle).toHaveAttribute("aria-pressed", "true")
    expect(toggle).toHaveAccessibleName("Hide password")
  })

  it("links to signup and to nothing that doesn't exist", async () => {
    stubFetch(SIGNED_OUT)
    await renderRoute("/login")
    await screen.findByRole("heading", { name: "Welcome back" })
    const links = [...document.querySelectorAll("a")]
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/signup"])
    expect(screen.queryByText(/Remember me/i)).not.toBeInTheDocument()
  })

  it("is where / sends visitors", async () => {
    stubFetch(SIGNED_OUT)
    const router = await renderRoute("/")
    await screen.findByRole("heading", { name: "Welcome back" })
    expect(router.state.location.pathname).toBe("/login")
  })
})

describe("responsive layout", () => {
  it("keeps the brand panel for desktop and the logo for small screens", async () => {
    stubFetch(SIGNED_OUT)
    await renderRoute("/login")
    await screen.findByRole("heading", { name: "Welcome back" })
    expect(document.querySelector("aside")).toHaveClass("hidden", "lg:flex")
    expect(screen.getByText(/Keep track of your savings/)).toBeInTheDocument()
    const logos = screen.getAllByRole("img")
    expect(logos.some((img) => img.closest(".lg\\:hidden"))).toBe(true)
  })
})
