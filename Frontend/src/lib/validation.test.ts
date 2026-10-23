import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  amountInWords,
  firstOfMonthInLagos,
  formatKobo,
  fromRailsPhone,
  nextOfKinErrors,
  personalErrors,
  photoProblem,
  savingsErrors,
  signupSchema,
  todayInLagos,
  toNaira,
  toRailsPhone,
} from "@/lib/validation"

const valid = {
  full_name: "Ada Obi",
  email: "ada@example.com",
  password: "correct horse battery",
}

function errors(input: Partial<typeof valid>) {
  const result = signupSchema.safeParse({ ...valid, ...input })
  return result.success ? {} : z.flattenError(result.error).fieldErrors
}

describe("signupSchema", () => {
  it("accepts a valid signup and normalizes name and email like Rails", () => {
    const result = signupSchema.parse({
      ...valid,
      full_name: "  Ada Obi  ",
      email: " Ada@Example.COM ",
    })
    expect(result).toEqual({ ...valid, full_name: "Ada Obi" })
  })

  it("never trims the password", () => {
    expect(
      signupSchema.parse({ ...valid, password: "  twelve chars  " }).password
    ).toBe("  twelve chars  ")
  })

  it("accepts exactly 12 characters and rejects 11", () => {
    expect(errors({ password: "x".repeat(12) })).toEqual({})
    expect(errors({ password: "x".repeat(11) })).toEqual({
      password: ["Password is too short (minimum is 12 characters)"],
    })
  })

  it("accepts 72 bytes and rejects 73", () => {
    expect(errors({ password: "x".repeat(72) })).toEqual({})
    expect(errors({ password: "x".repeat(73) })).toEqual({
      password: ["Password is too long (maximum is 72 bytes)"],
    })
  })

  it("counts Unicode characters for the minimum and UTF-8 bytes for the maximum", () => {
    expect(errors({ password: "€".repeat(24) })).toEqual({}) // 24 characters, 72 bytes
    expect(errors({ password: "€".repeat(25) }).password).toEqual([
      "Password is too long (maximum is 72 bytes)",
    ])
    expect(errors({ password: "😀".repeat(12) })).toEqual({}) // 12 code points, 24 UTF-16 units, 48 bytes
    expect(errors({ password: "😀".repeat(11) }).password).toEqual([
      "Password is too short (minimum is 12 characters)",
    ])
  })

  it("has no complexity rules", () => {
    expect(errors({ password: "aaaaaaaaaaaa" })).toEqual({})
  })

  it("rejects empty fields with Rails' messages", () => {
    expect(errors({ full_name: "", email: "", password: "" })).toEqual({
      full_name: ["Full name can't be blank"],
      email: ["Email can't be blank"],
      password: ["Password is too short (minimum is 12 characters)"],
    })
  })

  it("rejects a whitespace-only name, an over-long name and a malformed email", () => {
    expect(errors({ full_name: "   " }).full_name).toEqual([
      "Full name can't be blank",
    ])
    expect(errors({ full_name: "x".repeat(121) }).full_name).toEqual([
      "Full name is too long (maximum is 120 characters)",
    ])
    expect(errors({ full_name: "x".repeat(120) })).toEqual({})
    expect(errors({ email: "not-an-email" }).email).toEqual([
      "Email is invalid",
    ])
    expect(errors({ full_name: "😀".repeat(120) })).toEqual({}) // 120 characters, 240 UTF-16 units
  })

  it("accepts exactly the emails Rails' URI::MailTo::EMAIL_REGEXP accepts", () => {
    for (const email of [
      "a!b@example.com",
      "user@localhost",
      "o'brien@bua-group.com",
    ]) {
      expect(errors({ email })).toEqual({})
    }
    for (const email of ["a@b@c.com", "a b@example.com", "a@-example.com"]) {
      expect(errors({ email }).email).toEqual(["Email is invalid"])
    }
  })
})

