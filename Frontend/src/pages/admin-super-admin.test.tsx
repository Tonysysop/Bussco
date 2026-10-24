import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { callsTo, csrfHeader, stubFetch } from "@/test/fetch"
import { renderRoute } from "@/test/render"

const ADMIN_ME = "/api/v1/admin/auth/me"
const ADMINS = "/api/v1/admin/administrators"
const CHANGES = "/api/v1/admin/role_changes"
const ROOT = {
  id: 1,
  full_name: "Adaeze Okafor",
  email: "root@example.com",
  admin_role: "super_admin",
  account_status: "active",
}
const PRESIDENT = {
  id: 2,
  full_name: "Emeka Nwosu",
  email: "emeka@example.com",
  admin_role: "president",
  account_status: "active",
}
const MEMBER = {
  id: 3,
  full_name: "Chinedu Eze",
  email: "chi@example.com",
  admin_role: null,
  account_status: "active",
}
const SUPER_ME = {
  path: ADMIN_ME,
  status: 200,
  body: { user: { ...ROOT, must_change_password: false } },
}
const LIST = {
  path: ADMINS,
  status: 200,
  body: { administrators: [PRESIDENT, ROOT] },
}
const HISTORY = {
  path: CHANGES,
  status: 200,
  body: {
    role_changes: [
      {
        id: 9,
        previous_role: null,
        new_role: "president",
        action: "grant",
        actor: "Adaeze Okafor",
        created_at: new Date().toISOString(),
        user: PRESIDENT,
      },
      {
        id: 4,
        previous_role: "treasurer",
        new_role: null,
        action: "revoke",
        actor: "Jane Ops",
        created_at: "2026-01-05T10:00:00Z",
        user: MEMBER,
      },
    ],
  },
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe("Super Admin portal", () => {
  it("shows the overview from real administrator data, with unbuilt sections disabled", async () => {
    stubFetch(SUPER_ME, LIST, HISTORY)
    await renderRoute("/admin")

    await screen.findByRole("heading", { name: "Overview" })
    expect(await screen.findAllByText("Emeka Nwosu")).not.toHaveLength(0)
    expect(screen.getByText("Vacant")).toBeInTheDocument() // no Treasurer
    expect(screen.getByText("Jane Ops")).toBeInTheDocument()
    const nav = screen.getByRole("navigation", { name: "Super admin" })
    expect(within(nav).getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(within(nav).getByRole("link", { name: /Members/ })).toHaveAttribute(
      "aria-disabled",
      "true"
    )
    expect(
      screen.queryByText(/savings|loan portfolio/i)
    ).not.toBeInTheDocument()
  })

  it("keeps the placeholder for a President, and sends them away from Super Admin pages", async () => {
    const fetchMock = stubFetch(
      {
        path: ADMIN_ME,
        status: 200,
        body: { user: { ...PRESIDENT, must_change_password: false } },
      },
      {
        path: ADMIN_ME,
        status: 200,
        body: { user: { ...PRESIDENT, must_change_password: false } },
      }
    )
    const router = await renderRoute("/admin/roles")

    await screen.findByText("Emeka Nwosu")
    expect(router.state.location.pathname).toBe("/admin")
    expect(
      screen.queryByRole("navigation", { name: "Super admin" })
    ).not.toBeInTheDocument()
    expect(callsTo(fetchMock, ADMINS, "GET")).toHaveLength(0)
  })

  it("collapses the sidebar and remembers it", async () => {
    stubFetch(SUPER_ME, LIST, HISTORY)
    await renderRoute("/admin")
    await userEvent.click(
      await screen.findByRole("button", { name: "Collapse sidebar" })
    )
    expect(
      screen.getByRole("button", { name: "Expand sidebar" })
    ).toBeInTheDocument()
    expect(window.localStorage.getItem("bussco.sidebarCollapsed")).toBe("1")
  })

  it("assigns an office after search, selection and a confirmation naming the consequences", async () => {
    const fetchMock = stubFetch(
      SUPER_ME,
      LIST,
      {
        path: `${ADMINS}/eligible?q=chi`,
        status: 200,
        body: { accounts: [MEMBER] },
      },
      {
        path: `${ADMINS}/3`,
        status: 200,
        body: {
          administrator: { ...MEMBER, admin_role: "president" },
          changed: true,
        },
      },
      {
        path: ADMINS,
        status: 200,
        body: {
          administrators: [{ ...MEMBER, admin_role: "president" }, ROOT],
        },
      }
    )
    await renderRoute("/admin/roles")
    await userEvent.click(
      await screen.findByRole("button", { name: "Reassign President" })
    )

    const dialog = await screen.findByRole("dialog", {
      name: "Assign President",
    })
    expect(dialog).toHaveTextContent("Emeka Nwosu currently holds this office")
    await userEvent.type(
      within(dialog).getByLabelText("Search active members"),
      "chi"
    )
    await userEvent.click(
      await within(dialog).findByRole("radio", { name: /Chinedu Eze/ })
    )
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Continue" })
    )

    const confirm = await screen.findByRole("dialog", {
      name: "Assign President?",
    })
    expect(confirm).toHaveTextContent("Chinedu Eze will become President.")
    expect(confirm).toHaveTextContent(
      "Emeka Nwosu currently holds this office and will return to member access."
    )
    expect(callsTo(fetchMock, `${ADMINS}/3`, "PATCH")).toHaveLength(0)
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Assign as President" })
    )

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Chinedu Eze is now President."
    )
    const [call] = callsTo(fetchMock, `${ADMINS}/3`, "PATCH")
    expect(JSON.parse(call[1]!.body as string)).toEqual({ role: "president" })
    expect(csrfHeader(call)).toBeTruthy()
  })

  it("offers only President and Treasurer as offices", async () => {
    stubFetch(SUPER_ME, LIST)
    await renderRoute("/admin/roles")
    await userEvent.click(
      await screen.findByRole("button", { name: "Assign role" })
    )
    const offices = within(
      await screen.findByRole("group", { name: "Office" })
    ).getAllByRole("radio")
    expect(offices.map((o) => (o as HTMLInputElement).value)).toEqual([
      "president",
      "treasurer",
    ])
  })

  it("changes and revokes only after confirmation, and shows Rails' refusal without closing", async () => {
    const fetchMock = stubFetch(
      SUPER_ME,
      LIST,
      { path: `${ADMINS}/2`, status: 409, body: { error: "conflict" } },
      LIST
    )
    await renderRoute("/admin/roles")
    await userEvent.click(
      await screen.findByRole("button", { name: "Actions for Emeka Nwosu" })
    )
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Change to Treasurer" })
    )

    const dialog = await screen.findByRole("dialog", {
      name: "Change to Treasurer?",
    })
    expect(dialog).toHaveTextContent("President will become vacant.")
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Change to Treasurer" })
    )
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "changed at the same time"
    )
    expect(
      JSON.parse(
        callsTo(fetchMock, `${ADMINS}/2`, "PATCH")[0][1]!.body as string
      )
    ).toEqual({ role: "treasurer" })

    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(
      screen.queryByRole("button", { name: "Actions for Adaeze Okafor" })
    ).not.toBeInTheDocument()
  })

  it("revokes with a null role", async () => {
    const fetchMock = stubFetch(
      SUPER_ME,
      LIST,
      {
        path: `${ADMINS}/2`,
        status: 200,
        body: {
          administrator: { ...PRESIDENT, admin_role: null },
          changed: true,
        },
      },
      { path: ADMINS, status: 200, body: { administrators: [ROOT] } }
    )
    await renderRoute("/admin/roles")
    await userEvent.click(
      await screen.findByRole("button", { name: "Actions for Emeka Nwosu" })
    )
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Revoke access" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "Revoke admin access?",
    })
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Revoke access" })
    )

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Emeka Nwosu has returned to member access."
    )
    expect(
      JSON.parse(
        callsTo(fetchMock, `${ADMINS}/2`, "PATCH")[0][1]!.body as string
      )
    ).toEqual({ role: null })
  })

  it("filters the directory and shows an empty state", async () => {
    stubFetch(SUPER_ME, LIST)
    await renderRoute("/admin/roles")
    await screen.findByRole("button", { name: "Actions for Emeka Nwosu" })
    await userEvent.type(
      screen.getByLabelText("Search administrators by name or email"),
      "zzz"
    )
    expect(
      screen.getByText("No administrators match this search.")
    ).toBeInTheDocument()
  })

  it("shows the read-only audit history grouped by day, with details on expand", async () => {
    stubFetch(SUPER_ME, HISTORY)
    await renderRoute("/admin/audit")

    expect(
      await screen.findByRole("heading", { name: "TODAY" })
    ).toBeInTheDocument()
    const event = screen.getByRole("button", {
      name: /Jane Ops — revoked Treasurer access/,
    })
    await userEvent.click(event)
    expect(event).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("RC-4")).toBeInTheDocument()

    await userEvent.type(
      screen.getByLabelText("Search by person or email"),
      "nobody"
    )
    expect(screen.getByText("No events match this search")).toBeInTheDocument()
  })

  it("returns to sign-in as expired when an admin API answers 401", async () => {
    stubFetch(
      SUPER_ME,
      {
        path: CHANGES,
        status: 401,
        body: { error: "unauthenticated" },
      },
      { path: ADMIN_ME, status: 401, body: { error: "unauthenticated" } }
    )
    const router = await renderRoute("/admin/audit")
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/admin/login")
    )
    expect(router.state.location.search).toContain("reason=expired")
  })
})
