import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { callsTo, csrfHeader, json, stubFetch } from "@/test/fetch"
import { renderRoute } from "@/test/render"

const TOKEN = "csrf-token-1"
const FILLED = {
  full_name: "  Ada Obi ",
  email: " Ada@Example.com",
  password: "correct horse battery",
}

const SIGNED_OUT = { status: 401, body: { error: "unauthenticated" } }

// The form appears once /me says nobody is signed in.
async function renderSignup() {
  const router = await renderRoute("/signup")
  await screen.findByRole("heading", { name: "Create your account" })
  return router
}

const registrationCalls = (fetchMock: ReturnType<typeof stubFetch>) =>
  callsTo(fetchMock, "/api/v1/auth/registrations")

async function fillAndSubmit(values: Partial<typeof FILLED> = {}) {
  const user = userEvent.setup()
  const { full_name, email, password } = { ...FILLED, ...values }
  if (full_name) await user.type(screen.getByLabelText(/Full Name/), full_name)
  if (email) await user.type(screen.getByLabelText(/Work Email Address/), email)
  if (password)
    await user.type(
      screen.getByLabelText(/^Password/, { selector: "input" }),
      password
    )
  await user.click(screen.getByRole("button", { name: /Create Account/ }))
  return user
}

const submitButton = () =>
  screen.getByRole("button", { name: /Create Account|Creating account/ })

