# Api::V1::Auth — member/applicant authentication

Responsibility: public registration, email verification, member sessions,
password recovery. Nothing here grants roles, membership or SAP IDs.

Constraints:
- Inherit `Api::V1::BaseController`. Keep actions thin; move multi-step logic
  to `app/services/auth/` only when it's genuinely complex.
- Strong params: never permit `role`, `sap_id`, `admin`, membership fields.
- Cookie sessions only (HttpOnly, DB-backed). Unsafe requests need CSRF + allowed Origin; GET never mutates.
- Never log passwords, codes, tokens or cookies. Use `rate_limit`.
- No placeholder endpoints — add a route only with its implementation and tests.

Read the spec for the increment you're implementing (only that one):
- Browser foundations (CSRF, cookies, origin) → `docs/auth/browser-foundations.md`
- Registration → `docs/auth/registration.md`
- Email verification → `docs/auth/email-verification.md`
- Sessions → `docs/auth/sessions.md`
- Password recovery → `docs/auth/password-recovery.md`

This file covers only this directory. When you touch models, mailers, jobs or
migrations for these features, the same spec applies there.
