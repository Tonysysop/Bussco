import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  APP,
  draft,
  ME,
  PERSONAL,
  PHOTO,
  SIGNED_IN,
  SIGNED_OUT,
  SUBMITTED,
  USER,
} from "@/test/application"
import { callsTo, csrfHeader, stubFetch } from "@/test/fetch"
import { renderRoute } from "@/test/render"

const EMPTY = {
  primary_phone: null,
  secondary_phone: null,
  date_of_birth: null,
  sex: null,
  marital_status: null,
  nationality: null,
  home_address: null,
  passport_photo: null,
}
const PHOTO_SAVED = {
  content_type: "image/png",
  byte_size: 1_258_291,
  checksum: "sum-1",
}
// Rails' GET passport_photo: the bytes, and the owner's id (USER.id is 1).
const IMAGE = (owner = "1", raw = "saved-photo") => ({
  path: PHOTO,
  status: 200,
  raw,
  headers: { "X-Applicant-Id": owner },
})
// What the filled form sends.
const FILLED = {
  primary_phone: "+2348031234567",
  secondary_phone: null,
  date_of_birth: "1988-04-12",
  sex: "Female",
  marital_status: "Married",
  nationality: "Nigerian",
  home_address: "14 Admiralty Way, Lagos",
}

const saved = (
  fields: Record<string, unknown>,
  lock_version: number,
  path = PERSONAL,
  stages: Record<string, string> = {},
  current = "personal"
) => draft(stages, current, 200, { ...EMPTY, ...fields, lock_version }, path)
const loaded = (fields: Record<string, unknown> = {}, lock_version = 1) =>
  draft({}, "personal", 200, { ...EMPTY, ...fields, lock_version })

const mobile = () => screen.getByLabelText(/^Mobile number/)
const birth = () => screen.getByLabelText(/^Date of birth/)
const sex = () => screen.getByLabelText(/^Sex/)
const marital = () => screen.getByLabelText(/^Marital status/)
const nationality = () => screen.getByLabelText(/^Nationality/)
const address = () => screen.getByLabelText(/^Home \/ Contact address/)
const photoInput = () => screen.getByLabelText("Passport photograph file")
const later = () =>
  screen.getByRole("button", { name: /Save and continue later|Saving/ })
const continueButton = () =>
  screen.getByRole("button", { name: /^Continue|^Saving/ })
const patches = (fetchMock: ReturnType<typeof stubFetch>) =>
  callsTo(fetchMock, PERSONAL, "PATCH")
const uploads = (fetchMock: ReturnType<typeof stubFetch>) =>
  callsTo(fetchMock, PHOTO, "PUT")
const sent = (call: [string, RequestInit?]) =>
  JSON.parse(call[1]!.body as string)
const png = (size = 1_258_291) =>
  new File([new Uint8Array(size)], "me.png", { type: "image/png" })

