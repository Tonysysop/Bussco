import { useState } from "react"

import { STAGES } from "@/components/application-layout"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  type Me,
  type MembershipApplication,
  type NextOfKinFields,
} from "@/lib/api"
import {
  fromRailsPhone,
  NEXT_OF_KIN_LABELS,
  nextOfKinErrors,
  toRailsPhone,
  type NextOfKinField,
} from "@/lib/validation"
import {
  NativeSelect,
  OTHER,
  PhoneInput,
  type SaveAction,
  StageFooter,
  listedOrOther,
  requiredLabel,
  useStageForm,
} from "@/pages/apply-stage-form"

// Stage3.png's options. Placeholders until an approved list exists (PRE-PRODUCTION D7); Rails stores
// any text, so "Other" saves what was typed.
const RELATIONSHIPS = ["Spouse", "Parent", "Sibling", "Child"]

type NextOfKinValues = Record<NextOfKinField, string> & {
  other_relationship: string
}

function nextOfKinValues(saved: NextOfKinFields): NextOfKinValues {
  const [next_of_kin_relationship, other_relationship] = listedOrOther(
    saved.next_of_kin_relationship,
    RELATIONSHIPS
  )
  return {
    next_of_kin_name: saved.next_of_kin_name ?? "",
    next_of_kin_relationship,
    other_relationship,
    next_of_kin_phone: fromRailsPhone(saved.next_of_kin_phone),
    next_of_kin_address: saved.next_of_kin_address ?? "",
  }
}

// Stage3.png. These fields describe someone else, so the browser is asked not to suggest or keep
// the applicant's own details here (autocomplete off).
export function NextOfKinForm({
  application,
  user,
}: {
  application: MembershipApplication
  user: Me["user"]
}) {
  const form = useStageForm({
    stage: STAGES[2],
    user,
    application,
    toValues: nextOfKinValues,
    labels: NEXT_OF_KIN_LABELS,
  })
  const { errors, fieldProps, describedBy } = form
  const { values } = form.draft
  const other = values.next_of_kin_relationship === OTHER
  // Rails' saved home address (Personal details), never one still being typed elsewhere.
  const home = application.application.home_address ?? ""
  // A one-time copy: ticked only while the address still matches it. Unticking keeps the text.
  const [copied, setCopied] = useState(
    () => !!home && values.next_of_kin_address === home
  )
  const sameAsHome = copied && !!home && values.next_of_kin_address === home

  function handleSave(action: SaveAction) {
    if (form.save.isPending) return
    const input = {
      next_of_kin_name: values.next_of_kin_name,
      next_of_kin_relationship: other
        ? values.other_relationship
        : values.next_of_kin_relationship,
      next_of_kin_phone: toRailsPhone(values.next_of_kin_phone),
      next_of_kin_address: values.next_of_kin_address,
    }
    form.submit(action, nextOfKinErrors(input, action === "continue"))
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        handleSave("continue")
      }}
    >
      <span id="phone-hint" className="sr-only">
        +234 is added for Nigerian numbers. For another country, start with +.
      </span>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field data-invalid={!!errors.next_of_kin_name}>
          {requiredLabel("next_of_kin_name", "Next of kin full name")}
          <Input
            {...fieldProps("next_of_kin_name")}
            autoComplete="off"
            placeholder="e.g. Amina Bello"
            className="h-12 bg-white px-3"
          />
          <FieldError id="next_of_kin_name-error">
            {errors.next_of_kin_name}
          </FieldError>
        </Field>

        <Field data-invalid={!!errors.next_of_kin_relationship && !other}>
          {requiredLabel("next_of_kin_relationship", "Relationship")}
          <NativeSelect
            {...fieldProps("next_of_kin_relationship")}
            aria-describedby={
              other ? undefined : describedBy("next_of_kin_relationship")
            }
            aria-invalid={
              errors.next_of_kin_relationship && !other ? true : undefined
            }
            placeholder="Select relationship"
            options={[...RELATIONSHIPS, OTHER]}
          />
          {!other && (
            <FieldError id="next_of_kin_relationship-error">
              {errors.next_of_kin_relationship}
            </FieldError>
          )}
        </Field>

        {other && (
          <Field
            data-invalid={!!errors.next_of_kin_relationship}
            className="sm:col-span-2"
          >
            {requiredLabel("other_relationship", "Specify relationship")}
            <Input
              {...fieldProps("other_relationship", {
                errorField: "next_of_kin_relationship",
              })}
              autoComplete="off"
              placeholder="e.g. Uncle, Aunt, Guardian"
              className="h-12 bg-white px-3"
            />
            <FieldError id="next_of_kin_relationship-error">
              {errors.next_of_kin_relationship}
            </FieldError>
          </Field>
        )}

        <Field
          data-invalid={!!errors.next_of_kin_phone}
          className="sm:col-span-2"
        >
          <FieldLabel
            htmlFor="next_of_kin_phone"
            className="font-heading font-semibold"
          >
            Contact phone number{" "}
            <span className="font-normal text-gray-500">(Optional)</span>
          </FieldLabel>
          <PhoneInput
            {...fieldProps("next_of_kin_phone", { required: false })}
            aria-describedby={describedBy("next_of_kin_phone", "phone-hint")}
            autoComplete="off"
          />
          <FieldError id="next_of_kin_phone-error">
            {errors.next_of_kin_phone}
          </FieldError>
        </Field>

        <Field
          data-invalid={!!errors.next_of_kin_address}
          className="sm:col-span-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            {requiredLabel(
              "next_of_kin_address",
              "Contact / Residential address"
            )}
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-800 has-disabled:text-gray-500">
              <input
                type="checkbox"
                checked={sameAsHome}
                disabled={!home}
                aria-describedby="same-address-note"
                onChange={(event) => {
                  if (event.target.checked)
                    form.update("next_of_kin_address", home)
                  setCopied(event.target.checked)
                }}
                className="size-4 accent-primary"
              />
              Same as my home address
            </label>
          </div>
          <Textarea
            {...fieldProps("next_of_kin_address")}
            rows={3}
            autoComplete="off"
            placeholder="e.g. 14 Admiralty Way, Lekki Phase 1, Lagos"
            className="bg-white px-3 text-base"
          />
          <p id="same-address-note" className="text-xs text-gray-600">
            {!home
              ? "To copy your home address, add it in Personal details first."
              : sameAsHome
                ? "Copied from your personal details. You can still edit it."
                : null}
          </p>
          <FieldError id="next_of_kin_address-error">
            {errors.next_of_kin_address}
          </FieldError>
        </Field>
      </div>

      <StageFooter form={form} onSave={handleSave} />
    </form>
  )
}
