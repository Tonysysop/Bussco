import { act, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { callsTo, csrfHeader, json, stubFetch } from "@/test/fetch"
import { renderRoute } from "@/test/render"

// /apply also loads the application; a 404 is "not started", which shows the start screen.
const NOT_STARTED = {
  path: "/api/v1/membership/application",
  status: 404,
  body: { error: "not_found" },
}
const APPLY_HEADING = "Complete your membership application"

const PATH = "/api/v1/auth/email_verification"
const USER = { id: 1, full_name: "Ada Obi", email: "ada@example.com" }

// Long enough ago that the resend countdown has finished, unless a test says otherwise.
const FROM_SIGNUP = { email: "ada@example.com", codeSentAt: 0 }

const codeInput = () => screen.getByLabelText("Verification code")
const sentBody = (call: [string, RequestInit?]) =>
  JSON.parse(call[1]!.body as string)

// One act per second, so the page's 1-second ticker re-renders and reschedules as in a browser.
async function tick(seconds: number) {
  for (let i = 0; i < seconds; i++)
    await act(() => vi.advanceTimersByTimeAsync(1_000))
}

describe("VerifyEmailPage", () => {
  it("verifies the code, then shows the signed-in user from /me", async () => {
    const fetchMock = stubFetch(
      NOT_STARTED,
      {
        status: 200,
        body: { email_verified: true, user: USER, csrf_token: "rotated" },
      },
      { status: 200, body: { user: USER } }
    )
    const router = await renderRoute("/verify-email", FROM_SIGNUP)
    const user = userEvent.setup()

    expect(screen.getByText("ada@example.com")).toBeInTheDocument()
    await user.type(codeInput(), "123456")
    await user.click(screen.getByRole("button", { name: "Verify Email" }))

    expect(
      await screen.findByRole("heading", { name: APPLY_HEADING })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/apply")
    const [call] = callsTo(fetchMock, PATH, "PATCH")
    expect(sentBody(call)).toEqual({ email: "ada@example.com", code: "123456" })
    expect(csrfHeader(call)).toBe("csrf-token-1")
    expect(callsTo(fetchMock, "/api/v1/auth/me", "GET")).toHaveLength(1)
  })

  it("says to sign in when Rails verifies without signing this browser in", async () => {
    stubFetch({ status: 200, body: { email_verified: true } })
    const router = await renderRoute("/verify-email", FROM_SIGNUP)
    const user = userEvent.setup()

    await user.type(codeInput(), "123456")
    await user.keyboard("{Enter}")

    expect(
      await screen.findByRole("heading", { name: "Email verified" })
    ).toBeInTheDocument()
    expect(screen.getByText(/Sign in with your email/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login"
    )
    expect(router.state.location.pathname).toBe("/verify-email")
  })

  it("explains an incorrect or expired code, clears it and refocuses", async () => {
    stubFetch({ status: 422, body: { error: "invalid_code" } })
    await renderRoute("/verify-email", FROM_SIGNUP)
    const user = userEvent.setup()

    await user.type(codeInput(), "999999")
    await user.click(screen.getByRole("button", { name: "Verify Email" }))

    expect(
      await screen.findByText(/incorrect or has expired/)
    ).toBeInTheDocument()
    expect(codeInput()).toHaveValue("")
    expect(codeInput()).toHaveFocus()
    expect(codeInput()).toHaveAttribute("aria-invalid", "true")
    expect(codeInput()).toHaveAttribute("aria-describedby", "code-error")
  })

  it("rejects an incomplete code without calling the API", async () => {
    const fetchMock = stubFetch()
    await renderRoute("/verify-email", FROM_SIGNUP)
    const user = userEvent.setup()

    await user.type(codeInput(), "123")
    await user.click(screen.getByRole("button", { name: "Verify Email" }))

    expect(screen.getByText("Enter the 6-digit code")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("accepts a pasted code and ignores non-digits", async () => {
    await renderRoute("/verify-email", FROM_SIGNUP)
    const user = userEvent.setup()

    await user.click(codeInput())
    await user.paste("123456")
    expect(codeInput()).toHaveValue("123456")

    await user.clear(codeInput())
    await user.type(codeInput(), "1a2b")
    expect(codeInput()).toHaveValue("12")
  })

  it("sends one request however often the form is submitted", async () => {
    const fetchMock = stubFetch({ status: 200, body: { email_verified: true } })
    await renderRoute("/verify-email", FROM_SIGNUP)
    const user = userEvent.setup()

    await user.type(codeInput(), "123456")
    await user.dblClick(screen.getByRole("button", { name: "Verify Email" }))
    await user.keyboard("{Enter}")

    await screen.findByRole("heading", { name: "Email verified" })
    expect(callsTo(fetchMock, PATH, "PATCH")).toHaveLength(1)
  })

  it("counts down from signup before offering a resend", async () => {
    await renderRoute("/verify-email", {
      ...FROM_SIGNUP,
      codeSentAt: Date.now() - 59_000,
    })

    expect(screen.getByText(/Resend code in 0:0[01]/)).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Resend code" })
    ).not.toBeInTheDocument()
    expect(
      await screen.findByRole(
        "button",
        { name: "Resend code" },
        { timeout: 2500 }
      )
    ).toBeInTheDocument()
  })

  it("on a direct visit, asks for the email and starts no countdown", async () => {
    const fetchMock = stubFetch({ status: 202 })
    await renderRoute("/verify-email")
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Resend code" }))
    expect(screen.getByText("Email can't be blank")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    await user.type(
      screen.getByLabelText("Work Email Address"),
      " Ada@Example.com"
    )
    await user.click(screen.getByRole("button", { name: "Resend code" }))

    expect(await screen.findByText(/Resend code in 1:00/)).toBeInTheDocument()
    const [call] = callsTo(fetchMock, PATH, "POST")
    expect(sentBody(call)).toEqual({ email: "ada@example.com" })
    // 202 is generic, so the message must not claim an email was sent.
    expect(screen.getByRole("status")).toHaveTextContent(/Request received/)
  })

  it("includes the typed email when verifying from a direct visit", async () => {
    const fetchMock = stubFetch({ status: 200, body: { email_verified: true } })
    await renderRoute("/verify-email")
    const user = userEvent.setup()

    await user.type(codeInput(), "123456")
    await user.click(screen.getByRole("button", { name: "Verify Email" }))
    expect(screen.getByText("Email can't be blank")).toBeInTheDocument()

    await user.type(
      screen.getByLabelText("Work Email Address"),
      "ada@example.com"
    )
    await user.click(screen.getByRole("button", { name: "Verify Email" }))

    await screen.findByRole("heading", { name: "Email verified" })
    expect(sentBody(callsTo(fetchMock, PATH, "PATCH")[0])).toEqual({
      email: "ada@example.com",
      code: "123456",
    })
  })

  it("treats Rails' empty 202 as a resend, not a network error", async () => {
    // Rails answers `head :accepted`: Content-Type application/json, no body.
    const fetchMock = stubFetch({ status: 202 })
    await renderRoute("/verify-email", FROM_SIGNUP)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Resend code" }))

    // The confirmation and the countdown show together.
    expect(await screen.findByText(/Resend code in 1:00/)).toBeInTheDocument()
    const status = screen.getByRole("status")
    expect(status).toHaveAttribute("aria-live", "polite")
    expect(status).toHaveTextContent(
      "Request received" +
        "If eligible, a new verification code will arrive shortly."
    )
    expect(status).not.toHaveTextContent(/Resend code in/)
    // No assertive region nested inside the polite one.
    expect(screen.queryByRole("alert")).toBeNull()
    expect(status.firstElementChild).toHaveClass(
      "fade-in",
      "motion-reduce:animate-none"
    )
    expect(screen.queryByText(/couldn't reach the server/)).toBeNull()
    expect(callsTo(fetchMock, PATH, "POST")).toHaveLength(1)
  })

  it("shows a spinner and blocks repeat clicks while the resend is pending", async () => {
    const fetchMock = vi.fn(async (path: string) =>
      path === "/api/v1/csrf"
        ? json({ status: 200, body: { csrf_token: "t" } })
        : new Promise<Response>(() => {})
    )
    vi.stubGlobal("fetch", fetchMock)
    await renderRoute("/verify-email", FROM_SIGNUP)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Resend code" }))

    const pending = await screen.findByRole("button", { name: "Requesting…" })
    expect(pending).toBeDisabled()
    expect(pending.querySelector("svg")).toHaveClass(
      "animate-spin",
      "motion-reduce:animate-none"
    )
    await user.click(pending)
    expect(fetchMock.mock.calls.filter(([p]) => p === PATH)).toHaveLength(1)
  })

  it("hides the confirmation after 4 seconds and never revives it on a failed resend", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      stubFetch(
        { status: 202 },
        {
          status: 429,
          body: { error: "rate_limited" },
          headers: { "Retry-After": "900" },
        }
      )
      await renderRoute("/verify-email", FROM_SIGNUP)
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      await user.click(screen.getByRole("button", { name: "Resend code" }))
      expect(await screen.findByText("Request received")).toBeInTheDocument()

      await tick(5)
      expect(screen.queryByText("Request received")).toBeNull()
      expect(screen.getByText(/Resend code in 0:5\d/)).toBeInTheDocument()

      await tick(56)
      await user.click(screen.getByRole("button", { name: "Resend code" }))
      expect(await screen.findByText(/Too many attempts/)).toBeInTheDocument()
      expect(screen.queryByText("Request received")).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("uses Rails' Retry-After as the resend countdown when rate limited", async () => {
    stubFetch({
      status: 429,
      body: { error: "rate_limited" },
      headers: { "Retry-After": "3600" },
    })
    await renderRoute("/verify-email", FROM_SIGNUP)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Resend code" }))

    expect(await screen.findByText(/Resend code in 60:00/)).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(
      "Too many attempts. Try again in 60 minutes."
    )
  })

  it("reports network failures and keeps the code for a retry", async () => {
    stubFetch(new TypeError("Failed to fetch"))
    await renderRoute("/verify-email", FROM_SIGNUP)
    const user = userEvent.setup()

    await user.type(codeInput(), "123456")
    await user.click(screen.getByRole("button", { name: "Verify Email" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server."
    )
    expect(codeInput()).toHaveValue("123456")
  })

  it("fetches a fresh CSRF token after a 403", async () => {
    const fetchMock = stubFetch(
      { status: 403, body: { error: "invalid_csrf_token" } },
      { status: 200, body: { email_verified: true } }
    )
    await renderRoute("/verify-email", FROM_SIGNUP)
    const user = userEvent.setup()

    await user.type(codeInput(), "123456")
    await user.click(screen.getByRole("button", { name: "Verify Email" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session expired."
    )

    await user.click(screen.getByRole("button", { name: "Verify Email" }))
    await screen.findByRole("heading", { name: "Email verified" })
    const tokens = callsTo(fetchMock, PATH, "PATCH").map(csrfHeader)
    expect(tokens).toEqual(["csrf-token-1", "csrf-token-2"])
  })

  it("offers signing up with a different email", async () => {
    await renderRoute("/verify-email", FROM_SIGNUP)
    expect(
      screen.getByRole("link", { name: "Use a different email" })
    ).toHaveAttribute("href", "/signup")
  })
})

describe("responsive layout", () => {
  it("keeps the brand panel for desktop and the logo for small screens", async () => {
    await renderRoute("/verify-email", FROM_SIGNUP)
    expect(document.querySelector("aside")).toHaveClass("hidden", "lg:flex")
    const logos = screen.getAllByRole("img")
    expect(logos.some((img) => img.closest(".lg\\:hidden"))).toBe(true)
  })
})
