import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import {
  draft,
  ME,
  NEXT_OF_KIN,
  SIGNED_IN,
  SIGNED_OUT,
  SUBMITTED,
  USER,
} from "@/test/application"
import { callsTo, csrfHeader, stubFetch } from "@/test/fetch"
import { renderRoute } from "@/test/render"

const HOME = "12 Marina Road\nLagos"
const EMPTY = {
  next_of_kin_name: null,
  next_of_kin_relationship: null,
  next_of_kin_phone: null,
  next_of_kin_address: null,
  home_address: HOME,
}
// What the filled form sends.
const FILLED = {
  next_of_kin_name: "Amina Bello",
  next_of_kin_relationship: "Sibling",
  next_of_kin_phone: "+2348023456789",
  next_of_kin_address: "14 Admiralty Way, Lagos",
}

const saved = (
  fields: Record<string, unknown>,
  lock_version: number,
  stages: Record<string, string> = {},
  current = "next_of_kin"
) =>
  draft(
    stages,
    current,
    200,
    { ...EMPTY, ...fields, lock_version },
    NEXT_OF_KIN
  )
const loaded = (fields: Record<string, unknown> = {}, lock_version = 1) =>
  draft({}, "next_of_kin", 200, { ...EMPTY, ...fields, lock_version })

const name = () => screen.getByLabelText(/^Next of kin full name/)
const relationship = () => screen.getByLabelText(/^Relationship/)
const phone = () => screen.getByLabelText(/^Contact phone number/)
const address = () => screen.getByLabelText(/^Contact \/ Residential address/)
const sameAsHome = () =>
  screen.getByRole("checkbox", { name: "Same as my home address" })
const later = () =>
  screen.getByRole("button", { name: /Save and continue later|Saving/ })
const continueButton = () =>
  screen.getByRole("button", { name: /^Continue|^Saving/ })
const patches = (fetchMock: ReturnType<typeof stubFetch>) =>
  callsTo(fetchMock, NEXT_OF_KIN, "PATCH")
const sent = (call: [string, RequestInit?]) =>
  JSON.parse(call[1]!.body as string)

async function open(...replies: Parameters<typeof stubFetch>) {
  const fetchMock = stubFetch(SIGNED_IN, ...replies)
  const router = await renderRoute("/apply/next_of_kin")
  await screen.findByLabelText(/^Next of kin full name/)
  return { fetchMock, router, user: userEvent.setup() }
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(name(), FILLED.next_of_kin_name)
  await user.selectOptions(relationship(), "Sibling")
  await user.type(phone(), "0802 345 6789")
  await user.type(address(), FILLED.next_of_kin_address)
}

describe("Next of kin: loading and layout", () => {
  it("follows Stage3: labels, required markers, placeholders, grid, keyboard order, no autofill", async () => {
    const { user } = await open(loaded())

    expect(
      screen.getByRole("heading", { name: "Next of kin" })
    ).toBeInTheDocument()
    expect(name()).toHaveAttribute("placeholder", "e.g. Amina Bello")
    expect(
      within(relationship())
        .getAllByRole("option")
        .map((o) => o.textContent)
    ).toEqual([
      "Select relationship",
      "Spouse",
      "Parent",
      "Sibling",
      "Child",
      "Other",
    ])
    expect(phone()).toHaveAttribute("type", "tel")
    expect(screen.getByText("(Optional)")).toBeInTheDocument()
    expect(screen.getByText("+234")).toBeInTheDocument()
    expect(address().tagName).toBe("TEXTAREA")
    for (const field of [name(), relationship(), address()])
      expect(field).toHaveAttribute("aria-required", "true")
    expect(phone()).not.toHaveAttribute("aria-required")
    // These describe someone else: the browser mustn't offer the applicant's own details.
    for (const field of [name(), phone(), address()])
      expect(field).toHaveAttribute("autocomplete", "off")
    expect(name().closest(".grid")).toHaveClass("grid", "sm:grid-cols-2")

    await user.tab()
    expect(name()).toHaveFocus()
    await user.tab()
    expect(relationship()).toHaveFocus()
    await user.tab()
    expect(phone()).toHaveFocus()
    await user.tab()
    expect(sameAsHome()).toHaveFocus()
    await user.tab()
    expect(address()).toHaveFocus()
  })

  it("prefills the saved details: an unlisted relationship reopens as Other, +234 hidden, foreign numbers kept", async () => {
    await open(
      loaded({
        next_of_kin_name: "Chidi Obi",
        next_of_kin_relationship: "Guardian",
        next_of_kin_phone: "+442079460958",
        next_of_kin_address: "5 Broad Street",
      })
    )
    expect(name()).toHaveValue("Chidi Obi")
    expect(relationship()).toHaveValue("Other")
    expect(screen.getByLabelText(/^Specify relationship/)).toHaveValue(
      "Guardian"
    )
    expect(phone()).toHaveValue("+442079460958")
    expect(screen.queryByText("+234")).toBeNull()
    expect(address()).toHaveValue("5 Broad Street")
    expect(sameAsHome()).not.toBeChecked()
  })
})

