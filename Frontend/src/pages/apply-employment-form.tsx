import { STAGES } from "@/components/application-layout"

import { Field, FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  type EmploymentFields,
  type Me,
  type MembershipApplication,
} from "@/lib/api"
import {
  EMPLOYMENT_LABELS,
  employmentErrors,
  type EmploymentField,
} from "@/lib/validation"
import {
  NativeSelect,
  OTHER,
  type SaveAction,
  StageFooter,
  listedOrOther,
  requiredLabel,
  useStageForm,
} from "@/pages/apply-stage-form"

// Stage1.png. Placeholder options until the approved list exists (PRE-PRODUCTION D7); Rails stores
// any text, so "Other" saves what was typed and a saved value outside the list reopens as "Other".
const BUSINESS_UNITS = [
  "BUA Cement Plc",
  "BUA Sugar Refinery",
  "BUA Foods",
  "BUA Ports & Terminals",
  "BUA Group Corporate HQ",
]

type EmploymentValues = Record<EmploymentField, string> & {
  other_business_unit: string
}

function employmentValues(saved: EmploymentFields): EmploymentValues {
  const [business_unit, other_business_unit] = listedOrOther(
    saved.business_unit,
    BUSINESS_UNITS
  )
  return {
    sap_staff_id: saved.sap_staff_id ?? "",
    business_unit,
    other_business_unit,
    department: saved.department ?? "",
    office_location: saved.office_location ?? "",
  }
}

export function EmploymentForm({
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
