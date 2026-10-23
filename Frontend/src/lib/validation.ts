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

// Rails rejects control characters (addresses may keep line breaks) and counts length in characters
// (code points), as Ruby does.
const draftText = (label: string, max: number, lineBreaks = false) =>
  z
    .string()
    .trim()
    .refine(
      (value) => !(lineBreaks ? /(?![\r\n])\p{Cc}/u : /\p{Cc}/u).test(value),
      `${label} contains characters that aren't allowed`
    )
    .refine(
      (value) => [...value].length <= max,
      `${label} is too long (maximum is ${max} characters)`
    )

export const employmentSchema = z.object({
  sap_staff_id: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || /^[A-Za-z0-9/-]{1,30}$/.test(value),
      "SAP / Staff ID can only use letters, numbers, / and - (up to 30 characters)"
    ),
  business_unit: draftText(EMPLOYMENT_LABELS.business_unit, 120),
  department: draftText(EMPLOYMENT_LABELS.department, 120),
  office_location: draftText(EMPLOYMENT_LABELS.office_location, 200),
})

export type EmploymentInput = z.input<typeof employmentSchema>

// Field errors for a stage save; requireAll adds "can't be blank" (Save & Continue only).
function stageErrors<S extends z.ZodObject<Record<string, z.ZodType<string>>>>(
  schema: S,
  labels: Record<string, string>,
  required: readonly (keyof z.input<S> & string)[],
  input: z.input<S>,
  requireAll: boolean
) {
  type Field = keyof z.input<S> & string
  const result = schema.safeParse(input)
  const errors: Partial<Record<Field, string>> = result.success
    ? {}
    : (Object.fromEntries(
        Object.entries(z.flattenError(result.error).fieldErrors).map(
          ([field, messages]) => [field, (messages as string[])[0]]
        )
      ) as Partial<Record<Field, string>>)
  if (requireAll)
    for (const field of required)
      if (!(input[field] as string).trim())
        errors[field] ??= `${labels[field]} can't be blank`
  return { errors, data: result.data as z.output<S> | undefined }
}

export const employmentErrors = (input: EmploymentInput, requireAll: boolean) =>
  stageErrors(
    employmentSchema,
    EMPLOYMENT_LABELS,
    Object.keys(EMPLOYMENT_LABELS) as EmploymentField[],
    input,
    requireAll
  )

// Personal stage. The photo is saved through its own endpoint, but Rails counts it in this stage.
export const PERSONAL_LABELS = {
  passport_photo: "Passport photograph",
  primary_phone: "Mobile number",
  secondary_phone: "Secondary phone number",
  date_of_birth: "Date of birth",
  sex: "Sex",
  marital_status: "Marital status",
  nationality: "Nationality",
  home_address: "Home address",
} as const

export type PersonalField = keyof typeof PERSONAL_LABELS

// Nigerian numbers are typed without +234 (a leading 0 is dropped); one starting with + is sent as
// typed. Rails strips the same separators before its own check.
export function toRailsPhone(typed: string) {
  const phone = typed.replace(/[\s().-]/g, "")
  if (!phone || phone.startsWith("+")) return phone
  return `+234${phone.replace(/^0/, "")}`
}

export const fromRailsPhone = (saved: string | null | undefined) =>
  saved?.startsWith("+234") ? saved.slice(4) : (saved ?? "")

const phone = (label: string) =>
  z
    .string()
    .refine(
      (value) => value === "" || /^\+?[0-9]{7,15}$/.test(value),
      `Enter a valid ${label.toLowerCase()}, e.g. 803 123 4567`
    )

// Rails runs on Africa/Lagos time, so "today" is the Lagos date.
export function todayInLagos(now = new Date()) {
  const part = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Africa/Lagos",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map(({ type, value }) => [type, value])
  )
  return `${part.year}-${part.month}-${part.day}`
}

// An ISO string that names a real day (2001-02-29 doesn't), as Rails requires.
const realDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)

export const EARLIEST_BIRTH_DATE = "1900-01-01"

export const personalSchema = z.object({
  primary_phone: phone(PERSONAL_LABELS.primary_phone),
  secondary_phone: phone(PERSONAL_LABELS.secondary_phone),
  date_of_birth: z
    .string()
    .refine((value) => value === "" || realDate(value), {
      message: "Enter a valid date of birth",
      abort: true,
    })
    .refine(
      (value) => value === "" || value < todayInLagos(),
      "Date of birth must be in the past"
    )
    .refine(
      (value) => value === "" || value >= EARLIEST_BIRTH_DATE,
      "Date of birth must be on or after 1 January 1900"
    ),
  sex: draftText(PERSONAL_LABELS.sex, 30),
  marital_status: draftText(PERSONAL_LABELS.marital_status, 30),
  nationality: draftText(PERSONAL_LABELS.nationality, 60),
  home_address: draftText(PERSONAL_LABELS.home_address, 300, true),
})

export type PersonalInput = z.input<typeof personalSchema>

const PERSONAL_REQUIRED = [
  "primary_phone",
  "date_of_birth",
  "sex",
  "marital_status",
  "nationality",
  "home_address",
] as const

// Phones must already be in Rails' form (toRailsPhone).
export function personalErrors(
  input: PersonalInput,
  requireAll: boolean,
  hasPhoto: boolean
) {
  const result = stageErrors(
    personalSchema,
    PERSONAL_LABELS,
    PERSONAL_REQUIRED,
    input,
    requireAll
  )
  const errors: Partial<Record<PersonalField, string>> = result.errors
  if (requireAll && !hasPhoto)
    errors.passport_photo = `${PERSONAL_LABELS.passport_photo} can't be blank`
  return { errors, data: result.data }
}

