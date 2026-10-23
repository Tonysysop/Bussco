import { useState } from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query"
import {
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  CircleUserRound,
  PencilLine,
} from "lucide-react"
import { Link } from "react-router"

import { STAGES } from "@/components/application-layout"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  ApiError,
  apiErrorCode,
  apiErrorMessage,
  passportPhotoQuery,
  refetchApplicant,
  useSubmitApplication,
  type Me,
  type MembershipApplication,
} from "@/lib/api"
import {
  EMPLOYMENT_LABELS,
  formatIsoDate,
  formatKobo,
  NEXT_OF_KIN_LABELS,
  PERSONAL_LABELS,
  SAVINGS_LABELS,
} from "@/lib/validation"
import { BlobImage } from "@/pages/apply-personal-form"
import { Actions, unauthenticated } from "@/pages/apply-stage-form"

const LABELS: Record<string, string> = {
  ...EMPLOYMENT_LABELS,
  ...PERSONAL_LABELS,
  ...NEXT_OF_KIN_LABELS,
  ...SAVINGS_LABELS,
}

// The submission may have reached Rails even though no answer came back.
const uncertain = (error: Error | null) =>
  error instanceof TypeError ||
  (error instanceof ApiError &&
    error.status >= 500 &&
    apiErrorCode(error) !== "declaration_unavailable")

