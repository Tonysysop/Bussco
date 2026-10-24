import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { json, stubFetch } from "@/test/fetch"
import { renderRoute } from "@/test/render"

const ADMIN_ME = "/api/v1/admin/auth/me"
const SUPER_ME = {
  path: ADMIN_ME,
  status: 200,
  body: {
    user: {
      id: 1,
      full_name: "Adaeze Okafor",
      email: "root@example.com",
      admin_role: "super_admin",
      must_change_password: false,
    },
  },
}
const COUNTS = {
  all: 3,
  not_started: 1,
  in_progress: 1,
  awaiting_approval: 1,
  disabled: 1,
}
const ADA = {
  id: 11,
  full_name: "Ada Fresh",
  email: "ada@example.com",
  email_verified: false,
  account_status: "disabled",
  admin_role: null,
  stage: "not_started",
  photo: false,
  registered_at: "2026-10-20T09:00:00Z",
  application: null,
}
const BOLA = {
  id: 12,
  full_name: "Bola Draft",
  email: "bola@example.com",
  email_verified: true,
  account_status: "active",
  admin_role: null,
  stage: "in_progress",
  photo: true,
  registered_at: "2026-10-21T09:00:00Z",
  application: {
    sap_staff_id: "BUA-100",
    business_unit: "Cement",
    department: "Finance",
    office_location: "Lagos",
    started_at: "2026-10-22T09:00:00Z",
    submitted_at: null,
  },
}
const CHI = {
  ...BOLA,
  id: 13,
  full_name: "Chi Waiting",
  email: "chi@example.com",
  admin_role: "president",
  stage: "awaiting_approval",
  application: {
    ...BOLA.application,
    sap_staff_id: "BUA-200",
    submitted_at: "2026-10-23T09:00:00Z",
  },
}
const page = (members: unknown[], extra = {}) => ({
  members,
  counts: COUNTS,
  page: 1,
  per_page: 25,
  total: members.length,
  ...extra,
})

// Answers /admin/auth/me and every members request, recording the query each one asked for.
function stubMembers(reply: (params: URLSearchParams) => unknown) {
  const fetchMock = stubFetch(SUPER_ME)
  const base = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (path, init) => {
    if (path.startsWith("/api/v1/admin/members?")) {
      const body = reply(new URL(path, "http://x").searchParams)
      return body instanceof Response ? body : json({ status: 200, body })
    }
    if (path === ADMIN_ME) return json(SUPER_ME)
    return base(path, init)
  })
  const asked = () =>
    fetchMock.mock.calls
      .map(([path]) => path)
      .filter((path) => path.startsWith("/api/v1/admin/members?"))
      .map((path) => Object.fromEntries(new URL(path, "http://x").searchParams))
  return asked
}

afterEach(() => vi.restoreAllMocks())

