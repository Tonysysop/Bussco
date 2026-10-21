import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  ArrowRight,
  Circle,
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
  Info,
  Lock,
  Mail,
  User,
} from "lucide-react"
import { useNavigate } from "react-router"
import { z } from "zod"

import { AuthLayout } from "@/components/auth-layout"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { ApiError, apiPost } from "@/lib/api"
import {
  passwordRules,
  signupSchema,
  type SignupFields,
  type SignupInput,
} from "@/lib/validation"

type FieldErrors = Partial<Record<SignupFields, string[]>>

// Rails' human attribute names, so a 422 reads like its full message ("Email has already been taken").
const RAILS_LABELS: Record<SignupFields, string> = {
  full_name: "Full name",
  email: "Email",
  password: "Password",
}

function errorState(error: Error): {
  fields: FieldErrors
  form: string | null
} {
  if (!(error instanceof ApiError)) {
    return {
      fields: {},
      form: "We couldn't reach the server. Check your connection and try again.",
    }
  }
  if (error.status === 422) {
    const fields: FieldErrors = {}
    const other: string[] = []
    const errors =
      (error.body as { errors?: Record<string, string[]> } | null)?.errors ?? {}
    for (const [key, messages] of Object.entries(errors)) {
      if (key in RAILS_LABELS) {
        const field = key as SignupFields
        fields[field] = messages.map(
          (message) => `${RAILS_LABELS[field]} ${message}`
        )
      } else {
        other.push(...messages)
      }
    }
    return { fields, form: other.length ? other.join(" ") : null }
  }
  if (error.status === 403)
    return { fields: {}, form: "Your session expired. Please try again." }
  if (error.status === 429) {
    const minutes = Math.ceil((error.retryAfter ?? 900) / 60)
    return {
      fields: {},
      form: `Too many attempts. Try again in ${minutes} minutes.`,
    }
  }
  return {
    fields: {},
    form: "Something went wrong on our side. Please try again.",
  }
}

