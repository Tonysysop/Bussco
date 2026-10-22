import { act, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { callsTo, csrfHeader, stubFetch } from "@/test/fetch"
import {
  APP,
  draft,
  ME,
  NOT_STARTED,
  SIGNED_IN,
  SIGNED_OUT,
  SUBMITTED,
  USER,
} from "@/test/application"
import { renderRoute } from "@/test/render"

const progressItems = () =>
  within(screen.getByRole("list")).getAllByRole("listitem")

describe("ApplyPage: access", () => {
  it("sends a signed-out visitor to login, whatever router state claims", async () => {
    const fetchMock = stubFetch(SIGNED_OUT, SIGNED_OUT)
    const router = await renderRoute("/apply/personal", {
      user: { full_name: "Mallory" },
    })

    expect(
      await screen.findByRole("heading", { name: "Welcome back" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/login")
    expect(screen.queryByText(/Mallory/)).toBeNull()
    expect(callsTo(fetchMock, APP, "GET")).toHaveLength(0)
  })

  it("treats a 401 from the application as an ended session and goes to login", async () => {
    const fetchMock = stubFetch(
      SIGNED_IN,
      { path: APP, ...SIGNED_OUT },
      SIGNED_OUT
    )
    const router = await renderRoute("/apply")

    expect(
      await screen.findByRole("heading", { name: "Welcome back" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/login")
    expect(callsTo(fetchMock, ME, "GET").length).toBeGreaterThan(0)
  })

  it("offers a retry when the session check fails", async () => {
    stubFetch(new TypeError("Failed to fetch"), SIGNED_IN, NOT_STARTED)
    await renderRoute("/apply")

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server."
    )
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }))
    expect(
      await screen.findByRole("heading", {
        name: "Complete your membership application",
      })
    ).toBeInTheDocument()
  })

  it.each([
    [new TypeError("Failed to fetch"), "We couldn't reach the server."],
    [{ status: 500 }, "Something went wrong on our side."],
    [
      {
        status: 429,
        body: { error: "rate_limited" },
        headers: { "Retry-After": "900" },
      },
      "Too many attempts. Try again in 15 minutes.",
    ],
  ])(
    "shows loading, then a retry when the application can't load (%#)",
    async (reply, message) => {
      // Untagged, in order: an Error can't name a path, so a tagged reply would answer first.
      stubFetch(SIGNED_IN, reply, { status: 404, body: { error: "not_found" } })
      await renderRoute("/apply")

      expect(
        await screen.findByText("Loading your application…")
      ).toHaveAttribute("role", "status")
      expect(await screen.findByRole("alert")).toHaveTextContent(message)
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Try again" }))
      expect(
        await screen.findByRole("heading", {
          name: "Complete your membership application",
        })
      ).toBeInTheDocument()
    }
  )
})

describe("ApplyPage: start", () => {
  it("shows the Stage 1 design with the applicant and a Start button when nothing exists yet", async () => {
    stubFetch(SIGNED_IN, NOT_STARTED)
    await renderRoute("/apply")

    expect(
      await screen.findByRole("heading", {
        name: "Complete your membership application",
      })
    ).toBeInTheDocument()
    expect(screen.getByText("Ada Obi")).toBeInTheDocument()
    expect(screen.getByText(USER.email)).toBeInTheDocument()
    expect(screen.getByText("Email verified")).toBeInTheDocument()
    expect(screen.getByText(/Step 1 of 5/)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Start application/ })
    ).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Back/ })).toBeNull()
    expect(
      screen.queryByRole("button", { name: /Save and continue later|Submit/ })
    ).toBeNull()
  })

  it.each([201, 200])(
    "starts (or, on %i, resumes) the draft with a CSRF token and opens Employment",
    async (status) => {
      const fetchMock = stubFetch(
        SIGNED_IN,
        NOT_STARTED,
        draft({}, "employment", status)
      )
      const router = await renderRoute("/apply")
      await userEvent
        .setup()
        .click(await screen.findByRole("button", { name: /Start application/ }))

      expect(
        await screen.findByLabelText(/SAP \/ Staff ID/)
      ).toBeInTheDocument()
      expect(router.state.location.pathname).toBe("/apply/employment")
      const [post] = callsTo(fetchMock, APP)
      expect(csrfHeader(post)).toBe("csrf-token-1")
      expect(
        screen.getByRole("button", { name: /^Continue/ })
      ).toBeInTheDocument()
    }
  )

  it("sends one request however often Start is pressed", async () => {
    const fetchMock = stubFetch(SIGNED_IN, NOT_STARTED, draft())
    const reply = fetchMock.getMockImplementation()!
    let release!: () => void
    fetchMock.mockImplementation(async (path, init) => {
      if (path === APP && init?.method === "POST")
        await new Promise<void>((r) => (release = r))
      return reply(path, init)
    })
    await renderRoute("/apply")
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole("button", { name: /Start application/ })
    )
    const pending = screen.getByRole("button", { name: "Starting…" })
    expect(pending).toBeDisabled()
    await user.dblClick(pending)
    await act(async () => release())

    await screen.findByLabelText(/SAP \/ Staff ID/)
    expect(callsTo(fetchMock, APP)).toHaveLength(1)
  })

  it("keeps the Start screen usable when starting fails", async () => {
    stubFetch(SIGNED_IN, NOT_STARTED, { path: APP, status: 500 })
    await renderRoute("/apply")
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /Start application/ }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong"
    )
    expect(
      screen.getByRole("button", { name: /Start application/ })
    ).toBeEnabled()
  })

  it("sends a stage URL back to the start when nothing has been started", async () => {
    stubFetch(SIGNED_IN, NOT_STARTED, NOT_STARTED)
    const router = await renderRoute("/apply/savings")

    await screen.findByRole("button", { name: /Start application/ })
    expect(router.state.location.pathname).toBe("/apply")
  })
})

