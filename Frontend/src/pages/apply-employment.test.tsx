import { onlineManager } from "@tanstack/react-query"
import { act, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import {
  APP,
  draft,
  EMPLOYMENT,
  ME,
  SIGNED_IN,
  SIGNED_OUT,
  SUBMITTED,
} from "@/test/application"
import { callsTo, csrfHeader, stubFetch } from "@/test/fetch"
import { renderRoute } from "@/test/render"

const FILLED = {
  sap_staff_id: "SAP-849201",
  business_unit: "BUA Foods",
  department: "Finance & Accounts",
  office_location: "BUA Towers, Lagos",
}
const EMPTY = {
  sap_staff_id: null,
  business_unit: null,
  department: null,
  office_location: null,
}

// Rails' 200 for a PATCH: the full application with the new version and Rails-computed progress.
const saved = (
  fields: Record<string, unknown>,
  lock_version: number,
  stages: Record<string, string> = {},
  current = "employment"
) => draft(stages, current, 200, { ...fields, lock_version }, EMPLOYMENT)
const loaded = (fields: Record<string, unknown> = EMPTY, lock_version = 1) =>
  draft({}, "employment", 200, { ...fields, lock_version })

const sap = () => screen.getByLabelText(/SAP \/ Staff ID/)
const unit = () => screen.getByLabelText(/^Business Unit/)
const department = () => screen.getByLabelText(/^Department/)
const office = () => screen.getByLabelText(/Office address/)
const later = () =>
  screen.getByRole("button", { name: /Save and continue later|Saving/ })
const continueButton = () =>
  screen.getByRole("button", { name: /^Continue|^Saving/ })
const patches = (fetchMock: ReturnType<typeof stubFetch>) =>
  callsTo(fetchMock, EMPLOYMENT, "PATCH")
const sent = (call: [string, RequestInit?]) =>
  JSON.parse(call[1]!.body as string)

async function open(...replies: Parameters<typeof stubFetch>) {
  const fetchMock = stubFetch(SIGNED_IN, ...replies)
  const router = await renderRoute("/apply/employment")
  await screen.findByLabelText(/SAP \/ Staff ID/)
  return { fetchMock, router, user: userEvent.setup() }
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(sap(), FILLED.sap_staff_id)
  await user.selectOptions(unit(), FILLED.business_unit)
  await user.type(department(), FILLED.department)
  await user.type(office(), FILLED.office_location)
}

describe("Employment: loading and layout", () => {
  it("shows the saved draft, reopening an unlisted business unit as Other", async () => {
    await open(loaded({ ...FILLED, business_unit: "BUA Rice Mills" }))

    expect(sap()).toHaveValue("SAP-849201")
    expect(unit()).toHaveValue("Other")
    expect(screen.getByLabelText(/Specify Business Unit Name/)).toHaveValue(
      "BUA Rice Mills"
    )
    expect(department()).toHaveValue("Finance & Accounts")
    expect(office()).toHaveValue("BUA Towers, Lagos")
    expect(screen.getByText("Ada Obi")).toBeInTheDocument()
  })

  it("follows Stage1: required labels, placeholders, grid and keyboard order", async () => {
    const { user } = await open(loaded())

    for (const input of [sap(), unit(), department(), office()])
      expect(input).toHaveAttribute("aria-required", "true")
    expect(sap()).toHaveAttribute("placeholder", "e.g. SAP-849201")
    expect(screen.getByText("* Required information")).toBeInTheDocument()
    expect(sap().closest(".grid")).toHaveClass("sm:grid-cols-2")

    await user.tab()
    for (const element of [
      sap(),
      unit(),
      department(),
      office(),
      later(),
      continueButton(),
    ]) {
      expect(element).toHaveFocus()
      await user.tab()
    }
  })
})

describe("Employment: validation", () => {
  it("Continue requires all four fields and sends nothing until they are filled", async () => {
    const { fetchMock, user } = await open(loaded())
    await user.click(continueButton())

    for (const message of [
      "SAP / Staff ID can't be blank",
      "Business unit can't be blank",
      "Department can't be blank",
      "Office address can't be blank",
    ])
      expect(screen.getByText(message)).toBeInTheDocument()
    expect(sap()).toHaveAttribute("aria-invalid", "true")
    expect(sap()).toHaveAttribute("aria-describedby", "sap_staff_id-error")
    expect(patches(fetchMock)).toHaveLength(0)
  })

  it("Save later keeps a genuinely partial draft, sending blanks as null", async () => {
    const { fetchMock, router, user } = await open(
      loaded(),
      saved({ ...EMPTY, department: "Audit" }, 2)
    )
    await user.type(department(), "  Audit ")
    await user.click(later())

    expect(
      await screen.findByText(/Draft saved at \d\d:\d\d/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/can't be blank/)).toBeNull()
    expect(sent(patches(fetchMock)[0])).toEqual({
      lock_version: 1,
      application: { ...EMPTY, department: "Audit" },
    })
    expect(router.state.location.pathname).toBe("/apply/employment")
  })

  it.each(["later", "continue"] as const)(
    "rejects Rails-invalid formats and lengths on %s, without a request",
    async (action) => {
      const { fetchMock, user } = await open(loaded())
      await user.type(sap(), "BUA 1")
      await user.click(department())
      await user.paste("x".repeat(121))
      await user.click(action === "later" ? later() : continueButton())

      expect(
        screen.getByText(/SAP \/ Staff ID can only use letters/)
      ).toBeInTheDocument()
      expect(
        screen.getByText("Department is too long (maximum is 120 characters)")
      ).toBeInTheDocument()
      expect(patches(fetchMock)).toHaveLength(0)
    }
  )

  it("asks for the business unit name when Other is chosen, and saves what was typed", async () => {
    const { fetchMock, user } = await open(
      loaded(),
      saved(
        { ...FILLED, business_unit: "BUA Rice Mills" },
        2,
        { employment: "complete" },
        "personal"
      )
    )
    await fill(user)
    await user.selectOptions(unit(), "Other")
    await user.click(continueButton())
    expect(screen.getByText("Business unit can't be blank")).toBeInTheDocument()

    await user.type(
      screen.getByLabelText(/Specify Business Unit Name/),
      "BUA Rice Mills"
    )
    await user.click(continueButton())
    await screen.findByRole("heading", { name: "Personal details" })
    expect(sent(patches(fetchMock)[0]).application.business_unit).toBe(
      "BUA Rice Mills"
    )
  })

  it("shows Rails' field errors under the fields, and anything else in an alert", async () => {
    const { user } = await open(loaded(), {
      path: EMPLOYMENT,
      status: 422,
      body: {
        errors: { sap_staff_id: ["is invalid"], lock_version: ["is required"] },
      },
    })
    await user.type(sap(), "SAP-1")
    await user.click(later())

    expect(
      await screen.findByText("SAP / Staff ID is invalid")
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Some details couldn't be saved/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Draft saved/)).toBeNull()
  })
})

describe("Employment: saving", () => {
  it("Save & Continue sends the fields with the form's version, then moves on with Rails' progress", async () => {
    const { fetchMock, router, user } = await open(
      loaded(),
      saved(FILLED, 2, { employment: "complete" }, "personal")
    )
    await fill(user)
    await user.click(continueButton())

    expect(
      await screen.findByRole("heading", { name: "Personal details" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/apply/personal")
    const [call] = patches(fetchMock)
    expect(sent(call)).toEqual({ lock_version: 1, application: FILLED })
    expect(csrfHeader(call)).toBe("csrf-token-1")
    const steps = within(screen.getByRole("list")).getAllByRole("listitem")
    expect(steps[0]).toHaveTextContent("1. Employment (complete)")
  })

  it("never moves on when the save fails, and keeps what was typed", async () => {
    const { router, user } = await open(loaded(), {
      path: EMPLOYMENT,
      status: 500,
    })
    await fill(user)
    await user.click(continueButton())

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong"
    )
    expect(router.state.location.pathname).toBe("/apply/employment")
    expect(department()).toHaveValue("Finance & Accounts")
  })

  it("each save sends the version Rails returned for the previous one", async () => {
    const { fetchMock, user } = await open(
      loaded(),
      saved({ ...EMPTY, department: "Audit" }, 2),
      saved({ ...EMPTY, department: "Audit", office_location: "Kano" }, 3)
    )
    await user.type(department(), "Audit")
    await user.click(later())
    await screen.findByText(/Draft saved at/)
    await user.type(office(), "Kano")
    await user.click(later())

    await screen.findByText(/Draft saved at/)
    expect(patches(fetchMock).map((call) => sent(call).lock_version)).toEqual([
      1, 2,
    ])
  })

  it("shows Saving…, disables both buttons and sends one request however often clicked", async () => {
    const { fetchMock, user } = await open(loaded(), saved(FILLED, 2))
    const reply = fetchMock.getMockImplementation()!
    let release!: () => void
    fetchMock.mockImplementation(async (path, init) => {
      if (path === EMPLOYMENT) await new Promise<void>((r) => (release = r))
      return reply(path, init)
    })
    await user.type(department(), "Audit")
    await user.click(later())

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled()
    expect(screen.getByRole("button", { name: /^Continue/ })).toBeDisabled()
    await user.dblClick(screen.getByRole("button", { name: "Saving…" }))
    await user.keyboard("{Enter}")
    await act(async () => release())
    await screen.findByText(/Draft saved at/)
    expect(patches(fetchMock)).toHaveLength(1)
  })

  it.each([
    [new TypeError("Failed to fetch"), "We couldn't reach the server."],
    [
      {
        path: EMPLOYMENT,
        status: 429,
        body: { error: "rate_limited" },
        headers: { "Retry-After": "900" },
      },
      "Too many attempts. Try again in 15 minutes.",
    ],
  ])(
    "explains a failed save (%#) and keeps the values",
    async (reply, message) => {
      const { user } = await open(loaded(), reply)
      await user.type(department(), "Audit")
      await user.click(later())

      expect(await screen.findByRole("alert")).toHaveTextContent(message)
      expect(department()).toHaveValue("Audit")
      expect(later()).toBeEnabled()
    }
  )
})

describe("Employment: conflicts and sessions", () => {
  it("a background refetch never advances the form's version under unsaved edits", async () => {
    const { fetchMock, user } = await open(
      loaded({ ...EMPTY, department: "Finance" }, 1),
      // Another tab saved "Audit" (version 2); this tab's focus refetch receives it.
      loaded({ ...EMPTY, department: "Audit" }, 2),
      {
        path: EMPLOYMENT,
        status: 409,
        body: { error: "stale", application: { lock_version: 2 } },
      },
      loaded({ ...EMPTY, department: "Audit" }, 2),
      saved({ ...EMPTY, department: "Audit", office_location: "Kano" }, 3)
    )
    await user.clear(department())
    await user.type(department(), "Treasury")
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }))
    })
    await act(async () => {})
    expect(callsTo(fetchMock, APP, "GET")).toHaveLength(2)
    expect(department()).toHaveValue("Treasury")

    // Saved with the version the form was loaded with: Rails refuses instead of overwriting "Audit".
    await user.click(later())
    expect(
      await screen.findByText(/changed in another tab or window/)
    ).toBeInTheDocument()
    expect(sent(patches(fetchMock)[0]).lock_version).toBe(1)
    expect(department()).toHaveValue("Treasury")
    expect(patches(fetchMock)).toHaveLength(1) // no automatic retry

    await user.click(
      screen.getByRole("button", { name: "Load latest saved version" })
    )
    await screen.findByDisplayValue("Audit")
    expect(screen.queryByText(/changed in another tab/)).toBeNull()

    await user.type(office(), "Kano")
    await user.click(later())
    await screen.findByText(/Draft saved at/)
    expect(sent(patches(fetchMock)[1]).lock_version).toBe(2)
  })

  describe("Load latest saved version", () => {
    const STALE = {
      path: EMPLOYMENT,
      status: 409,
      body: { error: "stale", application: { lock_version: 2 } },
    }
    const LATEST = loaded({ ...EMPTY, department: "Audit" }, 2)

    // Hits the 409 with "Treasury" typed over the loaded "Finance".
    async function conflict(...after: Parameters<typeof stubFetch>) {
      const opened = await open(
        loaded({ ...EMPTY, department: "Finance" }, 1),
        STALE,
        ...after
      )
      await opened.user.clear(department())
      await opened.user.type(department(), "Treasury")
      await opened.user.click(later())
      await screen.findByText(/changed in another tab or window/)
      return opened
    }
    const reloadButton = () =>
      screen.getByRole("button", { name: /Load latest saved version|Loading…/ })
    // Makes the nth GET of the application go through `handle` instead of the stubbed replies.
    function interceptGet(
      fetchMock: ReturnType<typeof stubFetch>,
      nth: number,
      handle: () => Promise<void>
    ) {
      const reply = fetchMock.getMockImplementation()!
      let gets = 0
      fetchMock.mockImplementation(async (path, init) => {
        if (path === APP && !init?.method && ++gets === nth) await handle()
        return reply(path, init)
      })
    }

    it("shows Loading…, blocks repeat clicks, then loads Rails' values and version", async () => {
      const { fetchMock, user } = await conflict(
        LATEST,
        saved({ ...EMPTY, department: "Audit" }, 3)
      )
      let release!: () => void
      interceptGet(fetchMock, 1, () => new Promise<void>((r) => (release = r)))

      await user.click(reloadButton())
      expect(reloadButton()).toHaveTextContent("Loading…")
      expect(reloadButton()).toBeDisabled()
      await user.dblClick(reloadButton())
      await act(async () => release())

      expect(await screen.findByDisplayValue("Audit")).toBe(department())
      expect(screen.queryByText(/changed in another tab/)).toBeNull()
      expect(callsTo(fetchMock, APP, "GET")).toHaveLength(2)
      await user.click(later())
      await screen.findByText(/Draft saved at/)
      expect(sent(patches(fetchMock)[1]).lock_version).toBe(2)
    })

    it("keeps the typed values and the option to retry when the reload fails", async () => {
      const { fetchMock, user } = await conflict(LATEST)
      interceptGet(fetchMock, 1, async () => {
        throw new TypeError("Failed to fetch")
      })

      await user.click(reloadButton())
      expect(
        await screen.findByText(/We couldn't reach the server/)
      ).toBeInTheDocument()
      expect(department()).toHaveValue("Treasury")
      expect(
        screen.getByText(/changed in another tab or window/)
      ).toBeInTheDocument()
      expect(reloadButton()).toHaveTextContent("Load latest saved version")
      expect(reloadButton()).toBeEnabled()

      await user.click(reloadButton())
      expect(await screen.findByDisplayValue("Audit")).toBe(department())
    })

    // Offline browsers report navigator.onLine = false; requests must fail with a message, not pause.
    it("explains a reload attempted while the browser is offline", async () => {
      const { fetchMock, user } = await conflict(LATEST)
      interceptGet(fetchMock, 1, async () => {
        throw new TypeError("Failed to fetch")
      })
      onlineManager.setOnline(false)
      try {
        await user.click(reloadButton())
        expect(
          await screen.findByText(/We couldn't reach the server/)
        ).toBeInTheDocument()
        expect(department()).toHaveValue("Treasury")
        expect(reloadButton()).toBeEnabled()
      } finally {
        onlineManager.setOnline(true)
      }
    })

    it("never shows or caches another account's application, and rechecks /me", async () => {
      const other = loaded({ ...EMPTY, department: "Bola's department" }, 5)
      other.body.applicant.email = "bola@example.com"
      const { fetchMock, user } = await conflict(other, SIGNED_IN)
      const meCalls = callsTo(fetchMock, ME, "GET").length

      await user.click(reloadButton())
      expect(
        await screen.findByText(/You signed in to a different account/)
      ).toBeInTheDocument()
      expect(screen.queryByDisplayValue("Bola's department")).toBeNull()
      expect(department()).toHaveValue("Treasury")
      await act(async () => {})
      expect(callsTo(fetchMock, ME, "GET").length).toBeGreaterThan(meCalls)
    })

    it("a 401 while reloading ends the session and goes to login", async () => {
      const { router, user } = await conflict(
        { path: APP, ...SIGNED_OUT },
        { path: ME, ...SIGNED_OUT }
      )
      await user.click(reloadButton())

      expect(
        await screen.findByRole("heading", { name: "Welcome back" })
      ).toBeInTheDocument()
      expect(router.state.location.pathname).toBe("/login")
    })
  })

  it("already_submitted reloads into the read-only submitted screen", async () => {
    const { fetchMock, user } = await open(
      loaded(),
      {
        path: EMPLOYMENT,
        status: 409,
        body: { error: "already_submitted", application: {} },
      },
      SUBMITTED
    )
    await user.type(department(), "Audit")
    await user.click(later())

    expect(
      await screen.findByRole("heading", { name: "Application submitted" })
    ).toBeInTheDocument()
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(patches(fetchMock)).toHaveLength(1)
  })

  it("a 401 while saving ends the session and goes to login", async () => {
    const { router, user } = await open(
      loaded(),
      { path: EMPLOYMENT, ...SIGNED_OUT },
      { path: ME, ...SIGNED_OUT }
    )
    await user.type(department(), "Audit")
    await user.click(later())

    expect(
      await screen.findByRole("heading", { name: "Welcome back" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/login")
  })

  it("a CSRF rejection is explained without signing out, and the retry uses a fresh token", async () => {
    const { fetchMock, router, user } = await open(
      loaded(),
      { path: EMPLOYMENT, status: 403, body: { error: "invalid_csrf_token" } },
      saved({ ...EMPTY, department: "Audit" }, 2)
    )
    await user.type(department(), "Audit")
    await user.click(later())

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't verify this request. Please try again."
    )
    expect(router.state.location.pathname).toBe("/apply/employment")
    expect(department()).toHaveValue("Audit")
    await user.click(later())
    await screen.findByText(/Draft saved at/)
    expect(patches(fetchMock).map(csrfHeader)).toEqual([
      "csrf-token-1",
      "csrf-token-2",
    ])
  })

  it("never caches or shows a save answered for a different account, and rechecks /me", async () => {
    const other = saved({ ...FILLED, department: "Bola's department" }, 9)
    other.body.applicant.email = "bola@example.com"
    const { fetchMock, user } = await open(loaded(), other, SIGNED_IN)
    await user.type(department(), "Audit")
    await user.click(later())

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You signed in to a different account in another window."
    )
    expect(screen.queryByText(/Bola's department|Draft saved/)).toBeNull()
    expect(callsTo(fetchMock, ME, "GET").length).toBeGreaterThan(1)
  })

  it("never renders an application loaded for a different account, and rechecks /me", async () => {
    const other = loaded({ ...FILLED, department: "Bola's department" })
    other.body.applicant.email = "bola@example.com"
    const fetchMock = stubFetch(SIGNED_IN, other, SIGNED_IN)
    await renderRoute("/apply/employment")

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You signed in to a different account in another window."
    )
    expect(screen.queryByDisplayValue("Bola's department")).toBeNull()
    expect(callsTo(fetchMock, ME, "GET").length).toBeGreaterThan(1)
  })
})
