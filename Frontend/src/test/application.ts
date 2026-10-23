// Rails responses for the membership application pages (Backend/docs/membership/application.md).
export const ME = "/api/v1/auth/me"
export const APP = "/api/v1/membership/application"
export const EMPLOYMENT = `${APP}/stages/employment`
export const PERSONAL = `${APP}/stages/personal`
export const NEXT_OF_KIN = `${APP}/stages/next_of_kin`
export const SAVINGS = `${APP}/stages/savings`
export const SUBMISSION = `${APP}/submission`
export const PHOTO = `${APP}/passport_photo`

export const USER = {
  id: 1,
  full_name: "Ada Obi",
  email: "ada@example.com",
  email_verified: true,
  account_status: "active",
  membership_status: "not_started",
}
// Rails' policy block (MembershipApplication constants).
export const DECLARATION = {
  version: "draft-v1",
  text: "I confirm that the information provided in my membership application is accurate.",
  approved: false,
}
export const POLICY = {
  minimum_monthly_contribution_kobo: 3_000_000,
  registration_fee_kobo: 1_000_000,
  declaration: DECLARATION as typeof DECLARATION | null,
}

export const SIGNED_IN = { status: 200, body: { user: USER } }
export const SIGNED_OUT = { status: 401, body: { error: "unauthenticated" } }
export const NOT_STARTED = {
  path: APP,
  status: 404,
  body: { error: "not_found" },
}

// The GET/PATCH 200 body. `application` overrides saved fields, e.g. { department: "Finance" }.
export function draft(
  stages: Record<string, string> = {},
  current_stage = "employment",
  status = 200,
  application: Record<string, unknown> = {},
  path = APP
) {
  return {
    path,
    status,
    body: {
      application: { submitted_at: null, lock_version: 1, ...application },
      applicant: {
        full_name: "Ada Obi",
        email: USER.email,
        membership_status: "not_started",
      },
      progress: {
        stages: {
          employment: "incomplete",
          personal: "incomplete",
          next_of_kin: "incomplete",
          savings: "incomplete",
          ...stages,
        },
        current_stage,
        ready_to_submit: false,
        missing: {},
      },
      policy: POLICY,
    },
  }
}

// 23:30 UTC on the 21st is already the 22nd in Lagos (UTC+1).
export const SUBMITTED = {
  path: APP,
  status: 200,
  body: {
    application: { submitted_at: "2026-10-21T23:30:00Z", lock_version: 7 },
    applicant: {
      full_name: "Ada Obi",
      email: USER.email,
      membership_status: "awaiting_approval",
    },
    progress: null,
    policy: POLICY,
  },
}
