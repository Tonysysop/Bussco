import { ReceiptText } from "lucide-react"

import { STAGES } from "@/components/application-layout"
import { DatePicker } from "@/components/date-picker"
import { Field, FieldError } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import {
  type Me,
  type MembershipApplication,
  type SavingsFields,
} from "@/lib/api"
import {
  amountInWords,
  firstOfMonthInLagos,
  formatKobo,
  MAX_CONTRIBUTION_NAIRA,
  SAVINGS_LABELS,
  savingsErrors,
  toNaira,
} from "@/lib/validation"
import {
  type SaveAction,
  StageFooter,
  requiredLabel,
  useStageForm,
} from "@/pages/apply-stage-form"

// The amount is typed in naira; Rails' kobo is converted only when saving (savingsErrors).
const savingsValues = (saved: SavingsFields) => ({
  monthly_contribution:
    saved.monthly_contribution_kobo == null
      ? ""
      : formatKobo(saved.monthly_contribution_kobo),
  contribution_start_date: saved.contribution_start_date ?? "",
})

// Stage4.png. The minimum and the registration fee come from Rails' policy, never from this file.
export function SavingsForm({
  application,
  user,
}: {
  application: MembershipApplication
  user: Me["user"]
}) {
  const form = useStageForm({
    stage: STAGES[3],
    user,
    application,
    toValues: savingsValues,
    labels: SAVINGS_LABELS,
  })
  const { errors, fieldProps, describedBy } = form
  const { values } = form.draft
  const { minimum_monthly_contribution_kobo, registration_fee_kobo } =
    application.policy
  const naira = toNaira(values.monthly_contribution)
  const words =
    naira && naira <= MAX_CONTRIBUTION_NAIRA ? amountInWords(naira) : undefined
  // Rails accepts any month's 1st in a draft, but only next month's or later at submission.
  const earliest = firstOfMonthInLagos(1)

  function handleSave(action: SaveAction) {
    if (form.save.isPending) return
    form.submit(
      action,
      savingsErrors(
        values,
        action === "continue",
        minimum_monthly_contribution_kobo
      )
    )
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        handleSave("continue")
      }}
    >
      <div className="grid gap-6">
        <Field data-invalid={!!errors.monthly_contribution_kobo}>
          {requiredLabel(
            "monthly_contribution",
            "Proposed monthly contribution"
          )}
          <InputGroup className="h-12 bg-white">
            <InputGroupAddon aria-hidden>
              <InputGroupText className="font-semibold text-gray-700">
                ₦
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              {...fieldProps("monthly_contribution", {
                errorField: "monthly_contribution_kobo",
              })}
              aria-describedby={describedBy(
                "monthly_contribution_kobo",
                ["contribution-minimum", words && "amount-in-words"]
                  .filter(Boolean)
                  .join(" ")
              )}
              // Commas once typing stops, so the amount reads as it will be deducted.
              onBlur={() => {
                if (naira !== undefined)
                  // Keeps any error shown: only typing clears it.
                  form.update("monthly_contribution", formatKobo(naira * 100n))
              }}
              inputMode="numeric"
              autoComplete="off"
              placeholder="50,000"
              className="h-full text-base"
            />
          </InputGroup>
          <p id="contribution-minimum" className="text-xs text-gray-600">
            Minimum monthly contribution:{" "}
            <span className="font-semibold text-gray-900">
              ₦{formatKobo(minimum_monthly_contribution_kobo)}
            </span>
          </p>
          <FieldError id="monthly_contribution_kobo-error">
            {errors.monthly_contribution_kobo}
          </FieldError>
          {words && (
            <p id="amount-in-words" className="text-sm text-gray-600">
              Amount in words:{" "}
              <span className="font-semibold text-gray-900">{words}</span>
            </p>
          )}
        </Field>

        <Field data-invalid={!!errors.contribution_start_date}>
          {requiredLabel(
            "contribution_start_date",
            "Proposed contribution start date"
          )}
          <DatePicker
            {...fieldProps("contribution_start_date")}
            onChange={(value) => form.update("contribution_start_date", value)}
            aria-describedby={describedBy(
              "contribution_start_date",
              "start-date-hint"
            )}
            min={earliest}
            max={firstOfMonthInLagos(12)}
            firstOfMonth
            placeholder="Select the 1st of a month"
          />
          <p id="start-date-hint" className="text-xs text-gray-600">
            Contributions start on the 1st of a month, from next month.
          </p>
          <FieldError id="contribution_start_date-error">
            {errors.contribution_start_date}
          </FieldError>
        </Field>

        <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-muted p-4">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800"
          >
            <ReceiptText className="size-5" />
          </span>
          <div className="text-sm">
            <p className="font-heading font-semibold text-gray-900">
              One-time registration fee: ₦{formatKobo(registration_fee_kobo)}
            </p>
            <p className="text-gray-600">
              Separate from your monthly contribution. It isn&apos;t paid
              through this application.
            </p>
          </div>
        </div>

        <p className="text-sm text-gray-600">
          Once your membership is approved and payroll arrangements are in
          place, your monthly contribution will be deducted from your salary.
          Submitting this application doesn&apos;t start any deductions. Any
          future loan repayments are separate from your savings.
        </p>
      </div>

      <StageFooter form={form} onSave={handleSave} />
    </form>
  )
}
