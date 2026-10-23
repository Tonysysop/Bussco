import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { draft, ME, SAVINGS, SIGNED_IN, USER } from "@/test/application"
import { callsTo, csrfHeader, stubFetch } from "@/test/fetch"
import { renderRoute } from "@/test/render"

const EMPTY = { monthly_contribution_kobo: null, contribution_start_date: null }

const saved = (
  fields: Record<string, unknown>,
  lock_version: number,
  stages: Record<string, string> = {},
  current = "savings"
) => draft(stages, current, 200, { ...EMPTY, ...fields, lock_version }, SAVINGS)
const loaded = (fields: Record<string, unknown> = {}, lock_version = 1) =>
  draft({}, "savings", 200, { ...EMPTY, ...fields, lock_version })

const amount = () => screen.getByLabelText(/^Proposed monthly contribution/)
const start = () => screen.getByLabelText(/^Proposed contribution start date/)
const later = () =>
  screen.getByRole("button", { name: /Save and continue later|Saving/ })
const continueButton = () =>
  screen.getByRole("button", { name: /^Continue to review|^Saving/ })
const patches = (fetchMock: ReturnType<typeof stubFetch>) =>
  callsTo(fetchMock, SAVINGS, "PATCH")
const sent = (call: [string, RequestInit?]) =>
  JSON.parse(call[1]!.body as string)

// Today is 23 October 2026 in Lagos: contributions may start from 1 November 2026.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-23T12:00:00Z"))
})
afterEach(() => vi.useRealTimers())

async function open(...replies: Parameters<typeof stubFetch>) {
  const fetchMock = stubFetch(SIGNED_IN, ...replies)
  const router = await renderRoute("/apply/savings")
  await screen.findByLabelText(/^Proposed monthly contribution/)
  return { fetchMock, router, user: userEvent.setup() }
}

async function pickStart(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp
) {
  await user.click(start())
  const calendar = await screen.findByRole("dialog")
  await user.click(within(calendar).getByRole("button", { name }))
}

describe("Contributions: loading and layout", () => {
  it("follows Stage4, with the minimum and fee from Rails' policy", async () => {
    const reply = loaded()
    // Not Rails' current figures, so a hardcoded ₦30,000 or ₦10,000 would fail.
    reply.body.policy = {
      minimum_monthly_contribution_kobo: 4_000_000,
      registration_fee_kobo: 1_250_000,
    }
    await open(reply)

    expect(
      screen.getByRole("heading", { name: "Monthly contribution" })
    ).toBeInTheDocument()
    expect(screen.getByText("₦")).toBeInTheDocument()
    expect(amount()).toHaveAttribute("inputmode", "numeric")
    expect(amount()).toHaveAttribute("aria-required", "true")
    expect(start()).toHaveAccessibleName(/start date.*required$/)
    expect(amount()).toHaveAccessibleDescription(
      "Minimum monthly contribution: ₦40,000"
    )
    expect(
      screen.getByText("One-time registration fee: ₦12,500")
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Submitting this application doesn't start any deductions/
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(/loan repayments are separate from your savings/)
    ).toBeInTheDocument()
    expect(continueButton()).toBeInTheDocument()
  })

  it("prefills the saved amount in naira and the saved start date", async () => {
    await open(
      loaded({
        monthly_contribution_kobo: 3_500_000,
        contribution_start_date: "2026-12-01",
      })
    )
    expect(amount()).toHaveValue("35,000")
    expect(
      screen.getByText("Thirty Five Thousand Naira Only")
    ).toBeInTheDocument()
    expect(start()).toHaveAccessibleName(/1 December 2026/)
  })
})

