import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CircleCheck,
  CircleUserRound,
  LoaderCircle,
  Plus,
  Upload,
  X,
} from "lucide-react"

import { STAGES } from "@/components/application-layout"
import { DatePicker } from "@/components/date-picker"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  apiErrorMessage,
  IdentityMismatch,
  passportPhotoQuery,
  useUploadPhoto,
  type Me,
  type MembershipApplication,
  type PersonalFields,
} from "@/lib/api"
import {
  EARLIEST_BIRTH_DATE,
  fromRailsPhone,
  PERSONAL_LABELS,
  personalErrors,
  photoProblem,
  todayInLagos,
  toRailsPhone,
  type PersonalField,
} from "@/lib/validation"
import {
  NativeSelect,
  OTHER,
  PhoneInput,
  type SaveAction,
  StageFooter,
  listedOrOther,
  railsFieldErrors,
  requiredLabel,
  useStageForm,
} from "@/pages/apply-stage-form"

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
  const [nationality, other_nationality] = listedOrOther(
    saved.nationality,
    NATIONALITIES
  )
  return {
    primary_phone: fromRailsPhone(saved.primary_phone),
    secondary_phone: fromRailsPhone(saved.secondary_phone),
    date_of_birth: saved.date_of_birth ?? "",
    sex: saved.sex ?? "",
    marital_status: saved.marital_status ?? "",
    nationality,
    other_nationality,
    home_address: saved.home_address ?? "",
  }
}

// An in-memory image: the object URL lives only while shown, and is revoked on change or unmount.
export function BlobImage({
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

export function PersonalForm({
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
          <PhoneInput
            {...fieldProps("primary_phone")}
            aria-describedby={describedBy("primary_phone", "phone-hint")}
          />
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
            <PhoneInput
              {...fieldProps("secondary_phone", { required: false })}
              aria-describedby={describedBy("secondary_phone", "phone-hint")}
              ref={secondaryInput}
              autoComplete="off"
            />
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