describe("ApplyPage: resume and navigation", () => {
  it("resumes at the stage Rails says comes next, replacing /apply in history", async () => {
    stubFetch(SIGNED_IN, draft({ employment: "complete" }, "personal"))
    const router = await renderRoute("/apply")

    expect(
      await screen.findByRole("heading", { name: "Personal details" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/apply/personal")
    expect(router.state.historyAction).toBe("REPLACE")
  })

  it("redirects an unknown stage to the current one", async () => {
    stubFetch(SIGNED_IN, draft({}, "employment"))
    const router = await renderRoute("/apply/payments")

    await screen.findByRole("heading", {
      name: "Complete your membership application",
    })
    expect(router.state.location.pathname).toBe("/apply/employment")
  })

  it("marks only Rails-confirmed stages complete, and the viewed stage as current", async () => {
    stubFetch(SIGNED_IN, draft({ employment: "complete" }, "personal"))
    await renderRoute("/apply/savings")
    await screen.findByRole("heading", { name: "Monthly contribution" })

    const items = progressItems()
    expect(items).toHaveLength(5)
    expect(items[0]).toHaveTextContent("1. Employment (complete)")
    // Visited or skipped is not the same as complete.
    expect(items[1]).toHaveTextContent("2. Personal (not complete)")
    expect(items[2]).toHaveTextContent("3. Next of kin (not complete)")
    expect(items[3]).toHaveAttribute("aria-current", "step")
    expect(items[3]).not.toHaveTextContent("(complete)")
    expect(screen.getByText(/Step 4 of 5/)).toBeInTheDocument()
  })

  it("treats Review as a fifth step that is never itself complete", async () => {
    stubFetch(
      SIGNED_IN,
      draft(
        {
          employment: "complete",
          personal: "complete",
          next_of_kin: "complete",
          savings: "complete",
        },
        "review"
      )
    )
    await renderRoute("/apply")
    await screen.findByRole("heading", { name: "Review your application" })

    const items = progressItems()
    expect(items[4]).toHaveAttribute("aria-current", "step")
    expect(items[4]).not.toHaveTextContent("(complete)")
    expect(screen.getByText(/Step 5 of 5/)).toBeInTheDocument()
  })

  it("moves through stages without forms yet with Back and Continue only, saving nothing", async () => {
    const fetchMock = stubFetch(SIGNED_IN, draft({}, "personal"))
    const router = await renderRoute("/apply/personal")
    const user = userEvent.setup()
    await screen.findByRole("heading", { name: "Personal details" })

    for (const [title, path] of [
      ["Next of kin", "/apply/next_of_kin"],
      ["Monthly contribution", "/apply/savings"],
    ] as const) {
      await user.click(screen.getByRole("link", { name: /^Continue/ }))
      expect(
        await screen.findByRole("heading", { name: title })
      ).toBeInTheDocument()
      expect(router.state.location.pathname).toBe(path)
    }
    expect(
      screen.getByRole("link", { name: /Continue to review/ })
    ).toBeInTheDocument()
    await user.click(screen.getByRole("link", { name: /Continue to review/ }))
    await screen.findByRole("heading", { name: "Review your application" })
    expect(screen.queryByRole("link", { name: /Continue/ })).toBeNull()

    await user.click(screen.getByRole("link", { name: /Back/ }))
    expect(router.state.location.pathname).toBe("/apply/savings")
    expect(
      screen.queryByRole("button", { name: /Save and continue later|Submit/ })
    ).toBeNull()
    expect(
      fetchMock.mock.calls.filter(
        ([, init]) => init?.method && init.method !== "GET"
      )
    ).toEqual([])
  })

  it("has one heading, an ordered step list and keyboard order Back then Continue", async () => {
    stubFetch(SIGNED_IN, draft({}, "personal"))
    await renderRoute("/apply/personal")
    await screen.findByRole("heading", { name: "Personal details" })

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    expect(screen.getByRole("list").tagName).toBe("OL")
    const user = userEvent.setup()
    await user.tab()
    expect(screen.getByRole("link", { name: /Back/ })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole("link", { name: /Continue/ })).toHaveFocus()
  })

  it("follows the designs' mobile rules", async () => {
    stubFetch(SIGNED_IN, draft({}, "personal"))
    await renderRoute("/apply/personal")
    await screen.findByRole("heading", { name: "Personal details" })

    // Below sm: stage name beside "Step n of 5", labels visually hidden, actions stacked.
    expect(screen.getByText(/— Personal/)).toHaveClass("sm:hidden")
    expect(within(progressItems()[0]).getByText(/Employment/)).toHaveClass(
      "sr-only",
      "sm:not-sr-only"
    )
    expect(
      screen.getByRole("link", { name: /Back/ }).parentElement
    ).toHaveClass("flex-col-reverse", "sm:flex-row")
  })
})

describe("ApplyPage: submitted", () => {
  it("shows the read-only submitted screen for any stage URL", async () => {
    stubFetch(SIGNED_IN, SUBMITTED)
    await renderRoute("/apply/personal")

    expect(
      await screen.findByRole("heading", { name: "Application submitted" })
    ).toBeInTheDocument()
    expect(screen.getByText("22/10/2026")).toHaveAttribute(
      "datetime",
      "2026-10-21T23:30:00Z"
    )
    expect(screen.getByText("Awaiting review")).toBeInTheDocument()
    expect(
      screen.getByText(/Your BUSSCO account is active/)
    ).toBeInTheDocument()
    // Nothing Rails can't back up, and no way to edit.
    expect(screen.queryByText(/reference|notify|email you/i)).toBeNull()
    expect(screen.queryByText(/Step \d of 5/)).toBeNull()
    expect(screen.queryByRole("link")).toBeNull()
    expect(
      screen.queryByRole("button", {
        name: /View submitted|Back|Continue|Edit/,
      })
    ).toBeNull()
  })

  it("checks the status with both requests and says when nothing changed", async () => {
    const fetchMock = stubFetch(SIGNED_IN, SUBMITTED, SIGNED_IN, SUBMITTED)
    await renderRoute("/apply")
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole("button", { name: "Check application status" })
    )

    expect(
      await screen.findByText("Your application is still awaiting review.")
    ).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your application is still awaiting review."
    )
    expect(callsTo(fetchMock, ME, "GET")).toHaveLength(2)
    expect(callsTo(fetchMock, APP, "GET")).toHaveLength(2)
  })

  it("keeps the details and explains a failed check", async () => {
    stubFetch(SIGNED_IN, SUBMITTED, SIGNED_IN, new TypeError("Failed to fetch"))
    await renderRoute("/apply")
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole("button", { name: "Check application status" })
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server."
    )
    expect(screen.getByText("22/10/2026")).toBeInTheDocument()
    expect(
      screen.queryByText("Your application is still awaiting review.")
    ).toBeNull()
    expect(
      screen.getByRole("button", { name: "Check application status" })
    ).toBeEnabled()
  })

  it("goes to login when the check finds the session has ended", async () => {
    stubFetch(SIGNED_IN, SUBMITTED, SIGNED_OUT, SIGNED_OUT)
    const router = await renderRoute("/apply")
    await userEvent
      .setup()
      .click(
        await screen.findByRole("button", { name: "Check application status" })
      )

    expect(
      await screen.findByRole("heading", { name: "Welcome back" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/login")
  })

  it("shows a loading state while checking", async () => {
    const fetchMock = stubFetch(SIGNED_IN, SUBMITTED, SIGNED_IN, SUBMITTED)
    const reply = fetchMock.getMockImplementation()!
    let release!: () => void
    let calls = 0
    fetchMock.mockImplementation(async (path, init) => {
      if (path === ME && ++calls === 2)
        await new Promise<void>((r) => (release = r))
      return reply(path, init)
    })
    await renderRoute("/apply")
    await userEvent
      .setup()
      .click(
        await screen.findByRole("button", { name: "Check application status" })
      )

    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled()
    await act(async () => release())
    expect(
      await screen.findByText("Your application is still awaiting review.")
    ).toBeInTheDocument()
  })

  it("is read-only even when only /me says awaiting approval", async () => {
    const pending = structuredClone(SUBMITTED)
    pending.body.application.submitted_at = null as unknown as string
    stubFetch(SIGNED_IN, pending)
    await renderRoute("/apply/employment")

    expect(
      await screen.findByRole("heading", { name: "Application submitted" })
    ).toBeInTheDocument()
    expect(screen.queryByText("Date submitted")).toBeNull()
  })
})

describe("ApplyPage: one user's application never reaches another", () => {
  const SESSION = "/api/v1/auth/session"
  const ADA = USER
  const BOLA = {
    ...USER,
    id: 2,
    full_name: "Bola Ade",
    email: "bola@example.com",
  }
  // Each endpoint answers its own sequence, so the order of parallel requests doesn't matter.
  const me = (user: typeof USER | null) =>
    user
      ? { path: ME, status: 200, body: { user } }
      : { path: ME, ...SIGNED_OUT }
  const loggedIn = (user: typeof USER) => ({
    path: SESSION,
    status: 201,
    body: { user, csrf_token: `rotated-${user.id}` },
  })

  async function signIn(email: string) {
    const user = userEvent.setup()
    await screen.findByRole("heading", { name: "Welcome back" })
    await user.type(screen.getByLabelText("Work Email Address"), email)
    await user.type(screen.getByLabelText("Password"), "correct horse battery")
    await user.click(screen.getByRole("button", { name: /Sign In/ }))
  }

  // Records every text the page shows, so "never appeared" covers in-between renders too.
  function watchText() {
    const seen: string[] = []
    const observer = new MutationObserver(() =>
      seen.push(document.body.textContent ?? "")
    )
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    return { seen, stop: () => observer.disconnect() }
  }

  it("A's session ends, B signs in in the same tab: A's application never renders for B", async () => {
    const fetchMock = stubFetch(
      me(null), // A opens /login
      loggedIn(ADA),
      me(ADA), // /apply for A
      SUBMITTED, // A's submitted application, dated 22/10/2026
      me(null), // A checks the status: the session has ended
      me(null), // /login again
      loggedIn(BOLA),
      me(BOLA), // /apply for B
      NOT_STARTED
    )
    const router = await renderRoute("/login")

    await signIn(ADA.email)
    expect(
      await screen.findByRole("heading", { name: "Application submitted" })
    ).toBeInTheDocument()
    expect(screen.getByText("22/10/2026")).toBeInTheDocument()

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Check application status" }))
    await screen.findByRole("heading", { name: "Welcome back" })

    const watched = watchText()
    await signIn(BOLA.email)
    expect(
      await screen.findByRole("heading", {
        name: "Complete your membership application",
      })
    ).toBeInTheDocument()
    watched.stop()

    expect(router.state.location.pathname).toBe("/apply")
    expect(screen.getByText("Bola Ade")).toBeInTheDocument()
    expect(
      watched.seen.some((text) =>
        /Application submitted|22\/10\/2026|Ada Obi/.test(text)
      )
    ).toBe(false)
    // B's application was fetched fresh, not read from A's cache.
    expect(callsTo(fetchMock, APP, "GET")).toHaveLength(2)
  })

  it("Start writes the new draft to the signed-in user's own cache entry", async () => {
    const fetchMock = stubFetch(
      SIGNED_IN,
      NOT_STARTED,
      draft({}, "employment", 201)
    )
    await renderRoute("/apply")
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /Start application/ }))

    await screen.findByLabelText(/SAP \/ Staff ID/)
    // Had it been written under another key, the page would have fetched the application again.
    expect(callsTo(fetchMock, APP, "GET")).toHaveLength(1)
  })

  it("a check that finds B never files B's application under A's key", async () => {
    // Another tab signs B in before A's check, then signs A back in before A returns to this tab.
    stubFetch(
      me(ADA),
      SUBMITTED,
      me(BOLA), // A's check: the cookie now belongs to B
      NOT_STARTED, // B's application
      NOT_STARTED,
      me(ADA), // focus refetch: the cookie is A's again
      SUBMITTED
    )
    await renderRoute("/apply")
    await userEvent
      .setup()
      .click(
        await screen.findByRole("button", { name: "Check application status" })
      )
    await screen.findByText("Bola Ade")

    const seen: string[] = []
    const observer = new MutationObserver(() =>
      seen.push(document.body.textContent ?? "")
    )
    observer.observe(document.body, { childList: true, subtree: true })
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }))
    })
    expect(
      await screen.findByRole("heading", { name: "Application submitted" })
    ).toBeInTheDocument()
    observer.disconnect()
    // While A's page loads, B's start screen (cached under the wrong key) must not flash up.
    const afterA = seen.slice(
      seen.findIndex((text) => !text.includes("Bola Ade"))
    )
    expect(afterA.some((text) => text.includes("Start application"))).toBe(
      false
    )
  })

  it("a status check that finds a different signed-in user shows that user's own application", async () => {
    // Another tab signed B in on this browser, replacing A's session cookie.
    // Rails answers for whoever the session cookie now belongs to: B, who hasn't started.
    stubFetch(me(ADA), SUBMITTED, me(BOLA), NOT_STARTED, NOT_STARTED)
    await renderRoute("/apply")
    await userEvent
      .setup()
      .click(
        await screen.findByRole("button", { name: "Check application status" })
      )

    expect(
      await screen.findByRole("heading", {
        name: "Complete your membership application",
      })
    ).toBeInTheDocument()
    expect(screen.getByText("Bola Ade")).toBeInTheDocument()
    expect(screen.queryByText(/22\/10\/2026|Application submitted/)).toBeNull()
  })
})