describe("SignupPage", () => {
  it("registers with the CSRF token and normalized values, then shows the verify-email page", async () => {
    let finish!: (response: Response) => void
    const fetchMock = stubFetch(SIGNED_OUT)
    fetchMock.mockImplementation(async (path: string) =>
      path === "/api/v1/auth/me"
        ? json(SIGNED_OUT)
        : path === "/api/v1/csrf"
          ? json({ status: 200, body: { csrf_token: TOKEN } })
          : new Promise<Response>((resolve) => (finish = resolve))
    )
    const router = await renderSignup()

    await fillAndSubmit()

    await waitFor(() =>
      expect(submitButton()).toHaveTextContent("Creating account…")
    )
    expect(submitButton()).toBeDisabled()
    expect(fetchMock.mock.calls.map(([p]) => p)).toEqual([
      "/api/v1/auth/me",
      "/api/v1/csrf",
      "/api/v1/auth/registrations",
    ])
    const [path, init] = fetchMock.mock.calls[2] as [string, RequestInit]
    expect(path).toBe("/api/v1/auth/registrations")
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": TOKEN,
      },
    })
    expect(JSON.parse(init.body as string)).toEqual({
      user: {
        full_name: "Ada Obi",
        email: "ada@example.com",
        password: "correct horse battery",
      },
    })

    finish(json({ status: 201, body: { user: { email: "ada@example.com" } } }))

    expect(
      await screen.findByRole("heading", { name: "Verify your email" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/verify-email")
    expect(router.state.location.state).toEqual({
      email: "ada@example.com",
      codeSentAt: expect.any(Number),
    })
    expect(JSON.stringify(router.state.location.state)).not.toContain(
      FILLED.password
    )
  })

  it("shows Zod errors under each field and sends nothing", async () => {
    const fetchMock = stubFetch(SIGNED_OUT)
    await renderSignup()

    await fillAndSubmit({ full_name: "", email: "nope", password: "short" })

    expect(screen.getByText("Full name can't be blank")).toBeInTheDocument()
    expect(screen.getByText("Email is invalid")).toBeInTheDocument()
    expect(
      screen.getByText("Password is too short (minimum is 12 characters)")
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/Full Name/)).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    // Only the session check: no CSRF token, no registration.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(registrationCalls(fetchMock)).toHaveLength(0)
  })

  it("re-checks an errored field as the user types and clears it once valid", async () => {
    stubFetch(SIGNED_OUT)
    await renderSignup()

    const user = await fillAndSubmit({ full_name: "", email: "nope" })
    const email = screen.getByLabelText(/Work Email Address/)
    expect(email).toHaveAccessibleDescription(/Email is invalid/)

    await user.type(email, "@example.com")
    expect(screen.queryByText("Email is invalid")).not.toBeInTheDocument()
    expect(email).not.toHaveAttribute("aria-invalid")
    expect(screen.getByText("Full name can't be blank")).toBeInTheDocument()

    await user.type(screen.getByLabelText(/Full Name/), "Ada")
    expect(
      screen.queryByText("Full name can't be blank")
    ).not.toBeInTheDocument()
  })

  it("clears a Rails error once its field is edited", async () => {
    stubFetch(SIGNED_OUT, {
      status: 422,
      body: { errors: { email: ["has already been taken"] } },
    })
    await renderSignup()

    const user = await fillAndSubmit()
    await screen.findByText("Email has already been taken")
    await user.type(screen.getByLabelText(/Work Email Address/), "m")

    expect(
      screen.queryByText("Email has already been taken")
    ).not.toBeInTheDocument()
  })

  it("updates the password indicator with the same rules", async () => {
    stubFetch(SIGNED_OUT)
    await renderSignup()
    const user = userEvent.setup()
    const chip = () =>
      screen.getByText("At least 12 characters").closest("[data-met]")!

    await user.type(
      screen.getByLabelText(/^Password/, { selector: "input" }),
      "x".repeat(11)
    )
    expect(chip()).toHaveAttribute("data-met", "false")
    await user.type(
      screen.getByLabelText(/^Password/, { selector: "input" }),
      "x"
    )
    expect(chip()).toHaveAttribute("data-met", "true")
    expect(screen.queryByText("At most 72 bytes")).not.toBeInTheDocument()

    await user.type(
      screen.getByLabelText(/^Password/, { selector: "input" }),
      "€".repeat(21)
    )
    expect(
      screen.getByText("At most 72 bytes").closest("[data-met]")
    ).toHaveAttribute("data-met", "false")
  })

  it("shows Rails validation errors under their fields as Rails' full messages", async () => {
    stubFetch(SIGNED_OUT, {
      status: 422,
      body: {
        errors: {
          full_name: ["is too long (maximum is 120 characters)"],
          email: ["is invalid"],
          password: ["is too long", "is too short (minimum is 12 characters)"],
          base: ["Something else is wrong"],
        },
      },
    })
    await renderSignup()

    await fillAndSubmit()

    expect(
      await screen.findByText(
        "Full name is too long (maximum is 120 characters)"
      )
    ).toBeInTheDocument()
    expect(screen.getByText("Email is invalid")).toBeInTheDocument()
    expect(screen.getByText("Password is too long")).toBeInTheDocument()
    expect(
      screen.getByText("Password is too short (minimum is 12 characters)")
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText(/^Password/, { selector: "input" })
    ).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText("Something else is wrong")).toBeInTheDocument()
    expect(submitButton()).toBeEnabled()
  })

  it("shows a duplicate email under the email field and keeps the other values", async () => {
    stubFetch(SIGNED_OUT, {
      status: 422,
      body: { errors: { email: ["has already been taken"] } },
    })
    await renderSignup()

    await fillAndSubmit()

    expect(
      await screen.findByText("Email has already been taken")
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/Full Name/)).toHaveValue(FILLED.full_name)
    expect(screen.getByLabelText(/Full Name/)).not.toHaveAttribute(
      "aria-invalid"
    )
  })

  it("on a CSRF rejection, says so and fetches a new token for the next attempt", async () => {
    const fetchMock = stubFetch(
      SIGNED_OUT,
      { status: 403, body: { error: "invalid_csrf_token" } },
      { status: 201, body: { user: { email: "ada@example.com" } } }
    )
    await renderSignup()

    const user = await fillAndSubmit()
    expect(
      await screen.findByText("Your session expired. Please try again.")
    ).toBeInTheDocument()

    await user.click(submitButton())
    expect(
      await screen.findByRole("heading", { name: "Verify your email" })
    ).toBeInTheDocument()
    const tokens = registrationCalls(fetchMock).map(csrfHeader)
    expect(tokens).toEqual(["csrf-token-1", "csrf-token-2"])
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
    "shows an alert for API failures (%#) and lets the user retry",
    async (reply, message) => {
      stubFetch(SIGNED_OUT, reply)
      await renderSignup()

      await fillAndSubmit()

      expect(await screen.findByRole("alert")).toHaveTextContent(message)
      expect(submitButton()).toBeEnabled()
      expect(screen.getByLabelText(/Work Email Address/)).toHaveValue(
        FILLED.email.trim()
      ) // type="email" inputs strip whitespace
    }
  )

  it("sends a signed-in member to /apply instead of showing the form", async () => {
    const signedIn = {
      status: 200,
      body: { user: { id: 1, full_name: "Ada Obi", email: "ada@example.com" } },
    }
    const fetchMock = stubFetch(signedIn, signedIn)
    const router = await renderRoute("/signup")

    expect(
      await screen.findByRole("heading", { name: "Welcome, Ada Obi" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/apply")
    expect(registrationCalls(fetchMock)).toHaveLength(0)
  })

  it("shows a status, not the form, while checking the session", async () => {
    stubFetch(SIGNED_OUT)
    await renderRoute("/signup")

    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking your sign-in…"
    )
    expect(screen.queryByLabelText(/Full Name/)).toBeNull()
    expect(
      await screen.findByRole("heading", { name: "Create your account" })
    ).toBeInTheDocument()
  })

  it("offers a retry instead of the form when the session check fails", async () => {
    stubFetch({ status: 500 }, SIGNED_OUT)
    await renderRoute("/signup")

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong on our side."
    )
    expect(screen.queryByLabelText(/Full Name/)).toBeNull()
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }))
    expect(
      await screen.findByRole("heading", { name: "Create your account" })
    ).toBeInTheDocument()
  })

  it("links only to sign in, not to pages that don't exist", async () => {
    stubFetch(SIGNED_OUT)
    await renderSignup()
    expect(screen.getByText(/Terms of Service/)).toBeInTheDocument()
    const links = [...document.querySelectorAll("a")]
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/login"])
  })
})
