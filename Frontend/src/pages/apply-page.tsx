import { useEffect, useRef, useState } from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query"
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleUserRound,
  Info,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Upload,
  X,
} from "lucide-react"
import { Link, Navigate, useNavigate, useParams } from "react-router"

import logo from "@/assets/bussco.png"
import {
  ApplicationLayout,
  StageProgress,
  STAGES,
  type Stage,
} from "@/components/application-layout"
import { SessionStatus } from "@/components/auth-layout"
import { DatePicker } from "@/components/date-picker"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Textarea } from "@/components/ui/textarea"
import {
  ApiError,
  apiErrorCode,
  apiErrorMessage,
  applicationQuery,
  forgetSession,
  IdentityMismatch,
  meQuery,
  passportPhotoQuery,
  revalidateIdentity,
  startApplication,
  useSaveStage,
  useUploadPhoto,
  type EmploymentFields,
  type Me,
  type MembershipApplication,
  type PersonalFields,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  EARLIEST_BIRTH_DATE,
  EMPLOYMENT_LABELS,
  employmentErrors,
  fromRailsPhone,
  PERSONAL_LABELS,
  personalErrors,
  photoProblem,
  todayInLagos,
  toRailsPhone,
  type EmploymentField,
  type PersonalField,
} from "@/lib/validation"

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

const unauthenticated = (error: Error | null) =>
  error instanceof ApiError && error.status === 401

// The signed-in applicant's own application. Authentication comes from the bussco_auth cookie via
// /me, the application only from Rails: never from router state or browser storage.
export function ApplyPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { stage: slug } = useParams()
  const me = useQuery(meQuery)
  // The user comes only from Rails' /me answer, never from the URL or router state.
  const user = me.data?.user ?? SIGNED_OUT
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
    return <Submitted data={application.data} />

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

  const next = STAGES[STAGES.indexOf(stage) + 1]
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
      ) : (
        <>
          {/* Each stage's form arrives in its own increment (F2.4–F2.6). */}
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-600">
            The {stage.label.toLowerCase()} section will be available here soon.
          </p>
          <StageLinks stage={stage} next={next} />
        </>
      )}
    </StageScreen>
  )
}

