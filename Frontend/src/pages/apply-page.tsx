import { useEffect, useState } from "react"
import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  CircleCheck,
  Info,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react"
import { Navigate, useNavigate, useParams } from "react-router"

import logo from "@/assets/bussco.png"
import {
  ApplicationLayout,
  StageProgress,
  STAGES,
  type Stage,
} from "@/components/application-layout"
import { SessionStatus } from "@/components/auth-layout"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  apiErrorMessage,
  applicationQuery,
  forgetSession,
  IdentityMismatch,
  meQuery,
  refetchApplicant,
  submitKey,
  revalidateIdentity,
  startApplication,
  type Me,
  type MembershipApplication,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { EmploymentForm } from "@/pages/apply-employment-form"
import { NextOfKinForm } from "@/pages/apply-next-of-kin-form"
import { PersonalForm } from "@/pages/apply-personal-form"
import { ReviewScreen } from "@/pages/apply-review"
import { SavingsForm } from "@/pages/apply-savings-form"
import { Actions, unauthenticated } from "@/pages/apply-stage-form"

const LOGO_ALT = "BUA Senior Staff Multipurpose Cooperative Society"
// Rails runs on Africa/Lagos time, so the applicant sees the date the cooperative recorded.
const SUBMITTED_DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})

// Stand-in key while /me hasn't answered; the application query is disabled until it does.
const SIGNED_OUT = { id: 0, email: "" }

// The signed-in applicant's own application. Authentication comes from the bussco_auth cookie via
// /me, the application only from Rails: never from router state or browser storage.
export function ApplyPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { stage: slug } = useParams()
  const me = useQuery(meQuery)
  // The user comes only from Rails' /me answer, never from the URL or router state.
  const user = me.data?.user ?? SIGNED_OUT
  // Celebrate only a submission this page made: not a reload, a status check or a later visit.
  const [mountedAt] = useState(Date.now)
  const justSubmitted =
    useMutationState({
      filters: {
        mutationKey: submitKey(user),
        predicate: ({ state }) =>
          state.status !== "error" && state.submittedAt >= mountedAt,
      },
    }).length > 0
  const application = useQuery({
    ...applicationQuery(user),
    enabled: !!me.data,
  })

  // Idempotent in Rails, so a repeat after a lost response just returns the same draft.
  const start = useMutation({
    mutationFn: () => startApplication(user),
    onSuccess: (data) => {
      queryClient.setQueryData(applicationQuery(user).queryKey, () => data)
      navigate("/apply/employment", { replace: true })
    },
  })

  // The session ended while this page was open: forget the user, which sends them to /login.
  const sessionEnded =
    unauthenticated(application.error) || unauthenticated(start.error)
  useEffect(() => {
    if (sessionEnded) forgetSession(queryClient)
  }, [sessionEnded, queryClient])

  // Rails answered for a different account (switched in another tab): ask who is signed in now.
  const identityChanged =
    application.error instanceof IdentityMismatch ||
    start.error instanceof IdentityMismatch
  useEffect(() => {
    if (identityChanged) revalidateIdentity(queryClient)
  }, [identityChanged, queryClient])

  if (me.data === null) return <Navigate to="/login" replace />
  if (me.data === undefined)
    return (
      <ApplicationLayout narrow>
        <SessionStatus me={me} />
      </ApplicationLayout>
    )
  // Kept data wins over a failed refetch, so a network error never blanks the page.
  if (application.data === undefined)
    return (
      <ApplicationLayout narrow>
        <SessionStatus me={application} label="Loading your application…" />
      </ApplicationLayout>
    )

  if (
    application.data?.applicant.membership_status === "awaiting_approval" ||
    application.data?.application.submitted_at
  )
    return <Submitted data={application.data} celebrate={justSubmitted} />

  const stage = STAGES.find((candidate) => candidate.key === slug)

  if (application.data === null) {
    if (slug && slug !== "employment") return <Navigate to="/apply" replace />
    return (
      <StageScreen stage={STAGES[0]} user={me.data.user}>
        <p className="text-sm text-gray-600">
          Your application has five short sections. Start now, and you can come
          back to it at any time.
        </p>
        <Actions stage={STAGES[0]}>
          <Button
            onClick={() => start.mutate()}
            disabled={start.isPending}
            size="lg"
            className="w-full sm:w-auto"
          >
            {start.isPending ? (
              "Starting…"
            ) : (
              <>
                Start application
                <ArrowRight aria-hidden className="size-[18px]" />
              </>
            )}
          </Button>
        </Actions>
        {start.isError && !sessionEnded && (
          <Alert variant="destructive" className="mt-4">
            <CircleAlert aria-hidden />
            <AlertDescription>{apiErrorMessage(start.error)}</AlertDescription>
          </Alert>
        )}
      </StageScreen>
    )
  }

  // Resume where Rails says the applicant stopped.
  if (!stage)
    return (
      <Navigate
        to={`/apply/${application.data.progress?.current_stage ?? "employment"}`}
        replace
      />
    )

  return (
    <StageScreen
      stage={stage}
      user={me.data.user}
      stages={application.data.progress?.stages}
    >
      {stage.key === "employment" ? (
        <EmploymentForm
          // A different sign-in always gets a fresh form: typed values and their lock_version never
          // carry over to another applicant's application.
          key={me.data.user.id}
          application={application.data}
          user={me.data.user}
        />
      ) : stage.key === "personal" ? (
        <PersonalForm
          key={me.data.user.id}
          application={application.data}
          user={me.data.user}
        />
      ) : stage.key === "next_of_kin" ? (
        <NextOfKinForm
          key={me.data.user.id}
          application={application.data}
          user={me.data.user}
        />
      ) : stage.key === "savings" ? (
        <SavingsForm
          key={me.data.user.id}
          application={application.data}
          user={me.data.user}
        />
      ) : (
        <ReviewScreen
          key={me.data.user.id}
          application={application.data}
          user={me.data.user}
        />
      )}
    </StageScreen>
  )
}

