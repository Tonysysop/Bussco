import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { callsTo, stubFetch } from "@/test/fetch"
import { renderRoute } from "@/test/render"

describe("ApplyPage", () => {
  it("greets the user /me returns", async () => {
    stubFetch({ status: 200, body: { user: { full_name: "Ada Obi" } } })
    await renderRoute("/apply")
    expect(
      await screen.findByRole("heading", { name: "Welcome, Ada Obi" })
    ).toBeInTheDocument()
  })

  it("asks to sign in on a 401, whatever router state claims", async () => {
    const fetchMock = stubFetch({
      status: 401,
      body: { error: "unauthenticated" },
    })
    await renderRoute("/apply", { user: { full_name: "Mallory" } })
    expect(
      await screen.findByRole("heading", { name: "Sign in to continue" })
    ).toBeInTheDocument()
    expect(screen.queryByText(/Mallory/)).not.toBeInTheDocument()
    expect(callsTo(fetchMock, "/api/v1/auth/me", "GET")).toHaveLength(1)
  })

  it("reports a network failure and retries on request", async () => {
    stubFetch(new TypeError("Failed to fetch"), {
      status: 200,
      body: { user: { full_name: "Ada Obi" } },
    })
    await renderRoute("/apply")
    const user = userEvent.setup()

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server."
    )
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(
      await screen.findByRole("heading", { name: "Welcome, Ada Obi" })
    ).toBeInTheDocument()
  })
})