// Stage5.png, limited to what Rails stores (PRE-PRODUCTION D2, D3). The applicant submits exactly the
// snapshot shown: a background refetch never swaps the details or the lock_version under them.
export function ReviewScreen({
  application,
  user,
}: {
  application: MembershipApplication
  user: Me["user"]
}) {
  const queryClient = useQueryClient()
  const [shown, setShown] = useState(application)
  const [accepted, setAccepted] = useState(false)
  const submit = useSubmitApplication(user)

  // Shows Rails' latest draft; acceptance always starts again for details the applicant hasn't seen.
  function show(latest: MembershipApplication) {
    setShown(latest)
    setAccepted(false)
  }

  // Explicit only: the applicant asks, and only Rails' answer decides what is shown next.
  const check = useMutation({
    mutationFn: () => refetchApplicant(queryClient),
    onSuccess: (result) => {
      if (result?.user.id === user.id && result.application)
        show(result.application)
    },
  })

  const saved = shown.application
  const declaration = shown.policy.declaration
  const missing = shown.progress?.missing ?? {}
  const ready = !!shown.progress?.ready_to_submit
  const changed = application.application.lock_version !== saved.lock_version
  const canSubmit =
    accepted && ready && !!declaration && !changed && !submit.isPending

  function handleSubmit() {
    if (!canSubmit || !declaration) return
    check.reset()
    submit.mutate(
      { version: saved.lock_version, declaration: declaration.version },
      {
        onError: (error) => {
          // Rails refused, so nothing was submitted: reload what it has now, never resubmit.
          const code = apiErrorCode(error)
          if (
            code === "stale" ||
            code === "declaration_unavailable" ||
            (error instanceof ApiError && error.status === 422)
          )
            check.mutate()
        },
      }
    )
  }

  const photo = saved.passport_photo
  const photoImage = useQuery({
    ...passportPhotoQuery(user, photo?.checksum ?? ""),
    enabled: !!photo,
  })

  return (
    <div className="grid gap-5">
      {changed && (
        <Alert>
          <CircleAlert aria-hidden />
          <AlertDescription>
            <p>
              Your application was changed in another tab or window. Check the
              updated details before you submit.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => show(application)}
              className="mt-2"
            >
              Show updated details
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Section
        index={0}
        title="Employment details"
        missing={missing.employment}
      >
        <Details
          rows={[
            [EMPLOYMENT_LABELS.sap_staff_id, saved.sap_staff_id],
            [EMPLOYMENT_LABELS.business_unit, saved.business_unit],
            [EMPLOYMENT_LABELS.department, saved.department],
            [EMPLOYMENT_LABELS.office_location, saved.office_location],
          ]}
        />
      </Section>

      <Section index={1} title="Personal details" missing={missing.personal}>
        <div className="flex flex-col gap-5 sm:flex-row">
          <div className="flex w-24 shrink-0 flex-col items-center gap-1">
            {photoImage.data ? (
              <BlobImage
                blob={photoImage.data}
                alt="Your passport photograph"
                className="size-24 rounded-lg border border-gray-200 object-cover"
              />
            ) : (
              <span className="flex size-24 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-muted">
                <CircleUserRound
                  aria-hidden
                  className="size-10 text-gray-400"
                />
              </span>
            )}
            <span className="text-xs text-gray-600">
              {!photo
                ? "No photo"
                : photoImage.isError
                  ? "Couldn't load photo"
                  : "Photo"}
            </span>
          </div>
          <Details
            rows={[
              ["Full name", shown.applicant.full_name],
              [
                "Email address",
                <span className="inline-flex items-center gap-1">
                  {shown.applicant.email}
                  <BadgeCheck
                    aria-label="Verified"
                    className="size-4 shrink-0 text-primary"
                  />
                </span>,
              ],
              [PERSONAL_LABELS.primary_phone, saved.primary_phone],
              ...(saved.secondary_phone
                ? [
                    [
                      PERSONAL_LABELS.secondary_phone,
                      saved.secondary_phone,
                    ] as const,
                  ]
                : []),
              [
                PERSONAL_LABELS.date_of_birth,
                saved.date_of_birth && formatIsoDate(saved.date_of_birth),
              ],
              [PERSONAL_LABELS.sex, saved.sex],
              [PERSONAL_LABELS.marital_status, saved.marital_status],
              [PERSONAL_LABELS.nationality, saved.nationality],
              [PERSONAL_LABELS.home_address, saved.home_address, true],
            ]}
          />
        </div>
      </Section>

      <Section index={2} title="Next of kin" missing={missing.next_of_kin}>
        <Details
          rows={[
            ["Full name", saved.next_of_kin_name],
            [
              NEXT_OF_KIN_LABELS.next_of_kin_relationship,
              saved.next_of_kin_relationship,
            ],
            [
              NEXT_OF_KIN_LABELS.next_of_kin_phone,
              saved.next_of_kin_phone ?? "Not given (optional)",
            ],
            [
              NEXT_OF_KIN_LABELS.next_of_kin_address,
              saved.next_of_kin_address,
              true,
            ],
          ]}
        />
      </Section>

      <Section index={3} title="Contributions & fees" missing={missing.savings}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-muted p-4">
            <p className="text-xs font-semibold text-gray-600">
              Proposed monthly contribution
            </p>
            <p className="mt-1 font-heading text-2xl font-bold text-primary">
              {saved.monthly_contribution_kobo == null
                ? "Not provided"
                : `₦${formatKobo(saved.monthly_contribution_kobo)}`}
            </p>
            <p className="mt-1 text-xs text-gray-600">
              Deducted monthly through payroll once you&apos;re a member
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-muted p-4">
            <p className="text-xs font-semibold text-gray-600">
              One-time registration fee
            </p>
            <p className="mt-1 font-heading text-2xl font-bold text-gray-900">
              ₦{formatKobo(shown.policy.registration_fee_kobo)}
            </p>
            <p className="mt-1 text-xs text-gray-600">
              Separate from your monthly contribution. It isn&apos;t paid
              through this application.
            </p>
          </div>
        </div>
        <Details
          className="mt-4"
          rows={[
            [
              "Proposed contribution start date",
              saved.contribution_start_date &&
                formatIsoDate(saved.contribution_start_date),
            ],
          ]}
        />
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Deductions begin only after your membership is approved and payroll
          arrangements are in place. Submitting this application doesn&apos;t
          start any deductions. Any future loan repayments are separate from
          your savings.
        </p>
      </Section>

      <section
        aria-labelledby="declaration-heading"
        className="rounded-xl border border-gray-200 p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="declaration-heading"
            className="font-heading text-base font-bold text-gray-900"
          >
            Applicant declaration
          </h2>
          {declaration && !declaration.approved && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
              DRAFT — Pending Legal Approval
            </span>
          )}
        </div>
        {declaration ? (
          <>
            <p
              id="declaration-text"
              className="mt-3 text-sm leading-relaxed whitespace-pre-line text-gray-700"
            >
              {declaration.text}
            </p>
            <label className="mt-4 flex items-start gap-3 text-sm font-semibold text-gray-900">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
                aria-describedby="declaration-text"
                className="mt-0.5 size-4 shrink-0 accent-primary"
              />
              I have read and accept this declaration.
            </label>
          </>
        ) : (
          <p className="mt-3 text-sm text-gray-700">
            Submission isn&apos;t available yet: the membership declaration is
            awaiting approval. Your saved details are kept, and you can come
            back to submit later.
          </p>
        )}
      </section>

      {!ready && (
        <p className="text-sm font-semibold text-amber-900">
          Complete the sections marked incomplete before you submit.
        </p>
      )}

      <SubmitError error={submit.error} check={check} />

      <Actions stage={STAGES[4]}>
        <Button
          type="button"
          size="lg"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="w-full sm:w-auto"
        >
          {submit.isPending ? (
            "Submitting…"
          ) : (
            <>
              Submit application
              <ArrowRight aria-hidden className="size-[18px]" />
            </>
          )}
        </Button>
      </Actions>
    </div>
  )
}

