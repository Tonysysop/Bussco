import { act, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { callsTo, csrfHeader, stubFetch } from "@/test/fetch"
import { renderRoute } from "@/test/render"

const PATH = "/api/v1/auth/password_resets"
const VERIFY = `${PATH}/verify`
// Long enough ago that the resend countdown has finished, unless a test says otherwise.
const FROM_REQUEST = { email: "ada@example.com", codeSentAt: 0 }
const INVALID = { status: 422, body: { error: "invalid_code" } }

const codeInput = () => screen.getByLabelText("Verification code")
const verifyButton = () => screen.getByRole("button", { name: /Verify Code/ })
const sentBody = (call: [string, RequestInit?]) =>
  JSON.parse(call[1]!.body as string)

async function enter(code = "123456") {
  const user = userEvent.setup()
  await user.type(codeInput(), code)
  await user.click(verifyButton())
  return user
}

describe("ResetCodePage", () => {
  it("verifies the code and replaces this step with new-password entry", async () => {
    const fetchMock = stubFetch({ status: 200, body: {} })
    const router = await renderRoute("/reset-code", FROM_REQUEST)

    await enter()

    expect(
      await screen.findByRole("heading", { name: "Create a new password" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/reset-password")
    expect(router.state.location.search).toBe("")
    expect(router.state.historyAction).toBe("REPLACE")
    const [call] = callsTo(fetchMock, VERIFY)
    expect(sentBody(call)).toEqual({ email: "ada@example.com", code: "123456" })
    expect(csrfHeader(call)).toBe("csrf-token-1")
  })

  it("accepts a pasted code and ignores non-digits", async () => {
    await renderRoute("/reset-code", FROM_REQUEST)
    const user = userEvent.setup()

    await user.click(codeInput())
    await user.paste("654321")
    expect(codeInput()).toHaveValue("654321")

    await user.clear(codeInput())
    await user.type(codeInput(), "1a2b")
    expect(codeInput()).toHaveValue("12")
  })

  it("rejects an incomplete code without calling the API", async () => {
    const fetchMock = stubFetch()
    await renderRoute("/reset-code", FROM_REQUEST)

    await enter("123")

    expect(screen.getByText("Enter the 6-digit code")).toBeInTheDocument()
    expect(callsTo(fetchMock, VERIFY)).toHaveLength(0)
  })

  it("explains an incorrect or expired code, clears it and refocuses", async () => {
    stubFetch(INVALID)
    const router = await renderRoute("/reset-code", FROM_REQUEST)

    await enter()

    expect(
      await screen.findByText(/That code is incorrect or has expired/)
    ).toBeInTheDocument()
    expect(codeInput()).toHaveValue("")
    expect(codeInput()).toHaveFocus()
    expect(codeInput()).toHaveAttribute("aria-describedby", "code-error")
    expect(router.state.location.pathname).toBe("/reset-code")
  })

  it("sends a direct visit, which has no email, back to the request step", async () => {
    const router = await renderRoute("/reset-code")
    expect(
      await screen.findByRole("heading", { name: "Forgot your password?" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/forgot-password")
  })

  it("counts down from the request before offering a resend", async () => {
    await renderRoute("/reset-code", {
      ...FROM_REQUEST,
      codeSentAt: Date.now(),
    })

    expect(screen.getByText(/Resend code in (1:00|0:59)/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Resend code" })).toBeNull()
  })

  it("resends to the same email with generic feedback and a new countdown", async () => {
    const fetchMock = stubFetch({ status: 202 })
    await renderRoute("/reset-code", FROM_REQUEST)

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Resend code" }))

    expect(await screen.findByText(/Resend code in 1:00/)).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(
      "Request received" + "If eligible, a new code will arrive shortly."
    )
    const [call] = callsTo(fetchMock, PATH)
    expect(sentBody(call)).toEqual({ email: "ada@example.com" })
  })

  it("resending clears a code error; submitting hides stale resend feedback", async () => {
    stubFetch(INVALID, { status: 202 }, INVALID)
    await renderRoute("/reset-code", FROM_REQUEST)

    const user = await enter()
    await screen.findByText(/That code is incorrect/)
    await user.click(screen.getByRole("button", { name: "Resend code" }))
    expect(await screen.findByText("Request received")).toBeInTheDocument()
    expect(screen.queryByText(/That code is incorrect/)).toBeNull()

    await user.type(codeInput(), "222222")
    await user.click(verifyButton())
    await screen.findByText(/That code is incorrect/)
    expect(screen.queryByText("Request received")).toBeNull()

    // An incomplete code resets the verify request; the old resend result must stay gone.
    await user.type(codeInput(), "123")
    await user.click(verifyButton())
    expect(screen.getByText("Enter the 6-digit code")).toBeInTheDocument()
    expect(screen.queryByText("Request received")).toBeNull()
  })

  it("uses Rails' Retry-After as the resend countdown when rate limited", async () => {
    stubFetch({
      status: 429,
      body: { error: "rate_limited" },
      headers: { "Retry-After": "3600" },
    })
    await renderRoute("/reset-code", FROM_REQUEST)

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Resend code" }))

    expect(await screen.findByText(/Resend code in 60:00/)).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(
      "Too many attempts. Try again in 60 minutes."
    )
  })

  it("shows rate limits and network failures on verify, keeping the code", async () => {
    stubFetch(
      {
        status: 429,
        body: { error: "rate_limited" },
        headers: { "Retry-After": "900" },
      },
      new TypeError("Failed to fetch")
    )
    await renderRoute("/reset-code", FROM_REQUEST)

    const user = await enter()
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Try again in 15 minutes."
    )
    expect(codeInput()).toHaveValue("123456")

    await user.click(verifyButton())
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server."
    )
  })

  it("fetches a fresh CSRF token after a 403", async () => {
    const fetchMock = stubFetch(
      { status: 403, body: { error: "invalid_csrf_token" } },
      { status: 200, body: {} }
    )
    await renderRoute("/reset-code", FROM_REQUEST)

    const user = await enter()
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session expired. Please try again."
    )
    await user.click(verifyButton())

    await screen.findByRole("heading", { name: "Create a new password" })
    expect(callsTo(fetchMock, VERIFY).map(csrfHeader)).toEqual([
      "csrf-token-1",
      "csrf-token-2",
    ])
  })

  it("shows a loading button and sends one request however often it is submitted", async () => {
    const fetchMock = stubFetch({ status: 200, body: {} })
    const reply = fetchMock.getMockImplementation()!
    let release!: () => void
    fetchMock.mockImplementation(async (path, init) => {
      if (path === VERIFY) await new Promise<void>((r) => (release = r))
      return reply(path, init)
    })
    await renderRoute("/reset-code", FROM_REQUEST)

    const user = await enter()
    const pending = screen.getByRole("button", { name: "Verifying…" })
    expect(pending).toBeDisabled()
    await user.keyboard("{Enter}")
    await user.dblClick(pending)

    await act(async () => release())
    await screen.findByRole("heading", { name: "Create a new password" })
    expect(callsTo(fetchMock, VERIFY)).toHaveLength(1)
  })

  it("offers a different email and a way back to sign in", async () => {
    await renderRoute("/reset-code", FROM_REQUEST)
    expect(
      screen.getByRole("link", { name: "Use a different email" })
    ).toHaveAttribute("href", "/forgot-password")
    expect(
      screen.getByRole("link", { name: "Back to Sign In" })
    ).toHaveAttribute("href", "/login")
  })
})