describe("Next of kin: validation", () => {
  it("Continue requires name, relationship and address, not the phone, and sends nothing", async () => {
    const { fetchMock, user } = await open(loaded())
    await user.click(continueButton())

    for (const message of [
      "Next of kin name can't be blank",
      "Relationship can't be blank",
      "Contact address can't be blank",
    ])
      expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.queryByText(/Contact phone number can't/)).toBeNull()
    expect(name()).toHaveAttribute("aria-invalid", "true")
    expect(name()).toHaveAttribute("aria-describedby", "next_of_kin_name-error")
    expect(patches(fetchMock)).toHaveLength(0)
  })

  it("Save later keeps a partial draft: blanks and an empty phone go as null, a local phone gains +234", async () => {
    const { fetchMock, router, user } = await open(
      loaded(),
      saved(
        {
          next_of_kin_name: "Amina Bello",
          next_of_kin_phone: "+2348023456789",
        },
        2
      )
    )
    await user.type(name(), "Amina Bello")
    await user.type(phone(), "0802 345 6789")
    await user.click(later())

    expect(await screen.findByText(/Draft saved at/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/apply/next_of_kin")
    expect(sent(patches(fetchMock)[0])).toEqual({
      lock_version: 1,
      application: {
        next_of_kin_name: "Amina Bello",
        next_of_kin_relationship: null,
        next_of_kin_phone: "+2348023456789",
        next_of_kin_address: null,
      },
    })
  })

  it("keeps an international number's own country code, without a +234 prefix", async () => {
    const { fetchMock, user } = await open(loaded(), saved({}, 2))
    await user.type(phone(), "+44 20 7946 0958")
    expect(screen.queryByText("+234")).toBeNull()
    await user.click(later())

    await screen.findByText(/Draft saved at/)
    expect(sent(patches(fetchMock)[0]).application.next_of_kin_phone).toBe(
      "+442079460958"
    )
  })

  it("saves a relationship typed under Other", async () => {
    const { fetchMock, user } = await open(loaded(), saved({}, 2))
    await user.selectOptions(relationship(), "Other")
    await user.type(screen.getByLabelText(/^Specify relationship/), "Guardian")
    await user.click(later())

    await screen.findByText(/Draft saved at/)
    expect(
      sent(patches(fetchMock)[0]).application.next_of_kin_relationship
    ).toBe("Guardian")
  })

  it("rejects invalid values even for a draft", async () => {
    const { fetchMock, user } = await open(loaded())
    await user.type(phone(), "12")
    await user.type(name(), "x".repeat(121))
    await user.click(later())

    expect(
      screen.getByText("Enter a valid contact phone number, e.g. 803 123 4567")
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Next of kin name is too long (maximum is 120 characters)"
      )
    ).toBeInTheDocument()
    expect(patches(fetchMock)).toHaveLength(0)
  })

  it("shows Rails' field errors under the fields, and anything else in an alert", async () => {
    const { user } = await open(loaded(), {
      path: NEXT_OF_KIN,
      status: 422,
      body: {
        errors: {
          next_of_kin_phone: ["is invalid"],
          lock_version: ["is required"],
        },
      },
    })
    await user.type(phone(), "0802 345 6789")
    await user.click(later())

    expect(
      await screen.findByText("Contact phone number is invalid")
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Some details couldn't be saved/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Draft saved/)).toBeNull()
  })
})

describe("Next of kin: same as my home address", () => {
  it("copies the saved home address once; the copy stays editable", async () => {
    const { fetchMock, user } = await open(loaded(), saved({}, 2))
    await user.click(sameAsHome())

    expect(address()).toHaveValue(HOME)
    expect(sameAsHome()).toBeChecked()
    expect(
      screen.getByText(
        "Copied from your personal details. You can still edit it."
      )
    ).toBeInTheDocument()
    await user.click(later())
    await screen.findByText(/Draft saved at/)
    expect(sent(patches(fetchMock)[0]).application.next_of_kin_address).toBe(
      HOME
    )
  })

  it("editing the copied address unticks the box and keeps the edit", async () => {
    const { user } = await open(loaded())
    await user.click(sameAsHome())
    await user.type(address(), ", Nigeria")

    expect(sameAsHome()).not.toBeChecked()
    expect(address()).toHaveValue(`${HOME}, Nigeria`)
  })

  it("unticking keeps whatever address is there", async () => {
    const { user } = await open(loaded())
    await user.click(sameAsHome())
    await user.click(sameAsHome())

    expect(sameAsHome()).not.toBeChecked()
    expect(address()).toHaveValue(HOME)
  })

  it("is disabled, with the reason, when no home address is saved", async () => {
    await open(loaded({ home_address: null }))

    expect(sameAsHome()).toBeDisabled()
    expect(sameAsHome()).toHaveAccessibleDescription(
      "To copy your home address, add it in Personal details first."
    )
  })

  it("reopens ticked when the saved address is the home address", async () => {
    await open(loaded({ next_of_kin_address: HOME }))
    expect(sameAsHome()).toBeChecked()
  })
})

describe("Next of kin: saving", () => {
  it("Save & Continue sends exactly the four fields with the form's version, then moves to Contributions", async () => {
    const { fetchMock, router, user } = await open(
      loaded(),
      saved(FILLED, 2, { next_of_kin: "complete" }, "savings")
    )
    await fill(user)
    await user.click(continueButton())

    expect(
      await screen.findByRole("heading", { name: "Monthly contribution" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/apply/savings")
    const [call] = patches(fetchMock)
    expect(sent(call)).toEqual({ lock_version: 1, application: FILLED })
    expect(csrfHeader(call)).toBe("csrf-token-1")
    expect(new Headers(call[1]?.headers).get("X-Applicant-Id")).toBe(
      String(USER.id)
    )
    const steps = within(screen.getByRole("list")).getAllByRole("listitem")
    expect(steps[2]).toHaveTextContent("3. Next of kin (complete)")
  })

  it("never moves on when the save fails, and keeps what was typed", async () => {
    const { router, user } = await open(loaded(), {
      path: NEXT_OF_KIN,
      status: 500,
    })
    await fill(user)
    await user.click(continueButton())

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong"
    )
    expect(router.state.location.pathname).toBe("/apply/next_of_kin")
    expect(name()).toHaveValue("Amina Bello")
  })

  it("shows Saving…, disables both buttons and sends one request however often clicked", async () => {
    const { fetchMock, user } = await open(loaded(), saved({}, 2))
    const reply = fetchMock.getMockImplementation()!
    let release!: () => void
    fetchMock.mockImplementation(async (path, init) => {
      if (path === NEXT_OF_KIN) await new Promise<void>((r) => (release = r))
      return reply(path, init)
    })
    await user.type(name(), "Amina")
    await user.click(later())

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled()
    expect(screen.getByRole("button", { name: /^Continue/ })).toBeDisabled()
    await user.dblClick(screen.getByRole("button", { name: "Saving…" }))
    await user.keyboard("{Enter}")
    await act(async () => release())
    await screen.findByText(/Draft saved at/)
    expect(patches(fetchMock)).toHaveLength(1)
  })

  it("explains an offline save and keeps the values", async () => {
    const { user } = await open(loaded(), new TypeError("Failed to fetch"))
    await user.type(name(), "Amina")
    await user.click(later())

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach the server."
    )
    expect(name()).toHaveValue("Amina")
    expect(later()).toBeEnabled()
  })
})

describe("Next of kin: conflicts and sessions", () => {
  const STALE = {
    path: NEXT_OF_KIN,
    status: 409,
    body: { error: "stale", application: { lock_version: 2 } },
  }

  it("a stale save keeps the typed values until Load latest, then saves with Rails' version", async () => {
    const { fetchMock, user } = await open(
      loaded({ next_of_kin_name: "Chidi Obi" }),
      STALE,
      loaded({ next_of_kin_name: "Chidi Okafor" }, 2),
      saved({ next_of_kin_name: "Chidi Okafor" }, 3)
    )
    await user.clear(name())
    await user.type(name(), "Amina Bello")
    await user.click(later())

    expect(
      await screen.findByText(/changed in another tab or window/)
    ).toBeInTheDocument()
    expect(name()).toHaveValue("Amina Bello")
    await user.click(
      screen.getByRole("button", { name: "Load latest saved version" })
    )
    expect(await screen.findByDisplayValue("Chidi Okafor")).toBe(name())
    await user.click(later())
    await screen.findByText(/Draft saved at/)
    expect(patches(fetchMock).map((call) => sent(call).lock_version)).toEqual([
      1, 2,
    ])
  })

  it("a failed reload keeps the typed values and the option to try again", async () => {
    const { user } = await open(
      loaded(),
      STALE,
      new TypeError("Failed to fetch")
    )
    await user.type(name(), "Amina Bello")
    await user.click(later())
    await screen.findByText(/changed in another tab or window/)
    await user.click(
      screen.getByRole("button", { name: "Load latest saved version" })
    )

    expect(
      await screen.findByText(/We couldn't reach the server/)
    ).toBeInTheDocument()
    expect(name()).toHaveValue("Amina Bello")
    expect(
      screen.getByRole("button", { name: "Load latest saved version" })
    ).toBeEnabled()
  })

  it("already_submitted reloads into the read-only submitted screen", async () => {
    const { user } = await open(
      loaded(),
      {
        path: NEXT_OF_KIN,
        status: 409,
        body: { error: "already_submitted", application: {} },
      },
      SUBMITTED
    )
    await user.type(name(), "Amina")
    await user.click(later())

    expect(
      await screen.findByRole("heading", { name: "Application submitted" })
    ).toBeInTheDocument()
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("a 401 while saving ends the session and goes to login", async () => {
    const { router, user } = await open(
      loaded(),
      { path: NEXT_OF_KIN, ...SIGNED_OUT },
      { path: ME, ...SIGNED_OUT }
    )
    await user.type(name(), "Amina")
    await user.click(later())

    expect(
      await screen.findByRole("heading", { name: "Welcome back" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/login")
  })

  it("a CSRF rejection is explained without signing out, and the retry uses a fresh token", async () => {
    const { fetchMock, user } = await open(
      loaded(),
      { path: NEXT_OF_KIN, status: 403, body: { error: "invalid_csrf_token" } },
      saved({ next_of_kin_name: "Amina" }, 2)
    )
    await user.type(name(), "Amina")
    await user.click(later())

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't verify this request. Please try again."
    )
    await user.click(later())
    await screen.findByText(/Draft saved at/)
    expect(patches(fetchMock).map(csrfHeader)).toEqual([
      "csrf-token-1",
      "csrf-token-2",
    ])
  })

  it("a save Rails refuses for another sign-in keeps the typed values, explains, and rechecks /me", async () => {
    const { fetchMock, user } = await open(
      loaded(),
      { path: NEXT_OF_KIN, status: 409, body: { error: "identity_mismatch" } },
      SIGNED_IN
    )
    await user.type(name(), "Amina Bello")
    await user.click(later())

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You signed in to a different account in another window."
    )
    expect(name()).toHaveValue("Amina Bello")
    expect(screen.queryByText(/Draft saved/)).toBeNull()
    expect(callsTo(fetchMock, ME, "GET").length).toBeGreaterThan(1)
  })

  it("switching from employee A to B in the same browser never shows A's next of kin to B", async () => {
    const BOLA = {
      ...USER,
      id: 2,
      full_name: "Bola Ade",
      email: "bola@example.com",
    }
    const asBola = <T extends { body: { applicant: { email: string } } }>(
      reply: T
    ) => {
      reply.body.applicant.email = BOLA.email
      return reply
    }
    // A's saved next of kin; A types more; the save is answered for B (signed in in another tab),
    // so this tab rechecks /me and becomes B's. Later a save answered for A switches back, with A's
    // application still cached, and then to B again.
    const A_KIN = {
      next_of_kin_name: "Amina Bello",
      next_of_kin_address: "A's kin address",
    }
    const fetchMock = stubFetch(
      { path: ME, ...SIGNED_IN },
      { path: ME, status: 200, body: { user: BOLA } },
      { path: ME, ...SIGNED_IN },
      { path: ME, status: 200, body: { user: BOLA } },
      loaded(A_KIN, 1),
      asBola(loaded({}, 9)),
      loaded(A_KIN, 1),
      asBola(loaded({}, 9)),
      asBola(saved({}, 9)),
      saved(A_KIN, 1),
      asBola(saved({}, 9))
    )
    await renderRoute("/apply/next_of_kin")
    const user = userEvent.setup()
    await waitFor(() => expect(name()).toHaveValue("Amina Bello"))

    // A saves; Rails answers for B (signed in in another tab): this tab becomes B's.
    await user.type(phone(), "0802 345 6789")
    await user.click(later())
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Amina Bello")).toBeNull()
    )
    await screen.findByLabelText(/^Next of kin full name/)
    // B saves; Rails answers for A: back to A, whose application is still cached.
    await user.click(later())
    await waitFor(() => expect(name()).toHaveValue("Amina Bello"))
    // A saves again; Rails answers for B, whose application is now cached too: the risky switch.
    await user.click(later())
    await waitFor(() => expect(callsTo(fetchMock, ME, "GET")).toHaveLength(4))
    await screen.findByLabelText(/^Next of kin full name/)

    await waitFor(() => expect(name()).toHaveValue(""))
    expect(address()).toHaveValue("")
    expect(phone()).toHaveValue("")
    expect(screen.queryByDisplayValue(/Amina|A's kin address|802/)).toBeNull()
    // Each draft was only ever sent with its own applicant's version.
    expect(patches(fetchMock).map((call) => sent(call).lock_version)).toEqual([
      1, 9, 1,
    ])
  })
})