// jsdom has no object URLs: each one maps back to the Blob it was made for.
const objectUrls = new Map<string, Blob>()
beforeEach(() => {
  objectUrls.clear()
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:${objectUrls.size + 1}`
    objectUrls.set(url, blob)
    return url
  })
  URL.revokeObjectURL = vi.fn()
})
const preview = () =>
  screen.queryByRole("img", { name: "Your passport photograph" })
const shownPhoto = () => objectUrls.get(preview()?.getAttribute("src") ?? "")
const photoGets = (fetchMock: ReturnType<typeof stubFetch>) =>
  callsTo(fetchMock, PHOTO, "GET")

async function open(...replies: Parameters<typeof stubFetch>) {
  const fetchMock = stubFetch(SIGNED_IN, ...replies)
  const router = await renderRoute("/apply/personal")
  await screen.findByLabelText(/^Mobile number/)
  return { fetchMock, router, user: userEvent.setup({ applyAccept: false }) }
}

// Picks a day the way an applicant does: open the calendar, choose year and month, click the day.
async function pickBirth(
  user: ReturnType<typeof userEvent.setup>,
  iso: string
) {
  const [year, month, day] = iso.split("-").map(Number)
  await user.click(birth())
  const calendar = await screen.findByRole("dialog")
  await user.selectOptions(
    within(calendar).getByRole("combobox", { name: /year/i }),
    String(year)
  )
  await user.selectOptions(
    within(calendar).getByRole("combobox", { name: /month/i }),
    String(month - 1)
  )
  const name = new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })
  const [monthName, yearText] = name.split(" ")
  await user.click(
    within(calendar).getByRole("button", {
      name: new RegExp(`${monthName} ${day}(st|nd|rd|th), ${yearText}`),
    })
  )
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(mobile(), "0803 123 4567")
  await pickBirth(user, FILLED.date_of_birth)
  await user.selectOptions(sex(), "Female")
  await user.selectOptions(marital(), "Married")
  await user.selectOptions(nationality(), "Nigerian")
  await user.type(address(), FILLED.home_address)
}

describe("Personal: loading and layout", () => {
  it("follows Stage2: photo first, required labels, placeholders, grid and keyboard order", async () => {
    const { user } = await open(loaded())

    expect(
      screen.getByRole("heading", { name: "Personal details" })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/JPG or PNG, max 2 MB/).previousElementSibling
    ).toHaveTextContent("Recent passport photograph *")
    expect(screen.getByText(/JPG or PNG, max 2 MB/)).toBeInTheDocument()
    expect(mobile()).toHaveAttribute("type", "tel")
    expect(mobile()).toHaveAttribute("placeholder", "803 123 4567")
    expect(screen.getByText("+234")).toBeInTheDocument()
    expect(birth()).toHaveTextContent("Select your date of birth")
    expect(address().tagName).toBe("TEXTAREA")
    for (const field of [mobile(), sex(), marital(), nationality(), address()])
      expect(field).toHaveAttribute("aria-required", "true")
    // A button may not carry aria-required (axe aria-allowed-attr); "required" is in its name instead.
    expect(birth()).toHaveAccessibleName(/^Date of birth.*required$/)
    expect(mobile().closest(".grid")).toHaveClass("grid", "sm:grid-cols-2")
    expect(nationality().closest("[data-slot=field]")).toHaveClass(
      "sm:col-span-2"
    )
    expect(
      within(sex())
        .getAllByRole("option")
        .map((o) => o.textContent)
    ).toEqual(["Select sex", "Male", "Female"])

    await user.tab()
    expect(
      screen.getByRole("button", { name: "Upload passport photo" })
    ).toHaveFocus()
    await user.tab()
    expect(mobile()).toHaveFocus()
    await user.tab()
    expect(
      screen.getByRole("button", { name: /Add secondary phone number/ })
    ).toHaveFocus()
    await user.tab()
    expect(birth()).toHaveFocus()
  })

  it("prefills the saved draft: +234 hidden, foreign numbers kept, unlisted values kept", async () => {
    await open(
      loaded({
        primary_phone: "+2348031234567",
        secondary_phone: "+442079460958",
        date_of_birth: "1988-04-12",
        sex: "Prefer not to say",
        marital_status: "Married",
        nationality: "Cameroonian",
        home_address: "12 Marina Road\nLagos",
        passport_photo: PHOTO_SAVED,
      }),
      IMAGE()
    )

    expect(mobile()).toHaveValue("8031234567")
    const secondary = screen.getByLabelText(/Secondary phone number/)
    expect(secondary).toHaveValue("+442079460958")
    // One +234 adornment: the primary's. A foreign number never shows it.
    expect(screen.getAllByText("+234")).toHaveLength(1)
    expect(secondary).not.toHaveAttribute("aria-required")
    expect(birth()).toHaveTextContent("12 April 1988")
    expect(birth()).toHaveAccessibleName(/Date of birth.*12 April 1988/)
    expect(sex()).toHaveValue("Prefer not to say")
    expect(marital()).toHaveValue("Married")
    expect(nationality()).toHaveValue("Other")
    expect(screen.getByLabelText(/Specify nationality/)).toHaveValue(
      "Cameroonian"
    )
    expect(address()).toHaveValue("12 Marina Road\nLagos")
    expect(
      screen.getByText(/Photo uploaded \(PNG, 1\.2 MB\)/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Replace passport photo" })
    ).toBeInTheDocument()
  })

  it("hides +234 as soon as an international number is typed", async () => {
    const { user } = await open(loaded())
    await user.type(mobile(), "+44 20")
    expect(screen.queryByText("+234")).toBeNull()
    await user.clear(mobile())
    expect(screen.getByText("+234")).toBeInTheDocument()
  })

  it("adds and removes the secondary number, moving focus with it", async () => {
    const { fetchMock, user } = await open(
      loaded({ secondary_phone: "+2348090000000" }),
      saved({ secondary_phone: null }, 2)
    )
    await user.click(
      screen.getByRole("button", { name: "Remove secondary phone number" })
    )
    expect(screen.queryByLabelText(/Secondary phone number/)).toBeNull()
    const add = screen.getByRole("button", {
      name: /Add secondary phone number/,
    })
    expect(add).toHaveFocus()

    await user.click(later())
    await screen.findByText(/Draft saved at/)
    expect(sent(patches(fetchMock)[0]).application.secondary_phone).toBeNull()

    await user.click(add)
    expect(screen.getByLabelText(/Secondary phone number/)).toHaveFocus()
  })
})

describe("Personal: validation", () => {
  it("Continue requires every field but the secondary phone, and the photo, sending nothing", async () => {
    const { fetchMock, user } = await open(loaded())
    await user.click(continueButton())

    for (const message of [
      "Passport photograph can't be blank",
      "Mobile number can't be blank",
      "Date of birth can't be blank",
      "Sex can't be blank",
      "Marital status can't be blank",
      "Nationality can't be blank",
      "Home address can't be blank",
    ])
      expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.queryByText(/Secondary phone number can't/)).toBeNull()
    expect(mobile()).toHaveAttribute("aria-invalid", "true")
    expect(mobile()).toHaveAttribute(
      "aria-describedby",
      "primary_phone-error phone-hint"
    )
    expect(patches(fetchMock)).toHaveLength(0)
  })

  it("Save later keeps a partial draft, sending blanks as null and the phone with +234", async () => {
    const { fetchMock, router, user } = await open(
      loaded(),
      saved({ primary_phone: "+2348031234567" }, 2)
    )
    await user.type(mobile(), "0803 123 4567")
    await user.click(later())

    expect(await screen.findByText(/Draft saved at/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/apply/personal")
    expect(sent(patches(fetchMock)[0])).toEqual({
      lock_version: 1,
      application: {
        primary_phone: "+2348031234567",
        secondary_phone: null,
        date_of_birth: null,
        sex: null,
        marital_status: null,
        nationality: null,
        home_address: null,
      },
    })
  })

  it("rejects invalid values even for a draft", async () => {
    const { fetchMock, user } = await open(loaded())
    await user.type(mobile(), "12")
    await user.click(later())

    expect(
      screen.getByText("Enter a valid mobile number, e.g. 803 123 4567")
    ).toBeInTheDocument()
    expect(patches(fetchMock)).toHaveLength(0)
  })

  it("picks the date of birth from the calendar, shows it in words and saves it as ISO", async () => {
    const { fetchMock, user } = await open(
      loaded(),
      saved({ date_of_birth: "1988-04-12" }, 2)
    )
    await pickBirth(user, "1988-04-12")

    expect(screen.queryByRole("dialog")).toBeNull()
    expect(birth()).toHaveTextContent("12 April 1988")
    expect(birth()).toHaveFocus()
    await user.click(later())
    await screen.findByText(/Draft saved at/)
    expect(sent(patches(fetchMock)[0]).application.date_of_birth).toBe(
      "1988-04-12"
    )
  })

  it("is keyboard-operable: opens on the chosen day, arrows move focus, Enter picks, Escape returns", async () => {
    const { user } = await open(loaded({ date_of_birth: "1988-04-12" }))
    expect(birth()).toHaveAccessibleName(
      /Date of birth.*12 April 1988.*required/
    )
    expect(birth()).not.toHaveAttribute("aria-required")
    birth().focus()
    await user.keyboard("{Enter}")
    const calendar = await screen.findByRole("dialog")
    expect(document.activeElement).toHaveAccessibleName(/April 12th, 1988/)

    await user.keyboard("{ArrowRight}{ArrowDown}")
    expect(document.activeElement).toHaveAccessibleName(/April 20th, 1988/)
    expect(calendar).toContainElement(document.activeElement as HTMLElement)
    await user.keyboard("{Enter}")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(birth()).toHaveTextContent("20 April 1988")

    await user.keyboard("{Enter}")
    await screen.findByRole("dialog")
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(birth()).toHaveFocus()
    expect(birth()).toHaveTextContent("20 April 1988")
  })

  it("offers only the dates Rails accepts: 1900 to yesterday in Lagos", async () => {
    // 23:30 UTC on the 21st is already the 22nd in Lagos, so the 21st is the last allowed day.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-21T23:30:00Z"))
    try {
      const { user } = await open(loaded())
      await user.click(birth())
      const calendar = await screen.findByRole("dialog")
      const years = within(
        within(calendar).getByRole("combobox", { name: /year/i })
      ).getAllByRole("option")
      expect(years[0]).toHaveTextContent("1900")
      expect(years.at(-1)).toHaveTextContent("2026")
      expect(
        within(calendar).getByRole("button", { name: /October 21st, 2026/ })
      ).toBeEnabled()
      expect(
        within(calendar).getByRole("button", { name: /October 22nd, 2026/ })
      ).toBeDisabled()
      await user.keyboard("{Escape}")
      expect(screen.queryByRole("dialog")).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("saves a nationality typed under Other", async () => {
    const { fetchMock, user } = await open(
      loaded(),
      saved({ nationality: "Cameroonian" }, 2)
    )
    await user.selectOptions(nationality(), "Other")
    await user.type(screen.getByLabelText(/Specify nationality/), "Cameroonian")
    await user.click(later())

    await screen.findByText(/Draft saved at/)
    expect(sent(patches(fetchMock)[0]).application.nationality).toBe(
      "Cameroonian"
    )
  })

  it("shows Rails' field errors under the fields, and anything else in an alert", async () => {
    const { user } = await open(loaded(), {
      path: PERSONAL,
      status: 422,
      body: {
        errors: {
          date_of_birth: ["is invalid"],
          lock_version: ["is required"],
        },
      },
    })
    await pickBirth(user, "1988-04-12")
    await user.click(later())

    expect(
      await screen.findByText("Date of birth is invalid")
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Some details couldn't be saved/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Draft saved/)).toBeNull()
  })
})

describe("Personal: saving", () => {
  it("Save & Continue sends the exact fields with the form's version, then moves on with Rails' progress", async () => {
    const { fetchMock, router, user } = await open(
      loaded({ passport_photo: PHOTO_SAVED }),
      IMAGE(),
      saved(
        { ...FILLED, passport_photo: PHOTO_SAVED },
        2,
        PERSONAL,
        { personal: "complete" },
        "next_of_kin"
      )
    )
    await fill(user)
    await user.click(continueButton())

    expect(
      await screen.findByRole("heading", { name: "Next of kin" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/apply/next_of_kin")
    const [call] = patches(fetchMock)
    expect(sent(call)).toEqual({ lock_version: 1, application: FILLED })
    expect(csrfHeader(call)).toBe("csrf-token-1")
    const steps = within(screen.getByRole("list")).getAllByRole("listitem")
    expect(steps[1]).toHaveTextContent("2. Personal (complete)")
  })

  it("Back goes to Employment", async () => {
    const { router, user } = await open(loaded())
    await user.click(screen.getByRole("link", { name: /Back/ }))
    expect(router.state.location.pathname).toBe("/apply/employment")
  })

  it("shows Saving…, disables every action and sends one request however often clicked", async () => {
    const { fetchMock, user } = await open(loaded(), saved({ sex: "Male" }, 2))
    const reply = fetchMock.getMockImplementation()!
    let release!: () => void
    fetchMock.mockImplementation(async (path, init) => {
      if (path === PERSONAL) await new Promise<void>((r) => (release = r))
      return reply(path, init)
    })
    await user.selectOptions(sex(), "Male")
    await user.click(later())

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled()
    expect(screen.getByRole("button", { name: /^Continue/ })).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Upload passport photo" })
    ).toBeDisabled()
    await user.dblClick(screen.getByRole("button", { name: "Saving…" }))
    await user.keyboard("{Enter}")
    await act(async () => release())
    await screen.findByText(/Draft saved at/)
    expect(patches(fetchMock)).toHaveLength(1)
  })

  it.each([
    [new TypeError("Failed to fetch"), "We couldn't reach the server."],
    [{ path: PERSONAL, status: 500 }, "Something went wrong on our side."],
  ])(
    "explains a failed save (%#) and keeps the values",
    async (reply, message) => {
      const { router, user } = await open(loaded(), reply)
      await user.selectOptions(sex(), "Male")
      await user.click(later())

      expect(await screen.findByRole("alert")).toHaveTextContent(message)
      expect(sex()).toHaveValue("Male")
      expect(router.state.location.pathname).toBe("/apply/personal")
    }
  )
})

describe("Personal: photo", () => {
  it("uploads on pick as multipart with the form's version, then saves text with Rails' new version", async () => {
    const { fetchMock, user } = await open(
      loaded(),
      saved({ passport_photo: PHOTO_SAVED }, 2, PHOTO),
      saved({ sex: "Male", passport_photo: PHOTO_SAVED }, 3)
    )
    await user.selectOptions(sex(), "Male")
    await user.upload(photoInput(), png())

    expect(
      await screen.findByText(/Photo uploaded \(PNG, 1\.2 MB\)/)
    ).toBeInTheDocument()
    // The confirmed file is the saved photo: shown at once, never downloaded again.
    expect((shownPhoto() as File).name).toBe("me.png")
    expect(photoGets(fetchMock)).toHaveLength(0)
    const [call] = uploads(fetchMock)
    const body = call[1]!.body as FormData
    expect(body.get("lock_version")).toBe("1")
    expect((body.get("photo") as File).name).toBe("me.png")
    expect(new Headers(call[1]!.headers).get("Content-Type")).toBeNull()
    expect(csrfHeader(call)).toBe("csrf-token-1")
    // The typed value survives the upload, and the next save uses the upload's version.
    expect(sex()).toHaveValue("Male")
    await user.click(later())
    await screen.findByText(/Draft saved at/)
    expect(sent(patches(fetchMock)[0]).lock_version).toBe(2)
  })

  it.each([
    [
      new File(["gif"], "me.gif", { type: "image/gif" }),
      "must be a JPG or PNG image",
    ],
    [png(2 * 1024 * 1024 + 1), "must be 2 MB or smaller"],
  ])(
    "rejects an unusable file (%#) without uploading",
    async (file, message) => {
      const { fetchMock, user } = await open(loaded())
      await user.upload(photoInput(), file)

      expect(
        screen.getByText(`Passport photograph ${message}`)
      ).toBeInTheDocument()
      expect(uploads(fetchMock)).toHaveLength(0)
    }
  )

  it("shows Uploading…, blocks saving meanwhile, and only says uploaded after Rails confirms", async () => {
    const { fetchMock, user } = await open(
      loaded(),
      saved({ passport_photo: PHOTO_SAVED }, 2, PHOTO)
    )
    const reply = fetchMock.getMockImplementation()!
    let release!: () => void
    fetchMock.mockImplementation(async (path, init) => {
      if (path === PHOTO) await new Promise<void>((r) => (release = r))
      return reply(path, init)
    })
    await user.upload(photoInput(), png())

    expect(screen.getByText("Uploading photo…")).toBeInTheDocument()
    expect(screen.queryByText(/Photo uploaded/)).toBeNull()
    expect(screen.getByRole("button", { name: "Uploading…" })).toBeDisabled()
    expect(later()).toBeDisabled()
    expect(continueButton()).toBeDisabled()
    await user.keyboard("{Enter}")
    await act(async () => release())
    expect(await screen.findByText(/Photo uploaded/)).toBeInTheDocument()
    expect(patches(fetchMock)).toHaveLength(0)
    expect(uploads(fetchMock)).toHaveLength(1)
  })

  it("shows Rails' photo error under the photo and keeps the previous one", async () => {
    const { user } = await open(
      loaded({ passport_photo: PHOTO_SAVED }),
      IMAGE(),
      {
        path: PHOTO,
        status: 422,
        body: { errors: { passport_photo: ["must be a JPG or PNG image"] } },
      }
    )
    await user.upload(photoInput(), png())

    expect(
      await screen.findByText("Passport photograph must be a JPG or PNG image")
    ).toBeInTheDocument()
    expect(screen.queryByText(/Some details couldn't be saved/)).toBeNull()
    expect(screen.getByText(/Photo uploaded \(PNG/)).toBeInTheDocument()
    expect(await (shownPhoto() as Blob).text()).toBe("saved-photo")
  })
})

describe("Personal: saved photo preview", () => {
  it("after a refresh or signing in again: loads the saved photo through the session, with a loading state", async () => {
    const fetchMock = stubFetch(
      SIGNED_IN,
      loaded({ passport_photo: PHOTO_SAVED }),
      IMAGE()
    )
    await renderRoute("/apply/personal")

    expect(
      await screen.findByRole("img", { name: "Loading your photo" })
    ).toBeInTheDocument()
    await waitFor(() => expect(preview()).toBeInTheDocument())
    expect(await (shownPhoto() as Blob).text()).toBe("saved-photo")
    const [call] = photoGets(fetchMock)
    expect(call[1]).toMatchObject({ credentials: "include" })
    expect(
      screen.getByText(/Photo uploaded \(PNG, 1\.2 MB\)/)
    ).toBeInTheDocument()
  })

  it("after Continue then Back: shows the photo again from memory, without downloading it again", async () => {
    const { fetchMock, user } = await open(
      loaded({ ...FILLED, passport_photo: PHOTO_SAVED }),
      IMAGE(),
      saved(
        { ...FILLED, passport_photo: PHOTO_SAVED },
        2,
        PERSONAL,
        { personal: "complete" },
        "next_of_kin"
      )
    )
    await waitFor(() => expect(preview()).toBeInTheDocument())
    await user.click(continueButton())
    await screen.findByRole("heading", { name: "Next of kin" })
    await user.click(screen.getByRole("link", { name: /Back/ }))

    await screen.findByLabelText(/^Mobile number/)
    expect(await (shownPhoto() as Blob).text()).toBe("saved-photo")
    expect(photoGets(fetchMock)).toHaveLength(1)
  })

  it("replacing the photo shows the new one and releases the old preview", async () => {
    const replaced = { ...PHOTO_SAVED, byte_size: 2048, checksum: "sum-2" }
    const { user } = await open(
      loaded({ passport_photo: PHOTO_SAVED }),
      IMAGE(),
      saved({ passport_photo: replaced }, 2, PHOTO)
    )
    await waitFor(() => expect(preview()).toBeInTheDocument())
    const oldUrl = preview()!.getAttribute("src")
    await user.upload(photoInput(), png(2048))

    await screen.findByText(/Photo uploaded \(PNG, 2 KB\)/)
    expect((shownPhoto() as File).name).toBe("me.png")
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(oldUrl)
  })

  it("explains a failed retrieval, keeps the saved state, and can try again", async () => {
    const { fetchMock, user } = await open(
      loaded({ passport_photo: PHOTO_SAVED }),
      { path: PHOTO, status: 500 },
      IMAGE()
    )
    expect(
      await screen.findByText("The preview couldn't be loaded.")
    ).toBeInTheDocument()
    expect(preview()).toBeNull()
    expect(screen.getByText(/Photo uploaded \(PNG/)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Replace passport photo" })
    ).toBeEnabled()

    await user.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(preview()).toBeInTheDocument())
    expect(photoGets(fetchMock)).toHaveLength(2)
  })

  it("never shows a photo answered for another sign-in (account switched mid-request), and rechecks /me", async () => {
    const { fetchMock } = await open(
      loaded({ passport_photo: PHOTO_SAVED }),
      IMAGE("2", "bolas-photo"),
      SIGNED_IN
    )
    expect(
      await screen.findByText(/You signed in to a different account/)
    ).toBeInTheDocument()
    expect(preview()).toBeNull()
    expect([...objectUrls.values()]).toHaveLength(0)
    expect(callsTo(fetchMock, ME, "GET").length).toBeGreaterThan(1)
  })

  it("a 401 while loading the photo ends the session and goes to login", async () => {
    const { router } = await open(
      loaded({ passport_photo: PHOTO_SAVED }),
      { path: PHOTO, ...SIGNED_OUT },
      { path: ME, ...SIGNED_OUT }
    )
    expect(
      await screen.findByRole("heading", { name: "Welcome back" })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/login")
  })
})

describe("Personal: conflicts and sessions", () => {
  it("switching sign-ins never carries one applicant's typed values or version into another's form", async () => {
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
    // Ada's draft, then a save answered for Bola (signed in elsewhere) sends this tab to Bola;
    // a later save answered for Ada sends it back, with Ada's application still cached.
    const fetchMock = stubFetch(
      { path: ME, ...SIGNED_IN },
      loaded({ sex: "Female" }, 1),
      asBola(saved({ sex: "Male" }, 9)),
      { path: ME, status: 200, body: { user: BOLA } },
      asBola(loaded({ sex: "Male" }, 9)),
      saved({ sex: "Female" }, 1),
      { path: ME, ...SIGNED_IN },
      loaded({ sex: "Female" }, 1)
    )
    await renderRoute("/apply/personal")
    const user = userEvent.setup()
    await waitFor(() => expect(sex()).toHaveValue("Female"))

    await user.selectOptions(marital(), "Married")
    await user.click(later())
    await waitFor(() => expect(sex()).toHaveValue("Male")) // now Bola's form
    expect(marital()).toHaveValue("") // Ada's typing didn't follow her

    await user.selectOptions(marital(), "Single")
    await user.click(later())
    await waitFor(() => expect(sex()).toHaveValue("Female")) // back to Ada's own saved draft
    expect(marital()).toHaveValue("")
    // Nothing was ever saved with the other applicant's version.
    expect(patches(fetchMock).map((call) => sent(call).lock_version)).toEqual([
      1, 9,
    ])
  })

  const STALE = (path: string) => ({
    path,
    status: 409,
    body: { error: "stale", application: { lock_version: 2 } },
  })

  it("a stale save keeps the typed values until Load latest, then saves with Rails' version", async () => {
    const { fetchMock, user } = await open(
      loaded({ sex: "Male" }),
      STALE(PERSONAL),
      loaded({ sex: "Female", marital_status: "Single" }, 2),
      saved({ sex: "Female", marital_status: "Single" }, 3)
    )
    await user.selectOptions(marital(), "Married")
    await user.click(later())

    expect(
      await screen.findByText(/changed in another tab or window/)
    ).toBeInTheDocument()
    expect(marital()).toHaveValue("Married")
    expect(patches(fetchMock)).toHaveLength(1)

    await user.click(
      screen.getByRole("button", { name: "Load latest saved version" })
    )
    expect(await screen.findByDisplayValue("Single")).toBe(marital())
    expect(sex()).toHaveValue("Female")
    await user.click(later())
    await screen.findByText(/Draft saved at/)
    expect(sent(patches(fetchMock)[1]).lock_version).toBe(2)
  })

  it("a stale photo upload offers Load latest too, and a failed reload keeps what was typed", async () => {
    const { user } = await open(
      loaded(),
      STALE(PHOTO),
      new TypeError("Failed to fetch")
    )
    await user.selectOptions(sex(), "Male")
    await user.upload(photoInput(), png())

    expect(
      await screen.findByText(/changed in another tab or window/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Photo uploaded/)).toBeNull()
    await user.click(
      screen.getByRole("button", { name: "Load latest saved version" })
    )
    expect(
      await screen.findByText(/We couldn't reach the server/)
    ).toBeInTheDocument()
    expect(sex()).toHaveValue("Male")
    expect(
      screen.getByRole("button", { name: "Load latest saved version" })
    ).toBeEnabled()
  })

  it("a background refetch never advances the form's version under unsaved edits", async () => {
    const { fetchMock, user } = await open(
      loaded({}, 1),
      loaded({ sex: "Female" }, 4),
      STALE(PERSONAL)
    )
    await user.selectOptions(sex(), "Male")
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await act(async () => {})
    await user.click(later())

    await screen.findByText(/changed in another tab or window/)
    expect(sent(patches(fetchMock)[0]).lock_version).toBe(1)
    expect(sex()).toHaveValue("Male")
  })

  it.each([PERSONAL, PHOTO])(
    "already_submitted on %s reloads into the read-only submitted screen",
    async (path) => {
      const { user } = await open(
        loaded(),
        {
          path,
          status: 409,
          body: { error: "already_submitted", application: {} },
        },
        SUBMITTED
      )
      if (path === PHOTO) await user.upload(photoInput(), png())
      else {
        await user.selectOptions(sex(), "Male")
        await user.click(later())
      }

      expect(
        await screen.findByRole("heading", { name: "Application submitted" })
      ).toBeInTheDocument()
      expect(screen.queryByRole("textbox")).toBeNull()
    }
  )

  it.each([PERSONAL, PHOTO])(
    "a 401 on %s ends the session and goes to login",
    async (path) => {
      const { router, user } = await open(
        loaded(),
        { path, ...SIGNED_OUT },
        { path: ME, ...SIGNED_OUT }
      )
      if (path === PHOTO) await user.upload(photoInput(), png())
      else {
        await user.selectOptions(sex(), "Male")
        await user.click(later())
      }

      expect(
        await screen.findByRole("heading", { name: "Welcome back" })
      ).toBeInTheDocument()
      expect(router.state.location.pathname).toBe("/login")
    }
  )

  it("a CSRF rejection on upload is explained, and the retry uses a fresh token", async () => {
    const { fetchMock, user } = await open(
      loaded(),
      { path: PHOTO, status: 403, body: { error: "invalid_csrf_token" } },
      saved({ passport_photo: PHOTO_SAVED }, 2, PHOTO)
    )
    await user.upload(photoInput(), png())
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't verify this request. Please try again."
    )
    await user.upload(photoInput(), png())
    await screen.findByText(/Photo uploaded/)
    expect(uploads(fetchMock).map(csrfHeader)).toEqual([
      "csrf-token-1",
      "csrf-token-2",
    ])
  })

  it("never caches or shows an upload answered for a different account, and rechecks /me", async () => {
    const other = saved(
      { nationality: "Bola's nationality", passport_photo: PHOTO_SAVED },
      9,
      PHOTO
    )
    other.body.applicant.email = "bola@example.com"
    const { fetchMock, user } = await open(loaded(), other, SIGNED_IN)
    await user.upload(photoInput(), png())

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You signed in to a different account in another window."
    )
    expect(screen.queryByText(/Photo uploaded/)).toBeNull()
    expect(
      screen.queryByRole("img", { name: "Your passport photograph" })
    ).toBeNull()
    expect(callsTo(fetchMock, ME, "GET").length).toBeGreaterThan(1)
    expect(callsTo(fetchMock, APP, "GET")).toHaveLength(1)
  })
})
