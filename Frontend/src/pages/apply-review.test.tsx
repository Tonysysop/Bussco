import { act, screen, waitFor, within } from "@testing-library/react"
import { focusManager } from "@tanstack/react-query"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  APP,
  DECLARATION,
  draft,
  ME,
  PHOTO,
  SIGNED_IN,
  SUBMISSION,
  SUBMITTED,
  USER,
} from "@/test/application"
import { callsTo, csrfHeader, stubFetch } from "@/test/fetch"
import { renderRoute } from "@/test/render"

const COMPLETE = {
  sap_staff_id: "BUA-1",
  business_unit: "BUA Foods",
  department: "Finance",
  office_location: "Lagos HQ",
  primary_phone: "+2348031234567",
  secondary_phone: null,
  date_of_birth: "1988-04-12",
  sex: "Female",
  marital_status: "Single",
  nationality: "Nigerian",
  home_address: "12 Marina Road\nLagos",
  passport_photo: {
    content_type: "image/png",
    byte_size: 1000,
    checksum: "sum-1",
  },
  next_of_kin_name: "Amina Bello",
  next_of_kin_relationship: "Sibling",
  next_of_kin_phone: null,
  next_of_kin_address: "14 Admiralty Way",
  monthly_contribution_kobo: 5_000_000,
  contribution_start_date: "2026-11-01",
}
const ALL_COMPLETE = {
  employment: "complete",
  personal: "complete",
  next_of_kin: "complete",
  savings: "complete",
}

// The GET (or 4xx-reload) answer for a complete draft, ready to submit unless `missing` says otherwise.
function reviewed(
  fields: Record<string, unknown> = {},
  lock_version = 4,
  missing: Record<string, string[]> = {}
) {
  const reply = draft(ALL_COMPLETE, "review", 200, {
    ...COMPLETE,
    ...fields,
    lock_version,
  })
  for (const [stage, list] of Object.entries(missing))
    if (list.length)
      (reply.body.progress.stages as Record<string, string>)[stage] =
        "incomplete"
  reply.body.progress.missing = missing
  reply.body.progress.ready_to_submit = Object.values(missing).every(
    (list) => !list.length
  )
  return reply
}
const IMAGE = {
  path: PHOTO,
  status: 200,
  raw: "photo",
  headers: { "X-Applicant-Id": "1" },
}
const ACCEPTED_201 = {
  ...SUBMITTED,
  path: SUBMISSION,
  status: 201,
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:1")
  URL.revokeObjectURL = vi.fn()
})

const accept = () =>
  screen.getByRole("checkbox", {
    name: "I have read and accept this declaration.",
  })
const submitButton = () =>
  screen.getByRole("button", { name: /Submit application|Submitting/ })
const successIcon = () =>
  screen.getByRole("heading", { name: "Application submitted" })
    .previousElementSibling
const posts = (fetchMock: ReturnType<typeof stubFetch>) =>
  callsTo(fetchMock, SUBMISSION, "POST")
const sent = (call: [string, RequestInit?]) =>
  JSON.parse(call[1]!.body as string)

// The first /me and application answers are tagged too, so later tagged answers (status checks and
// reloads) are used in order and never jump ahead of them.
async function open(
  initial: ReturnType<typeof reviewed>,
  ...replies: Parameters<typeof stubFetch>
) {
  const fetchMock = stubFetch(
    { path: ME, ...SIGNED_IN },
    { ...initial, path: APP },
    ...replies
  )
  const router = await renderRoute("/apply/review")
  await screen.findByRole("heading", { name: "Review your application" })
  return { fetchMock, router, user: userEvent.setup() }
}