describe("AdminMembersPage", () => {
  it("lists registrations with stage, account and email badges, marking draft details as such", async () => {
    stubMembers(() => page([ADA, BOLA, CHI]))
    await renderRoute("/admin/members")

    await screen.findByRole("heading", { level: 1, name: "Members" })
    await screen.findByText("Ada Fresh")
    const rows = screen.getAllByRole("row")
    const ada = rows.find((r) => r.textContent?.includes("Ada Fresh"))!
    expect(ada).toHaveTextContent("Not started")
    expect(ada).toHaveTextContent("Account disabled")
    expect(ada).toHaveTextContent("Email not verified")
    const bola = rows.find((r) => r.textContent?.includes("Bola Draft"))!
    expect(bola).toHaveTextContent("Application in progress")
    expect(within(bola).getAllByText("Draft")).toHaveLength(2)
    const chi = rows.find((r) => r.textContent?.includes("Chi Waiting"))!
    expect(chi).toHaveTextContent("Awaiting approval")
    expect(chi).toHaveTextContent("President")
    expect(within(chi).queryByText("Draft")).not.toBeInTheDocument()
    // A passport photo replaces the initials; without one the initials stay.
    expect(bola.querySelector("img")).toHaveAttribute(
      "src",
      "/api/v1/admin/members/12/photo"
    )
    expect(ada.querySelector("img")).toBeNull()
    expect(ada).toHaveTextContent("AF")
    expect(
      screen.getByRole("tab", { name: /Awaiting approval\s*1/ })
    ).toBeInTheDocument()
    expect(screen.getByText("Showing 1–3 of 3")).toBeInTheDocument()
    expect(
      screen.queryByText(/savings|loan|export|add member/i)
    ).not.toBeInTheDocument()
  })

  it("debounces search, and every filter change returns to page 1", async () => {
    const asked = stubMembers((params) =>
      page([BOLA], { page: Number(params.get("page")), total: 60 })
    )
    await renderRoute("/admin/members")
    const user = userEvent.setup()
    await screen.findByText("Showing 1–1 of 60")

    await user.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText("Page 2 of 3")
    await user.type(
      screen.getByLabelText("Search by name, email or staff ID"),
      "bua"
    )
    await waitFor(() => expect(asked().at(-1)).toEqual({ page: "1", q: "bua" }))
    expect(asked().filter((a) => a.q)).toHaveLength(1) // one request for three keystrokes

    await user.click(screen.getByRole("tab", { name: /Awaiting approval/ }))
    await user.selectOptions(screen.getByLabelText("Role"), "president")
    await waitFor(() =>
      expect(asked().at(-1)).toEqual({
        page: "1",
        q: "bua",
        stage: "awaiting_approval",
        role: "president",
      })
    )
    expect(
      screen.getByRole("tab", { name: /Awaiting approval/ })
    ).toHaveAttribute("aria-selected", "true")
  })

  it("opens read-only details, saying draft details are self-reported", async () => {
    stubMembers(() => page([BOLA]))
    await renderRoute("/admin/members")
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole("button", { name: "View details for Bola Draft" })
    )
    const dialog = await screen.findByRole("dialog", { name: "Bola Draft" })
    expect(dialog).toHaveTextContent("Draft: the applicant hasn't submitted it")
    expect(dialog).toHaveTextContent("BUA-100")
    expect(dialog).toHaveTextContent("Not yet")
    expect(
      within(dialog).getByRole("img", { name: "Passport photo of Bola Draft" })
    ).toHaveAttribute("src", "/api/v1/admin/members/12/photo")
    expect(within(dialog).queryAllByRole("button")).toHaveLength(1) // Close only
    for (const name of [
      "Account details",
      "Application status",
      "Employment information",
    ])
      expect(within(dialog).getByRole("region", { name })).toBeInTheDocument()
    const employment = within(dialog).getByRole("region", {
      name: "Employment information",
    })
    expect(within(employment).getByText("Finance")).toBeInTheDocument()
  })

  it("marks submitted details as self-reported, and says when there's no application", async () => {
    stubMembers(() => page([CHI, ADA]))
    await renderRoute("/admin/members")
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole("button", {
        name: "View details for Chi Waiting",
      })
    )
    let dialog = await screen.findByRole("dialog", { name: "Chi Waiting" })
    expect(dialog).toHaveTextContent(
      "From the submitted application. Self-reported"
    )
    expect(dialog).not.toHaveTextContent("Draft")
    expect(dialog).toHaveTextContent("Awaiting approval")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(dialog).not.toBeInTheDocument())

    await user.click(
      screen.getByRole("button", { name: "View details for Ada Fresh" })
    )
    dialog = await screen.findByRole("dialog", { name: "Ada Fresh" })
    expect(dialog).toHaveTextContent("hasn't started an application")
    expect(dialog).toHaveTextContent("Not verified")
    expect(dialog).toHaveTextContent("Disabled")
    expect(within(dialog).queryByRole("img")).not.toBeInTheDocument() // initials, no photo
  })

  it("shows the empty, past-the-end and error states", async () => {
    let reply: (params: URLSearchParams) => unknown = () =>
      page([], { total: 0 })
    stubMembers((params) => reply(params))
    await renderRoute("/admin/members")
    const user = userEvent.setup()
    await screen.findByText("No registrations match these filters.")

    // Members were removed between pages: page 2 comes back past the end.
    reply = (params) =>
      params.get("page") === "1"
        ? page([BOLA], { total: 30 })
        : page([], { page: 2, total: 20 })
    await user.selectOptions(screen.getByLabelText("Role"), "member")
    await user.click(await screen.findByRole("button", { name: "Next page" }))
    await screen.findByText("This page is past the last result.")
    expect(screen.getByText("20 in total")).toBeInTheDocument()

    reply = () => json({ status: 500, body: { error: "boom" } })
    await user.click(
      screen.getByRole("button", { name: "Go to the first page" })
    )
    expect(
      await screen.findByText("We couldn't load members")
    ).toBeInTheDocument()
  })
})
