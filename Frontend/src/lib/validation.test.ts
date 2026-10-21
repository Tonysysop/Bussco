import { describe, expect, it } from "vitest"
import { z } from "zod"

import { signupSchema } from "@/lib/validation"

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