describe("Contributions: the amount", () => {
  it("adds commas on blur and writes the amount in words", async () => {
    const { user } = await open(loaded())
    await user.type(amount(), "50000")
    await user.tab()

    expect(amount()).toHaveValue("50,000")
    expect(amount()).toHaveAccessibleDescription(
      "Minimum monthly contribution: ₦30,000 Amount in words: Fifty Thousand Naira Only"
    )
  })

  it("rejects amounts below the minimum, over the limit or not in whole naira, even for a draft", async () => {
    const { fetchMock, user } = await open(loaded())
    for (const [typed, message] of [
      ["29,999", "Monthly contribution must be at least ₦30,000"],
      ["10000000000", "Monthly contribution can't be more than ₦9,999,999,999"],
      ["30000.50", "Enter the amount in whole naira, e.g. 50,000"],
      ["thirty", "Enter the amount in whole naira, e.g. 50,000"],
    ]) {
      await user.clear(amount())
      await user.type(amount(), typed)
      await user.click(later())
      expect(screen.getByText(message)).toBeInTheDocument()
      expect(amount()).toHaveAttribute("aria-invalid", "true")
    }
    expect(patches(fetchMock)).toHaveLength(0)
  })

  it("keeps an error shown when the field loses focus", async () => {
    const { user } = await open(loaded())
    await user.type(amount(), "20000")
    await user.click(later())
    await user.click(amount())
    await user.tab()
    expect(
      screen.getByText("Monthly contribution must be at least ₦30,000")
    ).toBeInTheDocument()
  })
})

describe("Contributions: the start date", () => {
  it("offers only the 1st of each month, from next month for 12 months", async () => {
    const { user } = await open(loaded())
    await user.click(start())
    const calendar = await screen.findByRole("dialog")

    expect(
      within(calendar).getByRole("button", { name: /November 1st, 2026/ })
    ).toBeEnabled()
    expect(
      within(calendar).getByRole("button", { name: /November 2nd, 2026/ })
    ).toBeDisabled()
    const years = within(
      within(calendar).getByRole("combobox", { name: /year/i })
    ).getAllByRole("option")
    expect(years.map((option) => option.textContent)).toEqual(["2026", "2027"])
  })

  it("flags a saved start that is no longer next month or later, only on Continue", async () => {
    const { fetchMock, user } = await open(
      loaded({
        monthly_contribution_kobo: 3_000_000,
        contribution_start_date: "2026-10-01",
      }),
      saved({ contribution_start_date: "2026-10-01" }, 2)
    )
    await user.click(continueButton())
    expect(
      screen.getByText(
        "Contribution start date must be 1 November 2026 or later"
      )
    ).toBeInTheDocument()
    expect(patches(fetchMock)).toHaveLength(0)

    await user.click(later())
    await screen.findByText(/Draft saved at/)
    expect(patches(fetchMock)).toHaveLength(1)
  })
})