describe("Review: what the applicant checks", () => {
  it("shows every saved section with Edit links, the photo and the fee from policy", async () => {
    await open(reviewed(), IMAGE)

    for (const [name, link] of [
      ["Employment details", "/apply/employment"],
      ["Personal details", "/apply/personal"],
      ["Next of kin", "/apply/next_of_kin"],
      ["Contributions & fees", "/apply/savings"],
    ]) {
      const section = screen.getByRole("region", { name: new RegExp(name) })
      expect(
        within(section).getByRole("link", { name: /^Edit/ })
      ).toHaveAttribute("href", link)
    }
    for (const value of [
      "BUA-1",
      "BUA Foods",
      "Ada Obi",
      "+2348031234567",
      "12 April 1988",
      "Amina Bello",
      "₦50,000",
      "₦10,000",
      "1 November 2026",
    ])
      expect(screen.getByText(value)).toBeInTheDocument()
    expect(screen.getByText(USER.email)).toBeInTheDocument()
    expect(
      await screen.findByRole("img", { name: "Your passport photograph" })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Submitting this application doesn't start any deductions/
      )
    ).toBeInTheDocument()
  })

  it("shows the declaration exactly as Rails sends it, marked as a draft while unapproved", async () => {
    await open(reviewed(), IMAGE)
    expect(screen.getByText(DECLARATION.text)).toBeInTheDocument()
    expect(
      screen.getByText("DRAFT — Pending Legal Approval")
    ).toBeInTheDocument()
    expect(accept()).not.toBeChecked()
    expect(accept()).toHaveAccessibleDescription(DECLARATION.text)
  })

  it("drops the draft label for an approved declaration", async () => {
    const reply = reviewed()
    reply.body.policy = {
      ...reply.body.policy,
      declaration: { ...DECLARATION, version: "v1", approved: true },
    }
    await open(reply, IMAGE)
    expect(screen.queryByText("DRAFT — Pending Legal Approval")).toBeNull()
  })

  it("lists missing information per section, with the way to fix it, and blocks submission", async () => {
    const { fetchMock, user } = await open(
      reviewed({ passport_photo: null, contribution_start_date: null }, 4, {
        personal: ["passport_photo"],
        savings: ["contribution_start_date"],
      })
    )
    expect(
      screen.getByText("Passport photograph", { exact: false })
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole("region", { name: /Contributions/ })).getByText(
        /Contribution start date/
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Complete the sections marked incomplete before you submit."
      )
    ).toBeInTheDocument()
    await user.click(accept())
    expect(submitButton()).toBeDisabled()
    expect(posts(fetchMock)).toHaveLength(0)
  })

  it("keeps submission closed when no declaration may be accepted (production without approval)", async () => {
    const reply = reviewed()
    reply.body.policy = { ...reply.body.policy, declaration: null }
    await open(reply, IMAGE)
    expect(
      screen.getByText(/the membership declaration is awaiting approval/)
    ).toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(submitButton()).toBeDisabled()
  })
})

