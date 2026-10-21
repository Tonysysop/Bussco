import { render, screen } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { describe, expect, it } from "vitest"

import { routes } from "@/routes"

function renderAt(state?: unknown) {
  const router = createMemoryRouter(routes, {
    initialEntries: [{ pathname: "/verify-email", state }],
  })
  render(<RouterProvider router={router} />)
}

describe("VerifyEmailPage", () => {
  it("confirms the account and names the email it was registered with", () => {
    renderAt({ email: "ada@example.com" })
    expect(
      screen.getByRole("heading", { name: "Account created" })
    ).toBeInTheDocument()
    expect(screen.getByText("ada@example.com")).toBeInTheDocument()
    expect(screen.getByText(/next step/)).toBeInTheDocument()
  })

  it("still makes sense on a direct visit, and has no form or links", () => {
    renderAt()
    expect(screen.getByText(/your email address/)).toBeInTheDocument()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(document.querySelector("a")).toBeNull()
  })
})
