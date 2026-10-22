import { Circle, CircleCheck } from "lucide-react"

import { FieldDescription } from "@/components/ui/field"
import { passwordRules } from "@/lib/validation"

// Live checklist under a new password (signup and reset), linked by id="password-hint".
// The 72-byte limit only appears once a long multibyte password breaks it.
export function PasswordRuleHints({ password }: { password: string }) {
  return (
    <FieldDescription id="password-hint" className="text-xs">
      {passwordRules
        .filter((rule, i) => i === 0 || !rule.test(password))
        .map((rule) => {
          const met = rule.test(password)
          const Icon = met ? CircleCheck : Circle
          return (
            <span
              key={rule.label}
              data-met={met}
              className="flex items-center gap-1.5 text-gray-500 data-[met=true]:text-green-700"
            >
              <Icon aria-hidden className="size-3.5 shrink-0" />
              {rule.label}
              <span className="sr-only">{met ? "(met)" : "(not met)"}</span>
            </span>
          )
        })}
    </FieldDescription>
  )
}
