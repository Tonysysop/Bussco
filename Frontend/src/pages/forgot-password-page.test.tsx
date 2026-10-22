import { act, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { callsTo, csrfHeader, stubFetch } from "@/test/fetch"
import { renderRoute } from "@/test/render"

const PATH = "/api/v1/auth/password_resets"

const emailInput = () => screen.getByLabelText("Work Email Address")
const sendButton = () => screen.getByRole("button", { name: /Send Reset Code/ })

async function submit(email = " Ada@Example.com ") {
  const user = userEvent.setup()
  if (email) await user.type(emailInput(), email)
  await user.click(sendButton())
  return user
}

describe("ForgotPasswordPage", () => {
  it("requests a code for the normalized email and opens code entry", async () => {
    const fetchMock = stubFetch({ status: 202 })
    const router = await renderRoute("/forgot-password")

    await submit()

    expect(
      await screen.findByRole("heading", { name: "Verify your identity" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/reset-code")
    expect(router.state.location.search).toBe("")
    expect(screen.getByText("ada@example.com")).toBeInTheDocument()
    const [call] = callsTo(fetchMock, PATH)
    expect(JSON.parse(call[1]!.body as string)).toEqual({
      email: "ada@example.com",
    })
    expect(csrfHeader(call)).toBe("csrf-token-1")
  })

  it("words the next screen the same whether or not the account exists", async () => {
    // Rails sends the identical empty 202 for unknown, disabled and cooling-down addresses.
    stubFetch({ status: 202 })
    await renderRoute("/forgot-password")
    await submit("nobody@example.com")

    expect(
      await screen.findByText(/If an account exists for/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/not found|no account|sent to/i)).toBeNull()
  })

  it("shows Zod errors and sends nothing for a blank or invalid email", async () => {
    const fetchMock = stubFetch()
    await renderRoute("/forgot-password")

    const user = await submit("")
    expect(screen.getByText("Email can't be blank")).toBeInTheDocument()
    expect(emailInput()).toHaveAttribute("aria-invalid", "true")
    expect(emailInput()).toHaveAttribute(
      "aria-describedby",
      "email-error email-hint"
    )

    await user.type(emailInput(), "nope")
    expect(screen.queryByText("Email can't be blank")).toBeNull()
    await user.click(sendButton())
    expect(screen.getByText("Email is invalid")).toBeInTheDocument()
    expect(callsTo(fetchMock, PATH)).toHaveLength(0)
  })

  it.each([
    [
      {
        status: 429,
        body: { error: "rate_limited" },
        headers: { "Retry-After": "3600" },
      },
      "Too many attempts. Try again in 60 minutes.",
    ],
    [
      new TypeError("Failed to fetch"),
      "We couldn't reach the server. Check your connection and try again.",
    ],
    [{ status: 500 }, "Something went wrong on our side. Please try again."],
    [
      { status: 403, body: { error: "invalid_csrf_token" } },
      "Your session expired. Please try again.",
    ],
  ])(
    "shows an alert for API failures (%#) and keeps the form usable",
    async (reply, message) => {
      stubFetch(reply)
      const router = await renderRoute("/forgot-password")

      await submit()

      expect(await screen.findByRole("alert")).toHaveTextContent(message)
      expect(router.state.location.pathname).toBe("/forgot-password")
      expect(sendButton()).toBeEnabled()
      expect(emailInput()).toHaveValue("Ada@Example.com")
    }
  )

  it("shows a loading button and sends one request however often it is submitted", async () => {
    const fetchMock = stubFetch({ status: 202 })
    const reply = fetchMock.getMockImplementation()!
    let release!: () => void
    fetchMock.mockImplementation(async (path, init) => {
      if (path === PATH) await new Promise<void>((r) => (release = r))
      return reply(path, init)
    })
    await renderRoute("/forgot-password")

    const user = await submit()
    const pending = screen.getByRole("button", { name: "Sending…" })
    expect(pending).toBeDisabled()
    await user.keyboard("{Enter}")
    await user.dblClick(pending)

    await act(async () => release())
    await screen.findByRole("heading", { name: "Verify your identity" })
    expect(callsTo(fetchMock, PATH)).toHaveLength(1)
  })

  it("links back to sign in, which links here", async () => {
    stubFetch({ status: 401, body: { error: "unauthenticated" } })
    await renderRoute("/forgot-password")
    await userEvent
      .setup()
      .click(screen.getByRole("link", { name: "Back to Sign In" }))

    await screen.findByRole("heading", { name: "Welcome back" })
    await userEvent
      .setup()
      .click(screen.getByRole("link", { name: "Forgot password?" }))
    expect(
      await screen.findByRole("heading", { name: "Forgot your password?" })
    ).toBeInTheDocument()
  })

  it("keeps the brand panel for desktop and the logo for small screens", async () => {
    stubFetch()
    await renderRoute("/forgot-password")
    expect(document.querySelector("aside")).toHaveClass("hidden", "lg:flex")
    expect(
      screen.getByText(/Recover access to your cooperative/)
    ).toBeInTheDocument()
    const logos = screen.getAllByRole("img")
    expect(logos.some((img) => img.closest(".lg\\:hidden"))).toBe(true)
  })
})