describe("Review: submitting", () => {
  it("needs explicit acceptance, then sends the shown version and the declaration version", async () => {
    const { fetchMock, user } = await open(reviewed(), IMAGE, ACCEPTED_201)
    expect(submitButton()).toBeDisabled()
    await user.click(accept())
    await user.click(submitButton())

    expect(
      await screen.findByRole("heading", { name: "Application submitted" })
    ).toBeInTheDocument()
    expect(screen.getByText("Awaiting review")).toBeInTheDocument()
    // A submission confirmed in this session gets the one-time entrance (static under reduced motion).
    expect(successIcon()).toHaveClass(
      "animate-in",
      "motion-reduce:animate-none"
    )
    const [call] = posts(fetchMock)
    expect(sent(call)).toEqual({
      lock_version: 4,
      declaration_accepted: true,
      declaration_version: "draft-v1",
    })
    expect(csrfHeader(call)).toBe("csrf-token-1")
    expect(new Headers(call[1]?.headers).get("X-Applicant-Id")).toBe(
      String(USER.id)
    )
  })

  it("sends one request however often clicked", async () => {
    const { fetchMock, user } = await open(reviewed(), IMAGE, ACCEPTED_201)
    const reply = fetchMock.getMockImplementation()!
    let release!: () => void
    fetchMock.mockImplementation(async (path, init) => {
      if (path === SUBMISSION) await new Promise<void>((r) => (release = r))
      return reply(path, init)
    })
    await user.click(accept())
    await user.click(submitButton())
    expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled()
    await user.dblClick(screen.getByRole("button", { name: "Submitting…" }))
    await act(async () => release())
    await screen.findByRole("heading", { name: "Application submitted" })
    expect(posts(fetchMock)).toHaveLength(1)
  })

  it("Rails' missing list reloads the application, shows what to fix and never resubmits", async () => {
    const { fetchMock, user } = await open(
      reviewed(),
      IMAGE,
      {
        path: SUBMISSION,
        status: 422,
        body: { errors: {}, missing: { savings: ["contribution_start_date"] } },
      },
      { path: ME, ...SIGNED_IN },
      {
        ...reviewed({ contribution_start_date: null }, 4, {
          savings: ["contribution_start_date"],
        }),
        path: APP,
      }
    )
    await user.click(accept())
    await user.click(submitButton())

    expect(
      await screen.findByText(/Some sections are incomplete/)
    ).toBeInTheDocument()
    await waitFor(() => expect(accept()).not.toBeChecked())
    expect(submitButton()).toBeDisabled()
    expect(posts(fetchMock)).toHaveLength(1)
  })

  it("a declaration Rails no longer accepts (503) reloads and keeps submission closed", async () => {
    const closed = reviewed()
    closed.body.policy = { ...closed.body.policy, declaration: null }
    const { user } = await open(
      reviewed(),
      IMAGE,
      {
        path: SUBMISSION,
        status: 503,
        body: { error: "declaration_unavailable" },
      },
      { path: ME, ...SIGNED_IN },
      { ...closed, path: APP }
    )
    await user.click(accept())
    await user.click(submitButton())

    expect(await screen.findByText(/Nothing was submitted/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull())
    expect(submitButton()).toBeDisabled()
  })

  it("a CSRF rejection is explained, and the applicant's retry uses a fresh token", async () => {
    const { fetchMock, user } = await open(
      reviewed(),
      IMAGE,
      { path: SUBMISSION, status: 403, body: { error: "invalid_csrf_token" } },
      ACCEPTED_201
    )
    await user.click(accept())
    await user.click(submitButton())
    expect(
      await screen.findByText(
        "We couldn't verify this request. Please try again."
      )
    ).toBeInTheDocument()
    await user.click(submitButton())
    await screen.findByRole("heading", { name: "Application submitted" })
    expect(posts(fetchMock).map(csrfHeader)).toEqual([
      "csrf-token-1",
      "csrf-token-2",
    ])
  })

  it("already_submitted shows the read-only submitted screen", async () => {
    const { user } = await open(
      reviewed(),
      IMAGE,
      {
        path: SUBMISSION,
        status: 409,
        body: { error: "already_submitted", application: {} },
      },
      SUBMITTED
    )
    await user.click(accept())
    await user.click(submitButton())
    expect(
      await screen.findByRole("heading", { name: "Application submitted" })
    ).toBeInTheDocument()
  })
})

describe("Review: the reviewed snapshot", () => {
  it("a background refetch never swaps the reviewed details or version; the applicant chooses to see them", async () => {
    const { fetchMock, user } = await open(
      reviewed(),
      IMAGE,
      { path: ME, ...SIGNED_IN },
      { ...reviewed({ department: "Audit" }, 5), path: APP },
      ACCEPTED_201
    )
    await user.click(accept())
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })

    expect(
      await screen.findByText(/changed in another tab or window/)
    ).toBeInTheDocument()
    expect(screen.getByText("Finance")).toBeInTheDocument()
    expect(screen.queryByText("Audit")).toBeNull()
    expect(submitButton()).toBeDisabled()

    await user.click(
      screen.getByRole("button", { name: "Show updated details" })
    )
    expect(screen.getByText("Audit")).toBeInTheDocument()
    expect(accept()).not.toBeChecked()
    await user.click(accept())
    await user.click(submitButton())
    await screen.findByRole("heading", { name: "Application submitted" })
    expect(sent(posts(fetchMock)[0]).lock_version).toBe(5)
    act(() => focusManager.setFocused(undefined))
  })

  it("a stale submission reloads, resets acceptance and is never retried automatically", async () => {
    const { fetchMock, user } = await open(
      reviewed(),
      IMAGE,
      {
        path: SUBMISSION,
        status: 409,
        body: { error: "stale", application: { lock_version: 5 } },
      },
      { path: ME, ...SIGNED_IN },
      { ...reviewed({ department: "Audit" }, 5), path: APP }
    )
    await user.click(accept())
    await user.click(submitButton())

    expect(
      await screen.findByText(
        /so it wasn't submitted. Check the updated details/
      )
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText("Audit")).toBeInTheDocument())
    expect(accept()).not.toBeChecked()
    expect(submitButton()).toBeDisabled()
    expect(posts(fetchMock)).toHaveLength(1)
  })
})