// One numbered summary card with its Edit link, flagged when Rails says fields are missing.
function Section({
  index,
  title,
  missing = [],
  children,
}: {
  index: number
  title: string
  missing?: string[]
  children: React.ReactNode
}) {
  const stage = STAGES[index]
  const id = `review-${stage.key}`
  return (
    <section
      aria-labelledby={id}
      className={
        missing.length
          ? "rounded-xl border border-amber-300 p-5"
          : "rounded-xl border border-gray-200 p-5"
      }
    >
      {/* Wraps as a whole: on narrow screens Edit moves below the title instead of squeezing it. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2
          id={id}
          className="flex items-center gap-2 font-heading text-base font-bold text-gray-900"
        >
          <span
            aria-hidden
            className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-xs text-primary"
          >
            {index + 1}
          </span>
          {title}
        </h2>
        <Link
          to={`/apply/${stage.key}`}
          // A larger tap target (WCAG 2.5.8) with the text where it was; not to the right, where the
          // row ends.
          className="-my-2 -ml-2 inline-flex items-center gap-1 rounded py-2 pl-2 text-sm font-semibold text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <PencilLine aria-hidden className="size-4" />
          Edit<span className="sr-only"> {title.toLowerCase()}</span>
        </Link>
      </div>
      {missing.length > 0 && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="font-semibold">Incomplete:</span>{" "}
          {missing.map((field) => LABELS[field] ?? field).join(", ")}.
        </p>
      )}
      {children}
    </section>
  )
}

function Details({
  rows,
  className,
}: {
  rows: (readonly [string, React.ReactNode, boolean?])[]
  className?: string
}) {
  return (
    <dl className={`grid flex-1 gap-4 sm:grid-cols-2 ${className ?? ""}`}>
      {rows.map(([label, value, wide]) => (
        <div key={label} className={wide ? "sm:col-span-2" : undefined}>
          <dt className="text-xs font-semibold text-gray-600">{label}</dt>
          <dd className="mt-0.5 text-sm break-words whitespace-pre-line text-gray-900">
            {value || <span className="text-gray-500">Not provided</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

// Why the submission didn't go through, in plain words. Never says it succeeded: only Rails' answer,
// which replaces this screen with the submitted one, does that.
function SubmitError({
  error,
  check,
}: {
  error: Error | null
  check: UseMutationResult<unknown, Error, void>
}) {
  const code = error && apiErrorCode(error)
  // Handled elsewhere: 401 signs out, already_submitted shows the submitted screen.
  if (!error || unauthenticated(error) || code === "already_submitted")
    return null
  if (uncertain(error))
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertDescription>
          {check.isSuccess ? (
            <p>
              Your application hasn&apos;t been submitted yet. Check your
              details, accept the declaration and submit when you&apos;re ready.
            </p>
          ) : (
            <>
              <p>
                We couldn&apos;t confirm whether your application was submitted.
                Check its status before trying again.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => check.mutate()}
                disabled={check.isPending}
                className="mt-2"
              >
                {check.isPending ? "Checking…" : "Check application status"}
              </Button>
              {check.isError && !unauthenticated(check.error) && (
                <p className="mt-2">{apiErrorMessage(check.error)}</p>
              )}
            </>
          )}
        </AlertDescription>
      </Alert>
    )

  const missing =
    error instanceof ApiError &&
    !!(error.body as { missing?: object } | null)?.missing
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>
        {code === "stale"
          ? "Your application was changed in another tab or window, so it wasn't submitted. Check the updated details, accept the declaration again and submit."
          : code === "declaration_unavailable"
            ? "Submission isn't available yet: the membership declaration is awaiting approval. Nothing was submitted."
            : missing
              ? "Some sections are incomplete, so your application wasn't submitted. Complete the sections marked incomplete."
              : error instanceof ApiError && error.status === 422
                ? "The declaration has changed, so your application wasn't submitted. Read it, accept it again and submit."
                : code === "invalid_csrf_token"
                  ? "We couldn't verify this request. Please try again."
                  : apiErrorMessage(error)}
      </AlertDescription>
    </Alert>
  )
}
