import { act, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { callsTo, csrfHeader, stubFetch } from "@/test/fetch"
import { renderRoute } from "@/test/render"

// /apply also loads the application; a 404 is "not started", which shows the start screen.
const NOT_STARTED = {
  path: "/api/v1/membership/application",
  status: 404,
  body: { error: "not_found" },
}
const APPLY_HEADING = "Complete your membership application"

const PATH = "/api/v1/auth/password_resets"
const SESSION = "/api/v1/auth/session"
const PASSWORD = "correct horse battery"
const USER = {
  id: 1,
  full_name: "Ada Obi",
  email: "ada@example.com",
  email_verified: true,
  account_status: "active",
  membership_status: "not_started",
}
const RESET = { status: 200, body: { csrf_token: "rotated" } }
const EXPIRED = { status: 422, body: { error: "invalid_reset_token" } }

const passwordInput = () => screen.getByLabelText("New Password")
const confirmationInput = () => screen.getByLabelText("Confirm New Password")
const resetButton = () => screen.getByRole("button", { name: /Reset Password/ })

async function submit(password = PASSWORD, confirmation = password) {
  const user = userEvent.setup()
  if (password) await user.type(passwordInput(), password)
  if (confirmation) await user.type(confirmationInput(), confirmation)
  await user.click(resetButton())
  return user
}

describe("ResetPasswordPage", () => {
  it("sends only the new password and confirms without signing in", async () => {
    const fetchMock = stubFetch(RESET)
    await renderRoute("/reset-password")

    await submit()

    expect(
      await screen.findByRole("heading", { name: "Password updated" })
    ).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(
      /signed out on every device/
    )
    const [call] = callsTo(fetchMock, PATH, "PATCH")
    expect(JSON.parse(call[1]!.body as string)).toEqual({ password: PASSWORD })
    expect(csrfHeader(call)).toBe("csrf-token-1")
    expect(screen.getByRole("link", { name: /Go to Sign In/ })).toHaveAttribute(
      "href",
      "/login"
    )
    expect(callsTo(fetchMock, SESSION)).toHaveLength(0)
  })

  it("forgets a signed-in user, so sign in shows the form and uses the rotated CSRF token", async () => {
    const fetchMock = stubFetch(
      NOT_STARTED,
      NOT_STARTED,
      { status: 200, body: { user: USER } },
      RESET,
      { status: 401, body: { error: "unauthenticated" } },
      { status: 201, body: { user: USER, csrf_token: "after-login" } }
    )
    const router = await renderRoute("/apply")
    await screen.findByRole("heading", { name: APPLY_HEADING })
    const visited: string[] = []
    router.subscribe((state) => visited.push(state.location.pathname))

    await act(() => router.navigate("/reset-password"))
    const user = await submit()
    await user.click(await screen.findByRole("link", { name: /Go to Sign In/ }))

    expect(
      await screen.findByRole("heading", { name: "Welcome back" })
    ).toBeInTheDocument()
    expect(visited).not.toContain("/apply")
    await user.type(screen.getByLabelText("Work Email Address"), USER.email)
    await user.type(screen.getByLabelText("Password"), PASSWORD)
    // The reset also dropped the cached application: /apply must load it again from Rails.
    const seen: string[] = []
    const observer = new MutationObserver(() =>
      seen.push(document.body.textContent ?? "")
    )
    observer.observe(document.body, { childList: true, subtree: true })
    await user.click(screen.getByRole("button", { name: /Sign In/ }))
    await screen.findByRole("heading", { name: APPLY_HEADING })
    observer.disconnect()
    expect(
      seen.some((text) => text.includes("Loading your application…"))
    ).toBe(true)
    const [login] = callsTo(fetchMock, SESSION)
    expect(csrfHeader(login)).toBe("rotated")
  })

  describe("live confirmation feedback", () => {
    const hint = () => document.getElementById("confirmation-hint")!

    it("is linked to the confirmation and announced politely", async () => {
      await renderRoute("/reset-password")
      expect(confirmationInput()).toHaveAttribute(
        "aria-describedby",
        "confirmation-hint"
      )
      expect(hint()).toHaveAttribute("aria-live", "polite")
      expect(hint()).toBeEmptyDOMElement()
    })

    it("confirms a match immediately, even mid-edit", async () => {
      await renderRoute("/reset-password")
      const user = userEvent.setup()
      await user.type(passwordInput(), PASSWORD)

      await user.type(confirmationInput(), PASSWORD.slice(0, -1))
      expect(confirmationInput()).toHaveFocus()
      expect(hint()).toBeEmptyDOMElement()
      await user.type(confirmationInput(), PASSWORD.slice(-1))
      expect(confirmationInput()).toHaveFocus()
      expect(hint()).toHaveTextContent("Passwords match")
    })

    it("flags a mismatch on leaving, hides it while correcting, and flags it again on leaving", async () => {
      await renderRoute("/reset-password")
      const user = userEvent.setup()
      await user.type(passwordInput(), PASSWORD)

      // Even a wrong character is not flagged while typing.
      await user.type(confirmationInput(), "correct horsx")
      expect(hint()).toBeEmptyDOMElement()

      // Mismatch after blur.
      await user.tab()
      expect(hint()).toHaveTextContent("Passwords don't match")

      // Returning to edit an incorrect confirmation hides the warning.
      await user.click(confirmationInput())
      expect(hint()).toBeEmptyDOMElement()

      // Still hidden during the correction.
      await user.keyboard("{Backspace}")
      await user.type(confirmationInput(), "e batter")
      expect(hint()).toBeEmptyDOMElement()

      // Leaving again while still wrong flags it again.
      await user.tab()
      expect(hint()).toHaveTextContent("Passwords don't match")

      // Finishing the correction confirms the match at once.
      await user.type(confirmationInput(), "y")
      expect(hint()).toHaveTextContent("Passwords match")
    })

    it("updates when the password changes after a match", async () => {
      await renderRoute("/reset-password")
      const user = userEvent.setup()
      await user.type(passwordInput(), PASSWORD)
      await user.type(confirmationInput(), PASSWORD)
      expect(hint()).toHaveTextContent("Passwords match")

      await user.type(passwordInput(), "!")
      expect(hint()).toHaveTextContent("Passwords don't match")
    })

    it("hands over to the submit-time error without repeating it", async () => {
      const fetchMock = stubFetch()
      await renderRoute("/reset-password")
      const user = userEvent.setup()
      await user.type(passwordInput(), PASSWORD)
      await user.type(confirmationInput(), "correct horse")
      await user.tab()
      expect(hint()).toHaveTextContent("Passwords don't match")

      await user.click(resetButton())
      expect(screen.getAllByText("Passwords don't match")).toHaveLength(1)
      expect(hint()).toBeEmptyDOMElement()
      expect(confirmationInput()).toHaveAttribute("aria-invalid", "true")
      expect(confirmationInput()).toHaveAttribute(
        "aria-describedby",
        "confirmation-error confirmation-hint"
      )
      expect(callsTo(fetchMock, PATH, "PATCH")).toHaveLength(0)

      // Editing clears the submit error; the live rules take over again.
      await user.type(confirmationInput(), " battery")
      expect(screen.queryByText("Passwords don't match")).toBeNull()
      expect(hint()).toHaveTextContent("Passwords match")
    })
  })

  it("requires matching passwords and Rails' length rules before sending", async () => {
    const fetchMock = stubFetch()
    await renderRoute("/reset-password")

    const user = await submit("short", "")
    expect(
      screen.getByText("Password is too short (minimum is 12 characters)")
    ).toBeInTheDocument()
    expect(passwordInput()).toHaveAttribute("aria-invalid", "true")
    expect(passwordInput()).toHaveAttribute(
      "aria-describedby",
      "password-error password-hint"
    )

    await user.clear(passwordInput())
    await user.type(passwordInput(), PASSWORD)
    await user.type(confirmationInput(), `${PASSWORD}!`)
    await user.click(resetButton())
    expect(screen.getByText("Passwords don't match")).toBeInTheDocument()
    expect(confirmationInput()).toHaveAttribute(
      "aria-describedby",
      "confirmation-error confirmation-hint"
    )

    // 25 three-byte characters: 25 characters but 75 bytes, over bcrypt's 72.
    const long = "€".repeat(25)
    await user.clear(passwordInput())
    await user.clear(confirmationInput())
    await user.click(passwordInput())
    await user.paste(long)
    await user.click(confirmationInput())
    await user.paste(long)
    expect(screen.getByText(/At most 72 bytes/)).toBeInTheDocument()
    await user.click(resetButton())
    expect(
      screen.getByText("Password is too long (maximum is 72 bytes)")
    ).toBeInTheDocument()
    expect(callsTo(fetchMock, PATH, "PATCH")).toHaveLength(0)
  })

  // Rails gives one answer for no verified code (a direct visit) and for an expired, used or
  // superseded authorization; router state never stands in for it.
  it("explains an invalid reset session and offers a new code", async () => {
    stubFetch(EXPIRED)
    await renderRoute("/reset-password")

    await submit()

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your password reset session has expired or is no longer valid." +
        "Request a new verification code to reset your password."
    )
    expect(
      screen.getByRole("link", { name: /Request New Code/ })
    ).toHaveAttribute("href", "/forgot-password")
    expect(
      screen.getByRole("heading", { name: /reset session has expired/ })
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("New Password")).toBeNull()
  })

  it("shows Rails' password errors and lets the user try again", async () => {
    const fetchMock = stubFetch(
      {
        status: 422,
        body: {
          errors: { password: ["is too short (minimum is 12 characters)"] },
        },
      },
      RESET
    )
    await renderRoute("/reset-password")

    const user = await submit()
    expect(
      await screen.findByText(
        "Password is too short (minimum is 12 characters)"
      )
    ).toBeInTheDocument()
    expect(passwordInput()).toHaveValue(PASSWORD)

    await user.click(resetButton())
    await screen.findByRole("heading", { name: "Password updated" })
    expect(callsTo(fetchMock, PATH, "PATCH")).toHaveLength(2)
  })

  it.each([
    [{ status: 500 }, "Something went wrong on our side. Please try again."],
    // A 422 the page has no field for must still say something.
    [
      { status: 422, body: { errors: { full_name: ["is too long"] } } },
      "Something went wrong on our side. Please try again.",
    ],
    [
      new TypeError("Failed to fetch"),
      "We couldn't reach the server. Check your connection and try again.",
    ],
    [
      { status: 403, body: { error: "invalid_csrf_token" } },
      "Your session expired. Please try again.",
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
      stubFetch(reply)
      await renderRoute("/reset-password")

      await submit()

      expect(await screen.findByRole("alert")).toHaveTextContent(message)
      expect(resetButton()).toBeEnabled()
      expect(passwordInput()).toHaveValue(PASSWORD)
    }
  )

  it("shows a loading button and sends one request however often it is submitted", async () => {
    const fetchMock = stubFetch(RESET)
    const reply = fetchMock.getMockImplementation()!
    let release!: () => void
    fetchMock.mockImplementation(async (path, init) => {
      if (path === PATH) await new Promise<void>((r) => (release = r))
      return reply(path, init)
    })
    await renderRoute("/reset-password")

    const user = await submit()
    const pending = screen.getByRole("button", { name: "Resetting password…" })
    expect(pending).toBeDisabled()
    await user.keyboard("{Enter}")
    await user.dblClick(pending)

    await act(async () => release())
    await screen.findByRole("heading", { name: "Password updated" })
    expect(callsTo(fetchMock, PATH, "PATCH")).toHaveLength(1)
  })

  it("toggles each password's visibility with its own accessible button", async () => {
    await renderRoute("/reset-password")
    const toggle = screen.getByRole("button", { name: "Show new password" })

    expect(passwordInput()).toHaveAttribute("autocomplete", "new-password")
    expect(confirmationInput()).toHaveAttribute("autocomplete", "new-password")
    await userEvent.setup().click(toggle)
    expect(passwordInput()).toHaveAttribute("type", "text")
    expect(confirmationInput()).toHaveAttribute("type", "password")
    expect(toggle).toHaveAttribute("aria-pressed", "true")
    expect(toggle).toHaveAccessibleName("Hide new password")
    expect(
      screen.getByRole("button", { name: "Show confirm new password" })
    ).toBeInTheDocument()
  })
})
