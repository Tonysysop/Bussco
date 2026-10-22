import { z } from "zod"

// Mirrors Backend/app/models/user.rb; Rails stays authoritative. Messages are Rails' full messages.
// Ruby counts characters as code points, hence [...password] rather than .length (UTF-16 units).
export const passwordRules = [
  {
    label: "At least 12 characters",
    message: "Password is too short (minimum is 12 characters)",
    test: (password: string) => [...password].length >= 12,
  },
  {
    label: "At most 72 bytes",
    message: "Password is too long (maximum is 72 bytes)",
    test: (password: string) => new TextEncoder().encode(password).length <= 72,
  },
]

export const passwordSchema = z.string().superRefine((password, ctx) => {
  for (const rule of passwordRules) {
    if (!rule.test(password))
      ctx.addIssue({ code: "custom", message: rule.message })
  }
})

export const signupSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(1, "Full name can't be blank")
    .refine(
      (name) => [...name].length <= 120,
      "Full name is too long (maximum is 120 characters)"
    ),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email can't be blank")
    .max(254, "Email is too long (maximum is 254 characters)")
    // html5Email is the WHATWG pattern, identical to Rails' URI::MailTo::EMAIL_REGEXP.
    .pipe(
      z.email({ pattern: z.regexes.html5Email, error: "Email is invalid" })
    ),
  password: passwordSchema,
})

export type SignupInput = z.input<typeof signupSchema>
export type SignupFields = keyof SignupInput

// No password rules at login: Rails alone decides whether a password matches.
export const loginSchema = z.object({
  email: signupSchema.shape.email,
  password: z.string().min(1, "Password can't be blank"),
})

export type LoginInput = z.input<typeof loginSchema>

export const verifyEmailSchema = z.object({
  email: signupSchema.shape.email,
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
})

// Rails only sees `password`; the confirmation is checked here alone.
export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirmation: z.string() })
  .refine((values) => values.password === values.confirmation, {
    path: ["confirmation"],
    message: "Passwords don't match",
  })

export type ResetPasswordInput = z.input<typeof resetPasswordSchema>

// Employment stage: mirrors MembershipApplication's rules (Backend/app/models/membership_application.rb).
// Blank is allowed for drafts; Save & Continue adds the required check (requireAll).
export const EMPLOYMENT_LABELS = {
  sap_staff_id: "SAP / Staff ID",
  business_unit: "Business unit",
  department: "Department",
  office_location: "Office address",
} as const

export type EmploymentField = keyof typeof EMPLOYMENT_LABELS

// Rails rejects control characters and counts length in characters (code points), as Ruby does.
const draftText = (field: EmploymentField, max: number) =>
  z
    .string()
    .trim()
    .refine(
      (value) => !/\p{Cc}/u.test(value),
      `${EMPLOYMENT_LABELS[field]} contains characters that aren't allowed`
    )
    .refine(
      (value) => [...value].length <= max,
      `${EMPLOYMENT_LABELS[field]} is too long (maximum is ${max} characters)`
    )

export const employmentSchema = z.object({
  sap_staff_id: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || /^[A-Za-z0-9/-]{1,30}$/.test(value),
      "SAP / Staff ID can only use letters, numbers, / and - (up to 30 characters)"
    ),
  business_unit: draftText("business_unit", 120),
  department: draftText("department", 120),
  office_location: draftText("office_location", 200),
})

export type EmploymentInput = z.input<typeof employmentSchema>

// Field errors for a stage save; requireAll adds "can't be blank" (Save & Continue only).
export function employmentErrors(input: EmploymentInput, requireAll: boolean) {
  const result = employmentSchema.safeParse(input)
  const errors: Partial<Record<EmploymentField, string>> = result.success
    ? {}
    : Object.fromEntries(
        Object.entries(z.flattenError(result.error).fieldErrors).map(
          ([field, messages]) => [field, messages?.[0]]
        )
      )
  if (requireAll)
    for (const field of Object.keys(EMPLOYMENT_LABELS) as EmploymentField[])
      if (!input[field].trim())
        errors[field] ??= `${EMPLOYMENT_LABELS[field]} can't be blank`
  return { errors, data: result.data }
}