describe("phone numbers", () => {
  it("adds +234 to Nigerian numbers, dropping a leading 0 and separators", () => {
    expect(toRailsPhone("803 123 4567")).toBe("+2348031234567")
    expect(toRailsPhone("0803-123-4567")).toBe("+2348031234567")
    expect(toRailsPhone("(0803) 123.4567")).toBe("+2348031234567")
  })

  it("keeps international numbers as typed and blanks blank", () => {
    expect(toRailsPhone("+44 20 7946 0958")).toBe("+442079460958")
    expect(toRailsPhone("   ")).toBe("")
  })

  it("shows a saved +234 number without the prefix, and anything else unchanged", () => {
    expect(fromRailsPhone("+2348031234567")).toBe("8031234567")
    expect(fromRailsPhone("+442079460958")).toBe("+442079460958")
    expect(fromRailsPhone("08031234567")).toBe("08031234567")
    expect(fromRailsPhone(null)).toBe("")
    expect(fromRailsPhone(undefined)).toBe("")
  })
})

describe("todayInLagos", () => {
  it("is already the next day in Lagos at 23:30 UTC (UTC+1)", () => {
    expect(todayInLagos(new Date("2026-10-21T22:59:59Z"))).toBe("2026-10-21")
    expect(todayInLagos(new Date("2026-10-21T23:00:00Z"))).toBe("2026-10-22")
    expect(todayInLagos(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01")
  })
})

describe("personalErrors", () => {
  const BLANK = {
    primary_phone: "",
    secondary_phone: "",
    date_of_birth: "",
    sex: "",
    marital_status: "",
    nationality: "",
    home_address: "",
  }
  const FILLED = {
    ...BLANK,
    primary_phone: "+2348031234567",
    date_of_birth: "1988-04-12",
    sex: "Female",
    marital_status: "Married",
    nationality: "Nigerian",
    home_address: "12 Marina Road\nLagos",
  }

  it("allows an empty draft, and requires everything but the secondary phone to continue", () => {
    expect(personalErrors(BLANK, false, false).errors).toEqual({})
    expect(
      Object.keys(personalErrors(BLANK, true, false).errors).sort()
    ).toEqual([
      "date_of_birth",
      "home_address",
      "marital_status",
      "nationality",
      "passport_photo",
      "primary_phone",
      "sex",
    ])
    expect(personalErrors(FILLED, true, true)).toEqual({
      errors: {},
      data: FILLED,
    })
  })

  it("requires the photo only to continue", () => {
    expect(personalErrors(FILLED, true, false).errors).toEqual({
      passport_photo: "Passport photograph can't be blank",
    })
    expect(personalErrors(FILLED, false, false).errors).toEqual({})
  })

  it("checks phones in Rails' format", () => {
    const errors = (primary_phone: string, secondary_phone = "") =>
      personalErrors({ ...BLANK, primary_phone, secondary_phone }, false, true)
        .errors
    expect(errors("+2348031234567")).toEqual({})
    expect(errors("1234567")).toEqual({})
    expect(errors("+123456")).toHaveProperty("primary_phone")
    expect(errors("+1234567890123456")).toHaveProperty("primary_phone")
    expect(errors("+234803abc4567")).toHaveProperty("primary_phone")
    expect(errors("", "+12")).toHaveProperty("secondary_phone")
  })

  it("accepts dates of birth from 1900-01-01 to yesterday in Lagos", () => {
    const error = (date_of_birth: string) =>
      personalErrors({ ...BLANK, date_of_birth }, false, true).errors
        .date_of_birth
    const today = todayInLagos()
    const yesterday = todayInLagos(new Date(Date.now() - 24 * 60 * 60 * 1000))
    expect(error("1900-01-01")).toBeUndefined()
    expect(error(yesterday)).toBeUndefined()
    expect(error(today)).toBe("Date of birth must be in the past")
    expect(error("1899-12-31")).toBe(
      "Date of birth must be on or after 1 January 1900"
    )
    expect(error("2001-02-29")).toBe("Enter a valid date of birth")
    expect(error("12/04/1988")).toBe("Enter a valid date of birth")
  })

  it("applies Rails' length and control-character rules, allowing line breaks only in the address", () => {
    const errors = (fields: Partial<typeof BLANK>) =>
      personalErrors({ ...BLANK, ...fields }, false, true).errors
    expect(
      errors({ sex: "x".repeat(30), nationality: "é".repeat(60) })
    ).toEqual({})
    expect(errors({ sex: "x".repeat(31) })).toHaveProperty("sex")
    expect(errors({ marital_status: "x".repeat(31) })).toHaveProperty(
      "marital_status"
    )
    expect(errors({ nationality: "x".repeat(61) })).toHaveProperty(
      "nationality"
    )
    expect(errors({ home_address: "x".repeat(301) })).toHaveProperty(
      "home_address"
    )
    expect(errors({ home_address: "1 Road\r\nLagos" })).toEqual({})
    expect(errors({ home_address: "1 Road\tLagos" })).toHaveProperty(
      "home_address"
    )
    expect(errors({ nationality: "Nige\nrian" })).toHaveProperty("nationality")
  })
})

describe("photoProblem", () => {
  const file = (type: string, size: number) =>
    new File([new Uint8Array(size)], "photo", { type })

  it("accepts JPG and PNG up to 2 MB", () => {
    expect(photoProblem(file("image/png", 2 * 1024 * 1024))).toBeUndefined()
    expect(photoProblem(file("image/jpeg", 10))).toBeUndefined()
    expect(photoProblem(file("image/png", 2 * 1024 * 1024 + 1))).toBe(
      "Passport photograph must be 2 MB or smaller"
    )
    expect(photoProblem(file("image/gif", 10))).toBe(
      "Passport photograph must be a JPG or PNG image"
    )
  })
})

describe("nextOfKinErrors", () => {
  const BLANK = {
    next_of_kin_name: "",
    next_of_kin_relationship: "",
    next_of_kin_phone: "",
    next_of_kin_address: "",
  }
  const FILLED = {
    next_of_kin_name: "Amina Bello",
    next_of_kin_relationship: "Sibling",
    next_of_kin_phone: "",
    next_of_kin_address: "14 Admiralty Way\nLagos",
  }
  const errors = (fields: Partial<typeof BLANK>, requireAll = false) =>
    nextOfKinErrors({ ...BLANK, ...fields }, requireAll).errors

  it("allows an empty draft, and requires everything but the phone to continue", () => {
    expect(errors({})).toEqual({})
    expect(Object.keys(errors({}, true)).sort()).toEqual([
      "next_of_kin_address",
      "next_of_kin_name",
      "next_of_kin_relationship",
    ])
    expect(nextOfKinErrors(FILLED, true)).toEqual({ errors: {}, data: FILLED })
  })

  it("applies Rails' limits: no line breaks in the name, 120/50/300 characters, a valid phone", () => {
    expect(
      errors({
        next_of_kin_name: "x".repeat(120),
        next_of_kin_relationship: "x".repeat(50),
      })
    ).toEqual({})
    expect(errors({ next_of_kin_name: "x".repeat(121) })).toHaveProperty(
      "next_of_kin_name"
    )
    expect(errors({ next_of_kin_name: "Amina\nBello" })).toHaveProperty(
      "next_of_kin_name"
    )
    expect(errors({ next_of_kin_relationship: "x".repeat(51) })).toHaveProperty(
      "next_of_kin_relationship"
    )
    expect(errors({ next_of_kin_address: "x".repeat(301) })).toHaveProperty(
      "next_of_kin_address"
    )
    expect(errors({ next_of_kin_phone: "+2348023456789" })).toEqual({})
    expect(errors({ next_of_kin_phone: "+12" })).toHaveProperty(
      "next_of_kin_phone"
    )
  })
})

describe("savings money", () => {
  it("reads whole naira with commas or spaces, and nothing else", () => {
    expect(toNaira("50,000")).toBe(50000n)
    expect(toNaira(" 50 000 ")).toBe(50000n)
    expect(toNaira("030000")).toBe(30000n)
    for (const typed of [
      "",
      "30000.50",
      "30,000.5",
      "-30000",
      "30k",
      "1e5",
      "₦30000",
    ])
      expect(toNaira(typed), typed).toBeUndefined()
  })

  it("formats kobo as naira without floating point", () => {
    expect(formatKobo(3_000_000)).toBe("30,000")
    expect(formatKobo(3_000_050)).toBe("30,000.50")
    expect(formatKobo(999_999_999_900n)).toBe("9,999,999,999")
  })

  it("writes the amount in words", () => {
    expect(amountInWords(50000n)).toBe("Fifty Thousand Naira Only")
    expect(amountInWords(30000n)).toBe("Thirty Thousand Naira Only")
    expect(amountInWords(1_250_019n)).toBe(
      "One Million Two Hundred Fifty Thousand Nineteen Naira Only"
    )
    expect(amountInWords(9_999_999_999n)).toBe(
      "Nine Billion Nine Hundred Ninety Nine Million Nine Hundred Ninety Nine Thousand Nine Hundred Ninety Nine Naira Only"
    )
  })

  it("finds month starts in Lagos across month and year ends", () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Lagos.
    const newYear = new Date("2026-12-31T23:30:00Z")
    expect(firstOfMonthInLagos(1, newYear)).toBe("2027-02-01")
    expect(firstOfMonthInLagos(12, new Date("2026-10-23T12:00:00Z"))).toBe(
      "2027-10-01"
    )
  })
})

describe("savingsErrors", () => {
  const now = new Date("2026-10-23T12:00:00Z")
  const MIN = 3_000_000
  const check = (
    monthly_contribution: string,
    contribution_start_date: string,
    requireAll: boolean
  ) =>
    savingsErrors(
      { monthly_contribution, contribution_start_date },
      requireAll,
      MIN,
      now
    )

  it("sends integer kobo as a string", () => {
    expect(check("35,000", "2026-11-01", true)).toEqual({
      errors: {},
      data: {
        monthly_contribution_kobo: "3500000",
        contribution_start_date: "2026-11-01",
      },
    })
  })

  it("holds the minimum from policy and the input limit", () => {
    expect(check("29,999", "", false).errors.monthly_contribution_kobo).toBe(
      "Monthly contribution must be at least ₦30,000"
    )
    expect(check("30,000", "", false).errors).toEqual({})
    expect(check("9,999,999,999", "", false).errors).toEqual({})
    expect(
      check("10,000,000,000", "", false).errors.monthly_contribution_kobo
    ).toBe("Monthly contribution can't be more than ₦9,999,999,999")
    expect(check("30000.50", "", false).errors.monthly_contribution_kobo).toBe(
      "Enter the amount in whole naira, e.g. 50,000"
    )
  })

  it("lets Save later keep a partial draft, Continue needs everything", () => {
    expect(check("", "", false)).toEqual({
      errors: {},
      data: { monthly_contribution_kobo: "", contribution_start_date: "" },
    })
    expect(check("", "", true).errors).toEqual({
      monthly_contribution_kobo: "Monthly contribution can't be blank",
      contribution_start_date: "Contribution start date can't be blank",
    })
  })

  it("needs next month's 1st or later only to continue", () => {
    expect(check("30,000", "2026-10-01", false).errors).toEqual({})
    expect(check("30,000", "2026-10-01", true).errors).toEqual({
      contribution_start_date:
        "Contribution start date must be 1 November 2026 or later",
    })
  })
})