describe("Review: uncertain outcomes", () => {
  // Every /me and application answer is tagged, in order; the only untagged reply answers the POST.
  async function openWithLostAnswer(
    lost: Parameters<typeof stubFetch>[number],
    ...after: Parameters<typeof stubFetch>
  ) {
    const fetchMock = stubFetch(
      { path: ME, ...SIGNED_IN },
      { ...reviewed(), path: APP },
      IMAGE,
      lost,
      ...after
    )
    await renderRoute("/apply/review")
    const user = userEvent.setup()
    await user.click(await screen.findByRole("checkbox"))
    await user.click(submitButton())
    return { fetchMock, user }
  }

  it("a lost answer offers a status check; if Rails has it, the submitted screen shows", async () => {
    const { fetchMock, user } = await openWithLostAnswer(
      new TypeError("Failed to fetch"),
      { path: ME, ...SIGNED_IN },
      { ...SUBMITTED, path: APP }
    )

    expect(
      await screen.findByText(
        /couldn't confirm whether your application was submitted/
      )
    ).toBeInTheDocument()
    expect(screen.queryByText("Application submitted")).toBeNull()
    await user.click(
      screen.getByRole("button", { name: "Check application status" })
    )
    expect(
      await screen.findByRole("heading", { name: "Application submitted" })
    ).toBeInTheDocument()
    // Learned from a status check, not confirmed by this submission: no celebration.
    expect(successIcon()).not.toHaveClass("animate-in")
    expect(posts(fetchMock)).toHaveLength(1)
  })

  it("if the check finds a draft (after a 502), the applicant reviews and submits again explicitly", async () => {
    const { fetchMock, user } = await openWithLostAnswer(
      { status: 502 },
      { path: ME, ...SIGNED_IN },
      { ...reviewed(), path: APP },
      { status: 201, body: SUBMITTED.body }
    )
    await user.click(
      await screen.findByRole("button", { name: "Check application status" })
    )

    expect(
      await screen.findByText(/hasn't been submitted yet/)
    ).toBeInTheDocument()
    expect(accept()).not.toBeChecked()
    expect(posts(fetchMock)).toHaveLength(1)
    await user.click(accept())
    await user.click(submitButton())
    await screen.findByRole("heading", { name: "Application submitted" })
    expect(posts(fetchMock)).toHaveLength(2)
  })

  it("a submission refused for another sign-in rechecks /me and never carries the acceptance over", async () => {
    const BOLA = { ...USER, id: 2, email: "bola@example.com" }
    const forBola = reviewed(
      { department: "Bola's dept", passport_photo: null },
      9
    )
    forBola.body.applicant = {
      ...forBola.body.applicant,
      email: BOLA.email,
      full_name: "Bola Ade",
    }
    const fetchMock = stubFetch(
      { path: ME, ...SIGNED_IN },
      { path: ME, status: 200, body: { user: BOLA } },
      reviewed(),
      IMAGE,
      { path: SUBMISSION, status: 409, body: { error: "identity_mismatch" } },
      forBola
    )
    await renderRoute("/apply/review")
    const user = userEvent.setup()
    await user.click(await screen.findByRole("checkbox"))
    await user.click(submitButton())

    await waitFor(() =>
      expect(screen.getByText("Bola's dept")).toBeInTheDocument()
    )
    expect(screen.queryByText("Finance")).toBeNull()
    expect(accept()).not.toBeChecked()
    expect(posts(fetchMock)).toHaveLength(1)
  })
})
