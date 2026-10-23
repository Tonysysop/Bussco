import { useState } from "react"
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query"
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  CircleAlert,
  CircleCheck,
} from "lucide-react"
import { Link, useNavigate } from "react-router"

import { STAGES, type Stage } from "@/components/application-layout"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import {
  ApiError,
  apiErrorCode,
  apiErrorMessage,
  applicationQuery,
  useSaveStage,
  type Me,
  type MembershipApplication,
} from "@/lib/api"
import { cn } from "@/lib/utils"

export const unauthenticated = (error: Error | null) =>
  error instanceof ApiError && error.status === 401

// Back on the left, the primary action on the right; stacked with the primary on top below sm.
export function Actions({
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

export type SaveAction = "later" | "continue"
type FieldErrors = Partial<Record<string, string>>

// Rails' 422 messages for the form's own fields, as sentences ("Mobile number is invalid").
export function railsFieldErrors(
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
export function useStageForm<Values extends Record<string, string>>({
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

export const requiredLabel = (field: string, text: string) => (
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
export function NativeSelect({
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
export function StageFooter({
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
                {STAGES[STAGES.indexOf(form.stage) + 1].key === "review"
                  ? "Continue to review"
                  : "Continue"}
                <ArrowRight aria-hidden className="size-[18px]" />
              </>
            )}
          </Button>
        </div>
      </Actions>
    </>
  )
}

export const OTHER = "Other"

// A saved value outside the list reopens as "Other", with the text in the Other box.
export const listedOrOther = (
  saved: string | null | undefined,
  options: string[]
) => {
  const value = saved ?? ""
  return value === "" || options.includes(value) ? [value, ""] : [OTHER, value]
}

// +234 is implied unless the number is typed in international form (PRE-PRODUCTION D10).
export function PhoneInput(
  props: React.ComponentProps<"input"> & { value: string }
) {
  return (
    <InputGroup className="h-12 bg-white">
      {!props.value.trim().startsWith("+") && (
        <InputGroupAddon aria-hidden>
          <InputGroupText className="font-semibold text-gray-700">
            +234
          </InputGroupText>
        </InputGroupAddon>
      )}
      <InputGroupInput
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="803 123 4567"
        className="h-full"
        {...props}
      />
    </InputGroup>
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
