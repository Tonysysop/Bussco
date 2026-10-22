# BUSSCO — pending items before production

Everything below was found during increments F1.1–F2.1 and is **not done yet**. Clear every
**Blocker** before production and get a decision on every **Decision**. The others are known
limits or planned work: either accept them in writing or schedule them.

Last updated: 2026-10-22, after F2.1, on branch `feat/frontend-password-recovery`.

## Blockers: infrastructure and configuration
| # | Item | Source |
|---|---|---|
| B1 | **Durable background jobs.** Jobs run in-process (`:async`), so a restart can lose verification emails, password-reset emails and old-photo deletion. Switch to a persistent backend (e.g. Solid Queue) | `Backend/docs/auth/email-verification.md`, `Backend/docs/membership/application.md` |
| B2 | **Upload size cap at the reverse proxy.** `client_max_body_size 3m` for `/api/v1/membership/application/passport_photo`, `1m` for the rest of `/api/`. Without it a signed-in user can fill the disk before Rails rejects the file | `Backend/docs/membership/application.md` ("Production requirements") |
| B3 | **Persistent `storage/` volume**, included in backups (passport photos) | same |
| B4 | **HTTPS-only proxy setup:** TLS at the proxy; the app port reachable only through it; `Host` preserved and listed in `APP_HOSTS`; no rewritten `X-Forwarded-*` | `Backend/docs/auth/browser-foundations.md` |
| B5 | **Email delivery:** `RESEND_API_KEY` and `MAIL_FROM` set (boot fails without them), with a verified sender domain. Run the skipped manual test `Backend/test/manual/resend_delivery_test.rb` with `RESEND_TEST_TO` set, and send a real verification code and a real reset code end to end. Neither has been delivered to a real inbox in testing | `Backend/docs/auth/email-verification.md`; F1.4/F1.5 walkthroughs |
| B6 | **Approved membership declaration.** Production accepts only a version marked `approved: true` and reads `MEMBERSHIP_DECLARATION_VERSION` (no default). Until then **every submission returns 503**. `draft-v1` is "DRAFT — Pending Legal Approval" | `Backend/docs/membership/application.md` ("Declaration") |

## Decisions needed: product, legal and policy
| # | Item | Notes |
|---|---|---|
| D1 | **Per-IP login and registration rate limits on shared office networks.** Login allows 20 per 15 min per IP, registration 10. A whole office behind one IP can lock itself out at rollout (this was hit during testing). Password reset already uses 60 per IP for this reason | `Backend/docs/auth/email-verification.md` has a recommended layered strategy that is "not implemented — decide before the production rollout" |
| D2 | **Declaration wording** for the approved version (see B6). The Stage 5 design also shows a **second checkbox** (bye-laws, constitution, terms of membership) that has no backend field | F2.1 design review |
| D3 | **Fields in the Stage 5 Review design that the schema doesn't have:** job title or designation, date of employment or confirmation, work email address, next-of-kin email. Either drop them from the design or add them to the backend before F2.6 | F2.1 design review |
| D4 | **The registration fee in the Stage 5 design shows ₦5,000**, but Rails policy is **₦10,000** (`REGISTRATION_FEE_KOBO`). The UI must always render `policy.registration_fee_kobo`. Confirm which figure is correct | F2.1 design review |
| D5 | **Bye-laws text** (Stage 5 modal) has no approved source and promises "dashboard access" after approval. It needs approved copy | F2.1 design review |
| D6 | **Destinations for "Contact Cooperative Support", "View Bye-Laws", Terms, Privacy and Support Desk.** They are plain text everywhere because no destinations exist | All auth and application screens |
| D7 | **Dropdown allowlists** (business unit, sex, marital status, relationship) are not enforced in Rails. They should come from approved option lists | `Backend/docs/membership/application.md` ("Exclusions") |
| D9 | **Application reference numbers.** The designs show two formats ("BUSSCO-2026-08492" in `Stage5.html`, "APP-2025-08492" in `Final-stage.html`), but the API has no reference at all, so the UI shows none. Decide whether applicants need one; if so, Rails must generate it | Graphify design extraction, F2.1 |
| D8 | **Passport photo EXIF metadata** (possibly GPS location) is stored as uploaded. Stripping it needs `image_processing` plus libvips or ImageMagick | `Backend/docs/membership/application.md` ("Photo") |

## Planned work not built yet (the app is incomplete without it)
| # | Item | Planned in |
|---|---|---|
| P1 | **The stage forms.** Each stage page currently shows "The … section will be available here soon." | F2.2 Employment, F2.3 Personal (with photo), F2.4 Next of kin, F2.5 Savings |
| P2 | **Shared save, "Save and continue later", `lock_version` conflict handling (`409 stale`), autosave** | F2.2 |
| P3 | **Review, declaration acceptance, submission, and "View submitted application (Read-only)"** | F2.6 |
| P4 | **Logout UI** (member dashboard sidebar). It **must** call `forgetSession(queryClient)` from `Frontend/src/lib/api.ts` after `DELETE /api/v1/auth/session`, so no cached user or application outlives the session | Dashboard increment |
| P5 | **Membership approval, administrative review, member dashboard** (Rails has only `not_started` and `awaiting_approval`) | Later increments |
| P6 | **Authenticated password change** | Planned in `Backend/docs/auth/README.md` |

## Known limits and risks (accept or fix)
| # | Item | Detail |
|---|---|---|
| R1 | **Account switch in another tab during one request** | If the browser's session cookie changes (another tab signs in a different user) between `/me` answering and the application request answering, that one response is cached under the earlier user's id until it is next refetched. Signing out clears all cached applications, and the status check fetches `/me` first. Fully closing this needs Rails to return the user id with the application, so the frontend can check it |
| R2 | **Expired sessions are noticed only on interaction** | A tab left visible keeps showing the last page until the user focuses it again, navigates or makes a request. The server is still the authority. No data changes without a valid session |
| R3 | **Two tabs and CSRF** | After a login, logout or reset in one tab, the other tab's first request gets 403 "Your session expired. Please try again.", then fetches a new token. The code handles this, but it has no end-to-end test |
| R4 | **Bundle size** | The production JS is 539 kB (167 kB gzipped), and Vite warns about chunks over 500 kB. Consider route-level code splitting before the dashboard grows it |

## Verification still to do
| # | Item |
|---|---|
| V1 | **Real screen readers** (NVDA, VoiceOver, TalkBack). Only ARIA wiring, axe-core scans and keyboard order have been checked |
| V2 | **Real touch devices**: tactile button press feedback, OTP paste and autofill, the mobile keyboard on the code and password fields |
| V3 | **Full submission flow in a real browser** once F2.6 exists. Submission has only been exercised through `rails runner` in development |

## Repository housekeeping
| # | Item | Detail |
|---|---|---|
| H1 | **`design-reference/` is partly tracked in git** | Commit `8033e97` (#10) added 10 files under `design-reference/stitch/`, and `.gitignore` no longer ignores `/design-reference/` (working-copy change). The new `design-reference/Stage*` and `Final-stage*` files are untracked. If the folder should stay local, run `git rm -r --cached design-reference` and restore the ignore line. Note that ignoring it also removes those designs from the Graphify graph |
| H2 | **Graphify skips three recovery designs** | `Create-new-password.html`, `Forget-password.html` and `password-recovery.png` are skipped as "sensitive" because the filenames contain "password". Renaming them would include them in the graph |
| H3 | **Development-database test users** | The walkthroughs created users with emails `reset-walk-*`, `f15-*`, `f15-final-*` and `f21-*`, all `@example.com`. Development only. Delete them if they get in the way |