export function SignupPage() {
  const navigate = useNavigate()
  const [values, setValues] = useState<SignupInput>({
    full_name: "",
    email: "",
    password: "",
  })
  // Zod errors from submit and Rails 422 field errors share one state, so editing a field can clear either.
  const [errors, setErrors] = useState<FieldErrors>({})
  const [showPassword, setShowPassword] = useState(false)

  const registration = useMutation({
    mutationFn: (user: SignupInput) =>
      apiPost("/api/v1/auth/registrations", { user }) as Promise<{
        user: { email: string }
      }>,
    onSuccess: ({ user }) =>
      navigate("/verify-email", { state: { email: user.email } }),
    onError: (error) => setErrors(errorState(error).fields),
  })

  const formError = registration.error && errorState(registration.error).form

  function update(field: SignupFields, value: string) {
    // Functional update: autofill fires several changes before React re-renders.
    setValues((current) => ({ ...current, [field]: value }))
    // Only re-check a field already showing an error, so typing never surfaces new ones early.
    // Each field's rules ignore the others, so a stale `values` is fine here.
    if (errors[field]) {
      const { error } = signupSchema.safeParse({ ...values, [field]: value })
      setErrors((current) => ({
        ...current,
        [field]: error && z.flattenError(error).fieldErrors[field],
      }))
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = signupSchema.safeParse(values)
    if (!result.success) {
      setErrors(z.flattenError(result.error).fieldErrors)
      registration.reset()
      return
    }
    setErrors({})
    registration.mutate(result.data)
  }

  const fieldProps = (field: SignupFields) => ({
    id: field,
    name: field,
    value: values[field],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      update(field, event.target.value),
    "aria-invalid": errors[field] ? true : undefined,
    "aria-required": true,
    "aria-describedby":
      [
        errors[field] && `${field}-error`,
        field !== "full_name" && `${field}-hint`,
      ]
        .filter(Boolean)
        .join(" ") || undefined,
    className: "h-full",
  })

  const errorList = (field: SignupFields) =>
    errors[field]?.map((message) => ({ message }))

  return (
    <AuthLayout>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-gray-900">
          Create your account
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Create your account, then apply for membership.
        </p>
      </div>

      <form noValidate onSubmit={handleSubmit}>
        <FieldGroup>
          {formError && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <Field data-invalid={!!errors.full_name}>
            <FieldLabel
              htmlFor="full_name"
              className="font-heading font-semibold"
            >
              Full Name{" "}
              <span aria-hidden className="text-primary">
                *
              </span>
            </FieldLabel>
            <InputGroup className="h-12 bg-white">
              <InputGroupAddon>
                <User aria-hidden className="size-5 text-gray-400" />
              </InputGroupAddon>
              <InputGroupInput
                {...fieldProps("full_name")}
                autoComplete="name"
                placeholder="As on payroll"
              />
            </InputGroup>
            <FieldError id="full_name-error" errors={errorList("full_name")} />
          </Field>

          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="email" className="font-heading font-semibold">
              Work Email Address{" "}
              <span aria-hidden className="text-primary">
                *
              </span>
            </FieldLabel>
            <InputGroup className="h-12 bg-white">
              <InputGroupAddon>
                <Mail aria-hidden className="size-5 text-gray-400" />
              </InputGroupAddon>
              <InputGroupInput
                {...fieldProps("email")}
                type="email"
                autoComplete="email"
                placeholder="name@buagroup.com"
              />
            </InputGroup>
            <FieldError id="email-error" errors={errorList("email")} />
            <FieldDescription
              id="email-hint"
              className="flex items-center gap-1.5 text-xs text-gray-500"
            >
              <Info aria-hidden className="size-4 shrink-0 text-primary" />
              We&apos;ll send a 6-digit code to verify this address.
            </FieldDescription>
          </Field>

          <Field data-invalid={!!errors.password}>
            <FieldLabel
              htmlFor="password"
              className="font-heading font-semibold"
            >
              Password{" "}
              <span aria-hidden className="text-primary">
                *
              </span>
            </FieldLabel>
            <InputGroup className="h-12 bg-white">
              <InputGroupAddon>
                <Lock aria-hidden className="size-5 text-gray-400" />
              </InputGroupAddon>
              <InputGroupInput
                {...fieldProps("password")}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-sm"
                  className="size-10"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((shown) => !shown)}
                >
                  {showPassword ? (
                    <Eye className="size-5" />
                  ) : (
                    <EyeOff className="size-5" />
                  )}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <FieldError id="password-error" errors={errorList("password")} />
            <FieldDescription id="password-hint" className="text-xs">
              {/* The 72-byte limit only appears once a long multibyte password breaks it. */}
              {passwordRules
                .filter((rule, i) => i === 0 || !rule.test(values.password))
                .map((rule) => {
                  const met = rule.test(values.password)
                  const Icon = met ? CircleCheck : Circle
                  return (
                    <span
                      key={rule.label}
                      data-met={met}
                      className="flex items-center gap-1.5 text-gray-500 data-[met=true]:text-green-700"
                    >
                      <Icon aria-hidden className="size-3.5 shrink-0" />
                      {rule.label}
                      <span className="sr-only">
                        {met ? "(met)" : "(not met)"}
                      </span>
                    </span>
                  )
                })}
            </FieldDescription>
          </Field>

          {/* Terms and Privacy pages don't exist yet, so they are plain text, not links. */}
          <p className="pt-1 text-center text-xs leading-relaxed text-gray-600">
            By creating an account, you agree to the Terms of Service and
            Privacy Policy.
          </p>

          <Button
            type="submit"
            disabled={registration.isPending}
            className="h-12 w-full gap-2 font-heading text-sm font-semibold tracking-wide hover:bg-[#85161c]"
          >
            {registration.isPending ? (
              "Creating account…"
            ) : (
              <>
                Create Account &amp; Continue
                <ArrowRight aria-hidden className="size-[18px]" />
              </>
            )}
          </Button>
        </FieldGroup>
      </form>

      {/* No login page yet; plain text rather than a link to nowhere. */}
      <div className="mt-6 border-t border-gray-100 pt-5 text-center text-sm text-gray-600">
        Already have an account? <span className="font-semibold">Sign in</span>
      </div>
    </AuthLayout>
  )
}