// Next of kin stage. The phone is optional; the address may keep line breaks.
export const NEXT_OF_KIN_LABELS = {
  next_of_kin_name: "Next of kin name",
  next_of_kin_relationship: "Relationship",
  next_of_kin_phone: "Contact phone number",
  next_of_kin_address: "Contact address",
} as const

export type NextOfKinField = keyof typeof NEXT_OF_KIN_LABELS

const nextOfKinSchema = z.object({
  next_of_kin_name: draftText(NEXT_OF_KIN_LABELS.next_of_kin_name, 120),
  next_of_kin_relationship: draftText(
    NEXT_OF_KIN_LABELS.next_of_kin_relationship,
    50
  ),
  next_of_kin_phone: phone(NEXT_OF_KIN_LABELS.next_of_kin_phone),
  next_of_kin_address: draftText(
    NEXT_OF_KIN_LABELS.next_of_kin_address,
    300,
    true
  ),
})

// The phone must already be in Rails' form (toRailsPhone).
export const nextOfKinErrors = (
  input: z.input<typeof nextOfKinSchema>,
  requireAll: boolean
) =>
  stageErrors(
    nextOfKinSchema,
    NEXT_OF_KIN_LABELS,
    ["next_of_kin_name", "next_of_kin_relationship", "next_of_kin_address"],
    input,
    requireAll
  )

// Savings stage. Rails stores whole kobo; the form takes whole naira, so kobo is the naira digits
// plus "00". Money stays in strings and BigInt, never floating point.
export const SAVINGS_LABELS = {
  monthly_contribution_kobo: "Monthly contribution",
  contribution_start_date: "Contribution start date",
} as const

type SavingsField = keyof typeof SAVINGS_LABELS

// An input limit, not cooperative policy (Rails' own bound is its bigint column).
export const MAX_CONTRIBUTION_NAIRA = 9_999_999_999n

// "50,000" or "50 000" → 50000n; undefined unless it is a whole number of naira.
export function toNaira(typed: string) {
  const digits = typed.replace(/[\s,]/g, "")
  return /^\d+$/.test(digits) ? BigInt(digits) : undefined
}

const NAIRA = new Intl.NumberFormat("en-NG")

// Kobo as naira digits: "30,000", or "30,000.50" for a saved value with kobo.
export function formatKobo(kobo: number | bigint) {
  const value = BigInt(kobo)
  const rest = value % 100n
  return (
    NAIRA.format(value / 100n) +
    (rest ? `.${String(rest).padStart(2, "0")}` : "")
  )
}

// The 1st of the month `months` after the current Lagos month, as an ISO date.
export function firstOfMonthInLagos(months: number, now = new Date()) {
  const [year, month] = todayInLagos(now).split("-").map(Number)
  const index = year * 12 + month - 1 + months
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`
}

const LONG_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

// Save later checks only a typed amount; Continue also needs both fields and a start that Rails
// will accept at submission (next month's 1st or later).
export function savingsErrors(
  input: { monthly_contribution: string; contribution_start_date: string },
  requireAll: boolean,
  minimumKobo: number,
  now = new Date()
) {
  const errors: Partial<Record<SavingsField, string>> = {}
  const typed = input.monthly_contribution.trim()
  const start = input.contribution_start_date
  const naira = toNaira(typed)
  const earliest = firstOfMonthInLagos(1, now)

  if (typed && naira === undefined)
    errors.monthly_contribution_kobo =
      "Enter the amount in whole naira, e.g. 50,000"
  else if (naira !== undefined && naira * 100n < BigInt(minimumKobo))
    errors.monthly_contribution_kobo = `Monthly contribution must be at least ₦${formatKobo(minimumKobo)}`
  else if (naira !== undefined && naira > MAX_CONTRIBUTION_NAIRA)
    errors.monthly_contribution_kobo = `Monthly contribution can't be more than ₦${formatKobo(MAX_CONTRIBUTION_NAIRA * 100n)}`

  if (requireAll) {
    if (!typed)
      errors.monthly_contribution_kobo = `${SAVINGS_LABELS.monthly_contribution_kobo} can't be blank`
    if (!start)
      errors.contribution_start_date = `${SAVINGS_LABELS.contribution_start_date} can't be blank`
    else if (start < earliest)
      errors.contribution_start_date = `Contribution start date must be ${LONG_DATE.format(new Date(`${earliest}T00:00:00Z`))} or later`
  }

  if (Object.keys(errors).length) return { errors }
  return {
    errors,
    data: {
      monthly_contribution_kobo: naira === undefined ? "" : `${naira}00`,
      contribution_start_date: start,
    },
  }
}

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
]
const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
]
const SCALES = ["", " Thousand", " Million", " Billion"]

// 50000n → "Fifty Thousand Naira Only", as Stage4.png writes it; up to MAX_CONTRIBUTION_NAIRA.
export function amountInWords(naira: bigint) {
  const groups: string[] = []
  for (let scale = 0; naira > 0n; scale++, naira /= 1000n) {
    const group = Number(naira % 1000n)
    if (!group) continue
    const rest = group % 100
    const words = [
      group >= 100 && `${ONES[Math.floor(group / 100)]} Hundred`,
      rest < 20
        ? ONES[rest]
        : `${TENS[Math.floor(rest / 10)]} ${ONES[rest % 10]}`.trim(),
    ]
    groups.unshift(words.filter(Boolean).join(" ") + SCALES[scale])
  }
  return `${groups.join(" ") || "Zero"} Naira Only`
}

// Quick feedback before uploading; Rails checks the file's real type from its first bytes.
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024

export function photoProblem(file: File) {
  if (!["image/jpeg", "image/png"].includes(file.type))
    return "Passport photograph must be a JPG or PNG image"
  if (file.size > PHOTO_MAX_BYTES)
    return "Passport photograph must be 2 MB or smaller"
}