// Plain navigation for stages whose form isn't built yet.
function StageLinks({ stage, next }: { stage: Stage; next?: Stage }) {
  return (
    <Actions stage={stage}>
      {next && (
        <Link
          to={`/apply/${next.key}`}
          className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}
        >
          {next.key === "review" ? "Continue to review" : "Continue"}
          <ArrowRight aria-hidden className="size-[18px]" />
        </Link>
      )}
    </Actions>
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

// Back on the left, the primary action on the right; stacked with the primary on top below sm.
function Actions({
  stage,
  children,
}: {
  stage: Stage
  children?: React.ReactNode
}) {
  const previous = STAGES[STAGES.indexOf(stage) - 1]
  return (
    <div className="mt-8 flex flex-col-reverse gap-3 border-t border-gray-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
      {previous ? (
        <Link
          to={`/apply/${previous.key}`}
          className={cn(
            buttonVariants({ variant: "ghost", size: "lg" }),
            "w-full text-gray-700 sm:w-auto"
          )}
        >
          <ArrowLeft aria-hidden className="size-[18px]" />
          Back
        </Link>
      ) : (
        <span aria-hidden className="hidden sm:block" />
      )}
      {children}
    </div>
  )
}

// Final-stage.png, aligned with Rails: no reference number (the API has none), no email promises
// (none are sent), and the account is already active, only member features wait for approval.
function Submitted({ data }: { data: MembershipApplication }) {
  const queryClient = useQueryClient()
  // Both must answer before saying nothing changed; a failure keeps the last known details. The
  // application is cached under whoever /me says is signed in now, which another tab may have changed.
  const check = useMutation({
    mutationFn: async () => {
      const me = await queryClient.fetchQuery(meQuery)
      if (me) await queryClient.fetchQuery(applicationQuery(me.user))
    },
  })
  const submittedAt = data.application.submitted_at

  return (
    <ApplicationLayout narrow>
      <div className="mb-6 flex justify-center border-b border-gray-100 pb-6">
        <img src={logo} alt={LOGO_ALT} className="h-12 w-auto object-contain" />
      </div>
      <div className="text-center">
        <span className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-green-50">
          <CircleCheck aria-hidden className="size-9 text-green-700" />
        </span>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
          Application submitted
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-600 sm:text-base">
          We&apos;ve received your membership application. The cooperative will
          review your details.
        </p>
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 bg-muted px-5 text-sm">
        <dl>
          {submittedAt && (
            <div className="flex flex-col gap-1 border-b border-gray-200 py-4 sm:flex-row sm:items-center sm:justify-between">
              <dt className="font-heading text-xs font-semibold tracking-wide text-gray-600 uppercase">
                Date submitted
              </dt>
              <dd className="font-semibold text-gray-900">
                <time dateTime={submittedAt}>
                  {SUBMITTED_DATE.format(new Date(submittedAt))}
                </time>
              </dd>
            </div>
          )}
          <div className="flex flex-col gap-1 border-b border-gray-200 py-4 sm:flex-row sm:items-center sm:justify-between">
            <dt className="font-heading text-xs font-semibold tracking-wide text-gray-600 uppercase">
              Current status
            </dt>
            <dd>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                <span
                  aria-hidden
                  className="size-2 rounded-full bg-amber-500"
                />
                Awaiting review
              </span>
            </dd>
          </div>
        </dl>
        <p className="flex gap-2 py-4 text-gray-600">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          Your application is now with the cooperative for review.
        </p>
      </div>

      <div className="mt-4 flex gap-3 rounded-lg border border-gray-200 p-4 text-sm">
        <LockKeyhole
          aria-hidden
          className="mt-0.5 size-5 shrink-0 text-primary"
        />
        <div>
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
        className="mt-6 w-full"
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

type SaveAction = "later" | "continue"
type FieldErrors = Partial<Record<string, string>>

// Rails' 422 messages for the form's own fields, as sentences ("Mobile number is invalid").
function railsFieldErrors(
  error: Error,
  labels: Record<string, string>
): FieldErrors | undefined {
  if (!(error instanceof ApiError) || error.status !== 422) return
  const errors =
    (error.body as { errors?: Record<string, string[]> } | null)?.errors ?? {}
  return Object.fromEntries(
    Object.entries(errors)
      .filter(([field]) => field in labels)
      .map(([field, messages]) => [field, `${labels[field]} ${messages[0]}`])
  )
}

// The draft, save, Load latest and "Draft saved" state every stage form shares.
function useStageForm<Values extends Record<string, string>>({
  stage,
  user,
  application,
  toValues,
  labels,
  onReload,
}: {
  stage: Stage
  user: Me["user"]
  application: MembershipApplication
  toValues: (saved: MembershipApplication["application"]) => Values
  labels: Record<string, string>
  onReload?: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const save = useSaveStage(stage.key, user)
  // The values and the lock_version they were loaded with travel together: a background refetch
  // never advances the version under older, unsaved values.
  const [draft, setDraft] = useState(() => ({
    values: toValues(application.application),
    version: application.application.lock_version,
  }))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [savedAt, setSavedAt] = useState<Date>()
  const [pendingAction, setPendingAction] = useState<SaveAction>()

  // errorField: the field whose message this control shows (an "Other" box shows its select's).
  function update(field: keyof Values, value: string, errorField = field) {
    setDraft((current) => ({
      ...current,
      values: { ...current.values, [field]: value },
    }))
    if (errors[errorField as string])
      setErrors((current) => ({ ...current, [errorField]: undefined }))
  }

  // Only after Rails accepted a write made with the form's own version.
  const setVersion = (version: number) =>
    setDraft((current) => ({ ...current, version }))

  function submit(
    action: SaveAction,
    result: { errors: FieldErrors; data?: Record<string, string> }
  ) {
    if (Object.keys(result.errors).length || !result.data) {
      setErrors(result.errors)
      save.reset()
      return
    }
    setErrors({})
    setSavedAt(undefined)
    setPendingAction(action)
    // Blank fields are saved as NULL, which is how a draft field is cleared.
    const fields = Object.fromEntries(
      Object.entries(result.data).map(([field, value]) => [
        field,
        value || null,
      ])
    )
    save.mutate(
      { version: draft.version, fields },
      {
        onSuccess: (data) => {
          setVersion(data.application.lock_version)
          if (action === "continue")
            navigate(`/apply/${STAGES[STAGES.indexOf(stage) + 1].key}`)
          else setSavedAt(new Date())
        },
        onError: (error) => {
          const found = railsFieldErrors(error, labels)
          if (found) setErrors(found)
        },
      }
    )
  }

  // Explicit only: replaces the typed values with what Rails has saved, and their version. It
  // refetches the query the page watches, so a 401 or another account's answer is handled there
  // (sign-out, identity revalidation) and never lands in the form or the cache.
  const reload = useMutation({
    mutationFn: () => queryClient.fetchQuery(applicationQuery(user)),
    onSuccess: (latest) => {
      if (!latest) return
      setDraft({
        values: toValues(latest.application),
        version: latest.application.lock_version,
      })
      setErrors({})
      save.reset()
      onReload?.()
    },
  })

  const describedBy = (field: string, hint?: string) =>
    [errors[field] && `${field}-error`, hint].filter(Boolean).join(" ") ||
    undefined

  const fieldProps = (
    field: keyof Values & string,
    { errorField = field, required = true } = {}
  ) => ({
    id: field,
    name: field,
    value: draft.values[field],
    onChange: (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >
    ) => update(field, event.target.value, errorField),
    "aria-invalid": errors[errorField] ? true : undefined,
    "aria-required": required || undefined,
    "aria-describedby": describedBy(errorField),
  })

  return {
    stage,
    labels,
    draft,
    errors,
    setErrors,
    update,
    setVersion,
    submit,
    save,
    savedAt,
    pendingAction,
    reload,
    describedBy,
    fieldProps,
  }
}

type StageForm = Pick<
  ReturnType<typeof useStageForm>,
  "stage" | "labels" | "save" | "savedAt" | "pendingAction" | "reload"
>

const requiredLabel = (field: string, text: string) => (
  <FieldLabel
    id={`${field}-label`}
    htmlFor={field}
    className="font-heading font-semibold"
  >
    {text}{" "}
    <span aria-hidden className="text-primary">
      *
    </span>
  </FieldLabel>
)

const SELECT_CLASS =
  "h-12 w-full appearance-none rounded-lg border border-input bg-white pr-10 pl-3 text-base text-gray-900 accent-primary outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm"

// The phone's own picker; the burgundy chevron is the page's.
function NativeSelect({
  placeholder,
  options,
  ...props
}: React.ComponentProps<"select"> & {
  placeholder: string
  options: readonly string[]
}) {
  return (
    <div className="relative">
      <select {...props} className={SELECT_CLASS}>
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-primary"
      />
    </div>
  )
}

// "Draft saved", the save error and the Back / Save later / Continue row under every stage form.
function StageFooter({
  form,
  error = form.save.error,
  busy = form.save.isPending,
  onSave,
}: {
  form: StageForm
  error?: Error | null
  busy?: boolean
  onSave: (action: SaveAction) => void
}) {
  const { save, savedAt, pendingAction } = form
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        {/* Says "saved" only once Rails has confirmed it. */}
        <p
          role="status"
          aria-live="polite"
          className="flex items-center gap-1.5"
        >
          {savedAt && (
            <>
              <CircleCheck aria-hidden className="size-4 text-green-700" />
              Draft saved at{" "}
              {savedAt.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </>
          )}
        </p>
        <p>* Required information</p>
      </div>

      {error && (
        <StageSaveError
          error={error}
          reload={form.reload}
          labels={form.labels}
        />
      )}

      <Actions stage={form.stage}>
        <div className="flex w-full flex-col-reverse gap-3 sm:w-auto sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            disabled={busy}
            onClick={() => onSave("later")}
            className="w-full sm:w-auto"
          >
            {save.isPending && pendingAction === "later"
              ? "Saving…"
              : "Save and continue later"}
          </Button>
          <Button
            type="submit"
            size="lg"
            disabled={busy}
            className="w-full sm:w-auto"
          >
            {save.isPending && pendingAction === "continue" ? (
              "Saving…"
            ) : (
              <>
                Continue
                <ArrowRight aria-hidden className="size-[18px]" />
              </>
            )}
          </Button>
        </div>
      </Actions>
    </>
  )
}

// Stage1.png. Placeholder options until the approved list exists (PRE-PRODUCTION D7); Rails stores
// any text, so "Other" saves what was typed and a saved value outside the list reopens as "Other".
const BUSINESS_UNITS = [
  "BUA Cement Plc",
  "BUA Sugar Refinery",
  "BUA Foods",
  "BUA Ports & Terminals",
  "BUA Group Corporate HQ",
]
const OTHER = "Other"

type EmploymentValues = Record<EmploymentField, string> & {
  other_business_unit: string
}

function employmentValues(saved: EmploymentFields): EmploymentValues {
  const unit = saved.business_unit ?? ""
  const listed = unit === "" || BUSINESS_UNITS.includes(unit)
  return {
    sap_staff_id: saved.sap_staff_id ?? "",
    business_unit: listed ? unit : OTHER,
    other_business_unit: listed ? "" : unit,
    department: saved.department ?? "",
    office_location: saved.office_location ?? "",
  }
}

function EmploymentForm({
  application,
  user,
}: {
  application: MembershipApplication
  user: Me["user"]
}) {
  const form = useStageForm({
    stage: STAGES[0],
    user,
    application,
    toValues: employmentValues,
    labels: EMPLOYMENT_LABELS,
  })
  const { errors, fieldProps, describedBy } = form
  const { values } = form.draft
  const other = values.business_unit === OTHER

  function handleSave(action: SaveAction) {
    if (form.save.isPending) return
    const input = {
      sap_staff_id: values.sap_staff_id,
      business_unit: other ? values.other_business_unit : values.business_unit,
      department: values.department,
      office_location: values.office_location,
    }
    form.submit(action, employmentErrors(input, action === "continue"))
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        handleSave("continue")
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field data-invalid={!!errors.sap_staff_id}>
          {requiredLabel("sap_staff_id", "SAP / Staff ID")}
          <Input
            {...fieldProps("sap_staff_id")}
            autoComplete="off"
            placeholder="e.g. SAP-849201"
            className="h-12 bg-white px-3"
          />
          <FieldError id="sap_staff_id-error">{errors.sap_staff_id}</FieldError>
        </Field>

        <Field data-invalid={!!errors.business_unit && !other}>
          {requiredLabel("business_unit", "Business Unit")}
          <NativeSelect
            {...fieldProps("business_unit")}
            aria-describedby={other ? undefined : describedBy("business_unit")}
            aria-invalid={errors.business_unit && !other ? true : undefined}
            placeholder="Select business unit"
            options={[...BUSINESS_UNITS, OTHER]}
          />
          {!other && (
            <FieldError id="business_unit-error">
              {errors.business_unit}
            </FieldError>
          )}
        </Field>

        {other && (
          <Field
            data-invalid={!!errors.business_unit}
            className="sm:col-span-2"
          >
            {requiredLabel("other_business_unit", "Specify Business Unit Name")}
            <Input
              {...fieldProps("other_business_unit", {
                errorField: "business_unit",
              })}
              placeholder="Enter company or subsidiary name"
              className="h-12 bg-white px-3"
            />
            <FieldError id="business_unit-error">
              {errors.business_unit}
            </FieldError>
          </Field>
        )}

        <Field data-invalid={!!errors.department} className="sm:col-span-2">
          {requiredLabel("department", "Department")}
          <Input
            {...fieldProps("department")}
            placeholder="e.g. Finance & Accounts"
            className="h-12 bg-white px-3"
          />
          <FieldError id="department-error">{errors.department}</FieldError>
        </Field>

        <Field
          data-invalid={!!errors.office_location}
          className="sm:col-span-2"
        >
          {requiredLabel("office_location", "Office address / location")}
          <Input
            {...fieldProps("office_location")}
            autoComplete="street-address"
            placeholder="e.g. BUA Towers, 5 Churchgate Street, Victoria Island, Lagos"
            className="h-12 bg-white px-3"
          />
          <FieldError id="office_location-error">
            {errors.office_location}
          </FieldError>
        </Field>
      </div>

      <StageFooter form={form} onSave={handleSave} />
    </form>
  )
}

// Stage2.png's options. Placeholders until approved lists exist (PRE-PRODUCTION D7); Rails stores any
// text. Nationalities are demonyms, as Rails' own examples are ("Nigerian").
const SEXES = ["Male", "Female"]
const MARITAL_STATUSES = ["Single", "Married", "Divorced", "Widowed"]
const NATIONALITIES = ["Nigerian", "Ghanaian", "Kenyan", "South African"]

// A saved value outside the list stays selectable, so saving again never loses it.
const withSaved = (options: string[], value: string) =>
  value && !options.includes(value) ? [...options, value] : options

type PersonalValues = Record<
  Exclude<PersonalField, "passport_photo">,
  string
> & {
  other_nationality: string
}

function personalValues(saved: PersonalFields): PersonalValues {
  const nationality = saved.nationality ?? ""
  const listed = nationality === "" || NATIONALITIES.includes(nationality)
  return {
    primary_phone: fromRailsPhone(saved.primary_phone),
    secondary_phone: fromRailsPhone(saved.secondary_phone),
    date_of_birth: saved.date_of_birth ?? "",
    sex: saved.sex ?? "",
    marital_status: saved.marital_status ?? "",
    nationality: listed ? nationality : OTHER,
    other_nationality: listed ? "" : nationality,
    home_address: saved.home_address ?? "",
  }
}

// An in-memory image: the object URL lives only while shown, and is revoked on change or unmount.
function BlobImage({
  blob,
  ...props
}: { blob: Blob } & React.ComponentProps<"img">) {
  const image = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const url = URL.createObjectURL(blob)
    image.current!.src = url
    return () => URL.revokeObjectURL(url)
  }, [blob])
  return <img ref={image} {...props} />
}

const fileSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`

function PersonalForm({
  application,
  user,
}: {
  application: MembershipApplication
  user: Me["user"]
}) {
  const upload = useUploadPhoto(user)
  const form = useStageForm({
    stage: STAGES[1],
    user,
    application,
    toValues: personalValues,
    labels: PERSONAL_LABELS,
    onReload: () => upload.reset(),
  })
  const { errors, fieldProps, describedBy } = form
  const { values } = form.draft
  const busy = form.save.isPending || upload.isPending
  // Rails' record, not the draft: the photo is saved the moment it is picked.
  const photo = application.application.passport_photo
  const otherNationality = values.nationality === OTHER
  // The newest day Rails accepts: yesterday in Lagos.
  const [latestBirthDate] = useState(() =>
    todayInLagos(new Date(Date.now() - 24 * 60 * 60 * 1000))
  )

  // The saved photo, from Rails' identity-checked GET and held in memory only (passportPhotoQuery).
  const queryClient = useQueryClient()
  const savedPhoto = useQuery({
    ...passportPhotoQuery(user, photo?.checksum ?? ""),
    enabled: !!photo,
  })

  const fileInput = useRef<HTMLInputElement>(null)
  function pickPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = "" // so picking the same file again still uploads
    if (!file || busy) return
    const problem = photoProblem(file)
    form.setErrors((current) => ({ ...current, passport_photo: problem }))
    form.save.reset()
    upload.reset()
    if (problem) return
    upload.mutate(
      { version: form.draft.version, photo: file },
      {
        onSuccess: (data) => {
          // Safe to adopt: this write succeeded at the form's version, so nothing else came between.
          form.setVersion(data.application.lock_version)
          // Rails stores the bytes as sent, so the confirmed file is the saved photo: no download.
          const saved = data.application.passport_photo
          if (saved)
            queryClient.setQueryData(
              passportPhotoQuery(user, saved.checksum).queryKey,
              file
            )
        },
        onError: (error) => {
          const found = railsFieldErrors(error, PERSONAL_LABELS)
          if (found) form.setErrors((current) => ({ ...current, ...found }))
        },
      }
    )
  }

  // The secondary number appears on request; focus follows the toggle, but not on first render.
  const [showSecondary, setShowSecondary] = useState(!!values.secondary_phone)
  const secondaryInput = useRef<HTMLInputElement>(null)
  const addSecondary = useRef<HTMLButtonElement>(null)
  const toggled = useRef(false)
  useEffect(() => {
    if (!toggled.current) return
    ;(showSecondary ? secondaryInput : addSecondary).current?.focus()
  }, [showSecondary])
  function toggleSecondary(show: boolean) {
    toggled.current = true
    if (!show) form.update("secondary_phone", "")
    setShowSecondary(show)
  }

  function handleSave(action: SaveAction) {
    if (busy) return
    upload.reset()
    const input = {
      primary_phone: toRailsPhone(values.primary_phone),
      secondary_phone: toRailsPhone(values.secondary_phone),
      date_of_birth: values.date_of_birth,
      sex: values.sex,
      marital_status: values.marital_status,
      nationality: otherNationality
        ? values.other_nationality
        : values.nationality,
      home_address: values.home_address,
    }
    form.submit(action, personalErrors(input, action === "continue", !!photo))
  }

  // +234 is implied unless the number is typed in international form.
  const phoneInput = (
    field: "primary_phone" | "secondary_phone",
    props: React.ComponentProps<"input">
  ) => (
    <InputGroup className="h-12 bg-white">
      {!values[field].trim().startsWith("+") && (
        <InputGroupAddon aria-hidden>
          <InputGroupText className="font-semibold text-gray-700">
            +234
          </InputGroupText>
        </InputGroupAddon>
      )}
      <InputGroupInput
        {...fieldProps(field, { required: field === "primary_phone" })}
        aria-describedby={describedBy(field, "phone-hint")}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="803 123 4567"
        className="h-full"
        {...props}
      />
    </InputGroup>
  )

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        handleSave("continue")
      }}
    >
      <Field data-invalid={!!errors.passport_photo} className="mb-5">
        <div className="flex flex-wrap items-center gap-4 rounded-lg bg-muted p-4">
          <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-gray-300 bg-white">
            {photo && savedPhoto.data ? (
              <BlobImage
                blob={savedPhoto.data}
                alt="Your passport photograph"
                className="size-full object-cover"
              />
            ) : photo && savedPhoto.isPending ? (
              <LoaderCircle
                role="img"
                aria-label="Loading your photo"
                className="size-6 animate-spin text-gray-400 motion-reduce:animate-none"
              />
            ) : (
              <CircleUserRound aria-hidden className="size-8 text-gray-400" />
            )}
          </span>
          <div className="min-w-40 flex-1 text-sm">
            <p className="font-heading font-semibold text-gray-900">
              Recent passport{" "}
              <span className="whitespace-nowrap">
                photograph{" "}
                <span aria-hidden className="text-primary">
                  *
                </span>
              </span>
            </p>
            <p
              id="passport_photo-hint"
              className="mt-0.5 text-xs text-gray-600"
            >
              JPG or PNG, max 2 MB (plain background recommended)
            </p>
            {/* Says "uploaded" only from Rails' record of the saved photo. */}
            <p
              role="status"
              aria-live="polite"
              className="mt-1 flex items-center gap-1 text-xs font-semibold text-gray-700"
            >
              {upload.isPending ? (
                <>
                  <LoaderCircle
                    aria-hidden
                    className="size-4 animate-spin motion-reduce:animate-none"
                  />
                  Uploading photo…
                </>
              ) : (
                photo && (
                  <>
                    <CircleCheck
                      aria-hidden
                      className="size-4 text-green-700"
                    />
                    Photo uploaded (
                    {photo.content_type === "image/png" ? "PNG" : "JPG"},{" "}
                    {fileSize(photo.byte_size)})
                  </>
                )
              )}
            </p>
            {/* The photo is saved either way; only its preview couldn't be shown. */}
            {photo && savedPhoto.isError && (
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-gray-600">
                {savedPhoto.error instanceof IdentityMismatch
                  ? apiErrorMessage(savedPhoto.error)
                  : "The preview couldn't be loaded."}
                <button
                  type="button"
                  onClick={() => savedPhoto.refetch()}
                  className="rounded font-semibold text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  Try again
                </button>
              </p>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png"
            aria-label="Passport photograph file"
            hidden
            onChange={pickPhoto}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            aria-label={
              upload.isPending
                ? undefined
                : `${photo ? "Replace" : "Upload"} passport photo`
            }
            aria-describedby={describedBy(
              "passport_photo",
              "passport_photo-hint"
            )}
            className="w-full sm:w-auto"
          >
            <Upload aria-hidden className="size-4" />
            {upload.isPending
              ? "Uploading…"
              : `${photo ? "Replace" : "Upload"} photo`}
          </Button>
        </div>
        <FieldError id="passport_photo-error">
          {errors.passport_photo}
        </FieldError>
      </Field>

      <span id="phone-hint" className="sr-only">
        +234 is added for Nigerian numbers. For another country, start with +.
      </span>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field data-invalid={!!errors.primary_phone}>
          {requiredLabel("primary_phone", "Mobile number")}
          {phoneInput("primary_phone", {})}
          <FieldError id="primary_phone-error">
            {errors.primary_phone}
          </FieldError>
          {!showSecondary && (
            <button
              ref={addSecondary}
              type="button"
              onClick={() => toggleSecondary(true)}
              className="inline-flex items-center gap-1 self-start rounded text-xs font-semibold text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <Plus aria-hidden className="size-3.5" />
              Add secondary phone number
            </button>
          )}
        </Field>

        <Field data-invalid={!!errors.date_of_birth}>
          {requiredLabel("date_of_birth", "Date of birth")}
          <DatePicker
            {...fieldProps("date_of_birth")}
            onChange={(value) => form.update("date_of_birth", value)}
            min={EARLIEST_BIRTH_DATE}
            max={latestBirthDate}
            placeholder="Select your date of birth"
          />
          <FieldError id="date_of_birth-error">
            {errors.date_of_birth}
          </FieldError>
        </Field>

        {showSecondary && (
          <Field
            data-invalid={!!errors.secondary_phone}
            className="sm:col-start-1"
          >
            <div className="flex items-center justify-between gap-2">
              <FieldLabel
                htmlFor="secondary_phone"
                className="font-heading font-semibold"
              >
                Secondary phone number (optional)
              </FieldLabel>
              <button
                type="button"
                onClick={() => toggleSecondary(false)}
                aria-label="Remove secondary phone number"
                className="rounded p-1 text-gray-500 hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
            {phoneInput("secondary_phone", {
              ref: secondaryInput,
              autoComplete: "off",
            })}
            <FieldError id="secondary_phone-error">
              {errors.secondary_phone}
            </FieldError>
          </Field>
        )}

        <Field data-invalid={!!errors.sex} className="sm:col-start-1">
          {requiredLabel("sex", "Sex")}
          <NativeSelect
            {...fieldProps("sex")}
            placeholder="Select sex"
            options={withSaved(SEXES, values.sex)}
          />
          <FieldError id="sex-error">{errors.sex}</FieldError>
        </Field>

        <Field data-invalid={!!errors.marital_status}>
          {requiredLabel("marital_status", "Marital status")}
          <NativeSelect
            {...fieldProps("marital_status")}
            placeholder="Select status"
            options={withSaved(MARITAL_STATUSES, values.marital_status)}
          />
          <FieldError id="marital_status-error">
            {errors.marital_status}
          </FieldError>
        </Field>

        <Field
          data-invalid={!!errors.nationality && !otherNationality}
          className="sm:col-span-2"
        >
          {requiredLabel("nationality", "Nationality")}
          <NativeSelect
            {...fieldProps("nationality")}
            aria-describedby={
              otherNationality ? undefined : describedBy("nationality")
            }
            aria-invalid={
              errors.nationality && !otherNationality ? true : undefined
            }
            placeholder="Select nationality"
            options={[...NATIONALITIES, OTHER]}
          />
          {!otherNationality && (
            <FieldError id="nationality-error">{errors.nationality}</FieldError>
          )}
        </Field>

        {otherNationality && (
          <Field data-invalid={!!errors.nationality} className="sm:col-span-2">
            {requiredLabel("other_nationality", "Specify nationality")}
            <Input
              {...fieldProps("other_nationality", {
                errorField: "nationality",
              })}
              placeholder="e.g. Cameroonian"
              className="h-12 bg-white px-3"
            />
            <FieldError id="nationality-error">{errors.nationality}</FieldError>
          </Field>
        )}

        <Field data-invalid={!!errors.home_address} className="sm:col-span-2">
          {requiredLabel("home_address", "Home / Contact address")}
          <Textarea
            {...fieldProps("home_address")}
            rows={2}
            autoComplete="street-address"
            placeholder="e.g. 14 Admiralty Way, Lekki Phase 1, Lagos"
            className="bg-white px-3 text-base"
          />
          <FieldError id="home_address-error">{errors.home_address}</FieldError>
        </Field>
      </div>

      <StageFooter
        form={form}
        error={form.save.error ?? upload.error}
        busy={busy}
        onSave={handleSave}
      />
    </form>
  )
}

// What went wrong with a stage save, in plain words; shared by every stage form.
function StageSaveError({
  error,
  reload,
  labels,
}: {
  error: Error
  reload: UseMutationResult<unknown, Error, void>
  labels: Record<string, string>
}) {
  const code = apiErrorCode(error)
  // Handled elsewhere: 401 signs out, already_submitted reloads into the read-only screen, and a
  // 422 on a known field shows under that field.
  if (unauthenticated(error) || code === "already_submitted") return null
  const fieldOnly =
    error instanceof ApiError &&
    error.status === 422 &&
    Object.keys((error.body as { errors?: object } | null)?.errors ?? {}).every(
      (field) => field in labels
    )
  if (fieldOnly) return null

  return (
    <Alert variant="destructive" className="mt-4">
      <CircleAlert aria-hidden />
      <AlertDescription>
        {code === "stale" ? (
          <>
            <p>
              This application was changed in another tab or window, so your
              changes here weren&apos;t saved.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => reload.mutate()}
              disabled={reload.isPending}
              className="mt-2"
            >
              {reload.isPending ? "Loading…" : "Load latest saved version"}
            </Button>
            {/* Typed values stay; the button stays for another try. */}
            {reload.isError && !unauthenticated(reload.error) && (
              <p className="mt-2">{apiErrorMessage(reload.error)}</p>
            )}
          </>
        ) : code === "invalid_csrf_token" ? (
          "We couldn't verify this request. Please try again."
        ) : error instanceof ApiError && error.status === 422 ? (
          "Some details couldn't be saved. Check the form and try again."
        ) : (
          apiErrorMessage(error)
        )}
      </AlertDescription>
    </Alert>
  )
}