// Stage1–5.png: logo and verified pill, heading, progress, then the stage body.
function StageScreen({
  stage,
  user,
  stages,
  children,
}: {
  stage: Stage
  user: Me["user"]
  stages?: Record<string, "complete" | "incomplete">
  children: React.ReactNode
}) {
  return (
    <ApplicationLayout>
      <header className="mb-6 flex items-center justify-between gap-3 border-b border-gray-100 pb-5">
        <img src={logo} alt={LOGO_ALT} className="h-10 w-auto object-contain" />
        <p className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700">
          <CircleCheck aria-hidden className="size-4 text-green-700" />
          Email verified
        </p>
      </header>
      <h1 className="font-heading text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
        {stage.title}
      </h1>
      <p className="mt-2 text-sm text-gray-600">{stage.intro}</p>
      <div className="my-6">
        <StageProgress current={stage} stages={stages} />
      </div>
      {stage.key === "employment" && (
        <div className="mb-6 flex items-center gap-3 rounded-lg bg-muted p-4">
          <span
            aria-hidden
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gray-200 font-heading text-sm font-bold text-gray-700"
          >
            {initials(user.full_name)}
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-gray-900">{user.full_name}</p>
            <p className="flex items-center gap-1 truncate text-gray-600">
              {user.email}
              <BadgeCheck
                aria-label="Verified"
                className="size-4 shrink-0 text-primary"
              />
            </p>
          </div>
        </div>
      )}
      {children}
      <p className="mt-8 border-t border-gray-100 pt-5 text-center text-xs text-gray-500">
        Need assistance with your application?{" "}
        <span className="font-semibold text-gray-700">
          Contact Cooperative Support
        </span>
      </p>
    </ApplicationLayout>
  )
}