describe("Contributions: saving", () => {
  it("Continue requires both fields and sends nothing", async () => {
    const { fetchMock, user } = await open(loaded())
    await user.click(continueButton())

    expect(
      screen.getByText("Monthly contribution can't be blank")
    ).toBeInTheDocument()
    expect(
      screen.getByText("Contribution start date can't be blank")
    ).toBeInTheDocument()
    expect(amount()).toHaveAttribute(
      "aria-describedby",
      "monthly_contribution_kobo-error contribution-minimum"
    )
    expect(patches(fetchMock)).toHaveLength(0)
  })

  it("Save later keeps a partial draft and says saved only after Rails answers", async () => {
    const { fetchMock, router, user } = await open(
      loaded(),
      saved({ monthly_contribution_kobo: 5_000_000 }, 2)
    )
    await user.type(amount(), "50,000")
    await user.click(later())

    expect(await screen.findByText(/Draft saved at/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/apply/savings")
    expect(sent(patches(fetchMock)[0])).toEqual({
      lock_version: 1,
      application: {
        monthly_contribution_kobo: "5000000",
        contribution_start_date: null,
      },
    })
  })

  it("Save & Continue sends integer kobo with the form's version, then moves to Review", async () => {
    const { fetchMock, router, user } = await open(
      loaded(),
      saved(
        {
          monthly_contribution_kobo: 3_000_000,
          contribution_start_date: "2026-11-01",
        },
        2,
        { savings: "complete" },
        "review"
      )
    )
    await user.type(amount(), "30000")
    await pickStart(user, /November 1st, 2026/)
    await user.click(continueButton())

    expect(
      await screen.findByRole("heading", { name: "Review your application" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/apply/review")
    const [call] = patches(fetchMock)
    expect(sent(call)).toEqual({
      lock_version: 1,
      application: {
        monthly_contribution_kobo: "3000000",
        contribution_start_date: "2026-11-01",
      },
    })
    expect(csrfHeader(call)).toBe("csrf-token-1")
    expect(new Headers(call[1]?.headers).get("X-Applicant-Id")).toBe(
      String(USER.id)
    )
    const steps = within(screen.getByRole("list")).getAllByRole("listitem")
    expect(steps[3]).toHaveTextContent("4. Contributions (complete)")
  })

  it("shows Rails' field errors under the field and never moves on", async () => {
    const { router, user } = await open(loaded(), {
      path: SAVINGS,
      status: 422,
      body: { errors: { monthly_contribution_kobo: ["is invalid"] } },
    })
    await user.type(amount(), "30000")
    await pickStart(user, /November 1st, 2026/)
    await user.click(continueButton())

    expect(
      await screen.findByText("Monthly contribution is invalid")
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/apply/savings")
    expect(amount()).toHaveValue("30,000")
  })

  it("sends one request however often clicked", async () => {
    const { fetchMock, user } = await open(loaded(), saved({}, 2))
    const reply = fetchMock.getMockImplementation()!
    let release!: () => void
    fetchMock.mockImplementation(async (path, init) => {
      if (path === SAVINGS) await new Promise<void>((r) => (release = r))
      return reply(path, init)
    })
    await user.type(amount(), "30000")
    await user.click(later())

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled()
    expect(
      screen.getByRole("button", { name: /^Continue to review/ })
    ).toBeDisabled()
    await user.dblClick(screen.getByRole("button", { name: "Saving…" }))
    await user.keyboard("{Enter}")
    await act(async () => release())
    await screen.findByText(/Draft saved at/)
    expect(patches(fetchMock)).toHaveLength(1)
  })

  it("explains an offline save and keeps the amount", async () => {
    const { user } = await open(loaded(), new TypeError("Failed to fetch"))
    await user.type(amount(), "30000")
    await user.click(later())

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server."
    )
    expect(amount()).toHaveValue("30,000")
  })
})

describe("Contributions: conflicts and sessions", () => {
  it("a stale save keeps the typed amount until Load latest, then saves with Rails' version", async () => {
    const { fetchMock, user } = await open(
      loaded(),
      {
        path: SAVINGS,
        status: 409,
        body: { error: "stale", application: { lock_version: 2 } },
      },
      loaded({ monthly_contribution_kobo: 4_000_000 }, 2),
      saved({ monthly_contribution_kobo: 4_000_000 }, 3)
    )
    await user.type(amount(), "30000")
    await user.click(later())

    expect(
      await screen.findByText(/changed in another tab or window/)
    ).toBeInTheDocument()
    expect(amount()).toHaveValue("30,000")
    await user.click(
      screen.getByRole("button", { name: "Load latest saved version" })
    )
    await waitFor(() => expect(amount()).toHaveValue("40,000"))
    await user.click(later())
    await screen.findByText(/Draft saved at/)
    expect(patches(fetchMock).map((call) => sent(call).lock_version)).toEqual([
      1, 2,
    ])
  })

  it("a save answered for another sign-in shows that applicant's own, empty form", async () => {
    const BOLA = { ...USER, id: 2, email: "bola@example.com" }
    const forBola = loaded({}, 9)
    forBola.body.applicant.email = BOLA.email
    const fetchMock = stubFetch(
      { path: ME, ...SIGNED_IN },
      { path: ME, status: 200, body: { user: BOLA } },
      loaded({ monthly_contribution_kobo: 3_500_000 }, 1),
      forBola,
      { ...forBola, path: SAVINGS }
    )
    await renderRoute("/apply/savings")
    const user = userEvent.setup()
    await waitFor(() => expect(amount()).toHaveValue("35,000"))

    await user.clear(amount())
    await user.type(amount(), "60000")
    await user.click(later())
    await waitFor(() => expect(callsTo(fetchMock, ME, "GET")).toHaveLength(2))
    await waitFor(() => expect(amount()).toHaveValue(""))
    expect(screen.queryByDisplayValue(/35,000|60000/)).toBeNull()
  })
})