// Final-stage.png, aligned with Rails: no reference number (the API has none), no email promises
// (none are sent), and the account is already active, only member features wait for approval.
function Submitted({
  data,
  celebrate,
}: {
  data: MembershipApplication
  celebrate: boolean
}) {
  const queryClient = useQueryClient()
  // Both must answer before saying nothing changed; a failure keeps the last known details. The
  // application is cached under whoever /me says is signed in now, which another tab may have changed.
  const check = useMutation({
    mutationFn: () => refetchApplicant(queryClient),
  })
  const submittedAt = data.application.submitted_at

  return (
    <ApplicationLayout narrow>
      <div className="mb-5 flex justify-center border-b border-gray-100 pb-5 sm:mb-6 sm:pb-6">
        <img src={logo} alt={LOGO_ALT} className="h-12 w-auto object-contain" />
      </div>
      <div className="text-center">
        {/* A one-time entrance after a submission made here; static for reduced motion and every revisit. */}
        <span
          className={cn(
            "mx-auto mb-3 flex size-16 items-center justify-center rounded-2xl bg-green-50 sm:mb-4",
            celebrate &&
              "animate-in duration-300 zoom-in-90 fade-in motion-reduce:animate-none"
          )}
        >
          <CircleCheck aria-hidden className="size-9 text-green-700" />
        </span>
        {/* break-words: at very large text a word wider than the screen splits rather than scrolling. */}
        <h1 className="font-heading text-2xl font-bold tracking-tight break-words text-gray-900 sm:text-3xl">
          Application submitted
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-600 sm:text-base">
          We&apos;ve received your membership application. The cooperative will
          review your details.
        </p>
      </div>

      {/* px-[20px] = px-5 at normal size, but fixed so that enlarged text keeps the room. */}
      <div className="mt-6 rounded-lg border border-gray-200 bg-muted px-[20px] text-sm">
        <dl>
          {submittedAt && (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-gray-200 py-4">
              <dt className="min-w-0 font-heading text-xs font-semibold tracking-wide break-words text-gray-600 uppercase">
                Date submitted
              </dt>
              <dd className="min-w-0 font-semibold break-words text-gray-900">
                <time dateTime={submittedAt}>
                  {SUBMITTED_DATE.format(new Date(submittedAt))}
                </time>
              </dd>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-gray-200 py-4">
            <dt className="min-w-0 font-heading text-xs font-semibold tracking-wide break-words text-gray-600 uppercase">
              Current status
            </dt>
            {/* min-w-0 and max-w-full let the badge fit the row at very large text instead of overflowing. */}
            <dd className="min-w-0">
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full bg-amber-500"
                />
                <span className="min-w-0 break-words">Awaiting review</span>
              </span>
            </dd>
          </div>
        </dl>
        <p className="flex gap-2 py-4 text-gray-600">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          Your application is now with the cooperative for review.
        </p>
      </div>

      {/* gap/padding in px (same as gap-3 p-4) so enlarged text keeps the room, as in the panel above. */}
      <div className="mt-4 flex gap-[12px] rounded-lg border border-gray-200 p-[16px] text-sm">
        <LockKeyhole
          aria-hidden
          className="mt-0.5 size-5 shrink-0 text-primary"
        />
        <div className="min-w-0 break-words">
          <p className="font-semibold text-gray-900">
            Member features pending approval
          </p>
          <p className="mt-1 text-gray-600">
            Your BUSSCO account is active. Savings, loans and other member
            features become available once your membership is approved.
          </p>
        </div>
      </div>

      <Button
        onClick={() => check.mutate()}
        disabled={check.isPending}
        size="lg"
        // The label may wrap at large text; the button grows and never drops below 48px.
        className="mt-6 h-auto min-h-12 w-full py-3 whitespace-normal"
      >
        {check.isPending ? (
          <>
            <LoaderCircle
              aria-hidden
              className="size-[18px] animate-spin motion-reduce:animate-none"
            />
            Checking…
          </>
        ) : (
          "Check application status"
        )}
      </Button>
      {/* Changes re-render this page from the refreshed queries; only "no change" needs saying. */}
      <div
        role="status"
        aria-live="polite"
        className="mt-3 text-center text-sm"
      >
        {check.isSuccess && (
          <p className="text-gray-600">
            Your application is still awaiting review.
          </p>
        )}
      </div>
      {check.isError && !unauthenticated(check.error) && (
        <Alert variant="destructive" className="mt-3">
          <CircleAlert aria-hidden />
          <AlertDescription>{apiErrorMessage(check.error)}</AlertDescription>
        </Alert>
      )}
      <p className="mt-6 text-center text-xs text-gray-500">
        Need help? Contact Cooperative Support
      </p>
    </ApplicationLayout>
  )
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("")
}
