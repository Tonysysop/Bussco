import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
  Lock,
} from "lucide-react"
import { Link } from "react-router"
import { z } from "zod"

import {
  AuthLayout,
  BackToSignIn,
  RECOVERY_INTRO,
} from "@/components/auth-layout"
import { PasswordRuleHints } from "@/components/password-rule-hints"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Field,
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
import { ApiError, apiErrorMessage, apiPatch, meQuery } from "@/lib/api"
import { cn } from "@/lib/utils"
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validation"

type Fields = keyof ResetPasswordInput
type Errors = Partial<Record<Fields, string[]>>

const errorBody = (error: Error) =>
  error instanceof ApiError && error.status === 422
    ? (error.body as {
        error?: string
        errors?: { password?: string[] }
      } | null)
    : null

export function ResetPasswordPage() {
  const queryClient = useQueryClient()
  const [values, setValues] = useState<ResetPasswordInput>({
    password: "",
    confirmation: "",
  })
  const [errors, setErrors] = useState<Errors>({})
  const [shown, setShown] = useState({ password: false, confirmation: false })

  // The reset authorization travels only in Rails' HttpOnly session cookie, set when the code
  // verified; Rails alone decides whether this request may change the password.
  const reset = useMutation({
    mutationFn: (password: string) =>
      apiPatch("/api/v1/auth/password_resets", { password }),
    // Rails revoked every login, this browser's included, and api.ts has adopted the rotated CSRF
    // token. A cached user would send /login straight on to /apply.
    onSuccess: () => {
      queryClient.setQueryData(meQuery.queryKey, () => null)
      setValues({ password: "", confirmation: "" })
    },
    // Rails' password rules failed: the authorization stays usable for another try.
    onError: (error) => {
      const password = errorBody(error)?.errors?.password
      if (password)
        setErrors({
          password: password.map((message) => `Password ${message}`),
        })
    },
  })

  if (reset.isSuccess)
    return (
      <AuthLayout intro={RECOVERY_INTRO}>
        {/* The form is gone, so announce the result. */}
        <div role="status" className="text-center">
          <CircleCheck
            aria-hidden
            className="mx-auto mb-4 size-10 text-green-700"
          />
          <h1 className="font-heading text-2xl font-bold tracking-tight text-gray-900">
            Password updated
          </h1>
          <p className="mt-2 mb-6 text-sm text-gray-600">
            You&apos;ve been signed out on every device. Sign in with your new
            password to continue.
          </p>
        </div>
        <Link
          to="/login"
          replace
          className={cn(buttonVariants({ size: "lg" }), "w-full")}
        >
          Go to Sign In
          <ArrowRight aria-hidden className="size-[18px]" />
        </Link>
      </AuthLayout>
    )

  if (reset.error && errorBody(reset.error)?.error === "invalid_reset_token")
    return (
      <AuthLayout intro={RECOVERY_INTRO}>
        {/* The form is gone, so announce why. */}
        <div role="alert" className="text-center">
          <CircleAlert
            aria-hidden
            className="mx-auto mb-4 size-10 text-destructive"
          />
          <h1 className="font-heading text-2xl font-bold tracking-tight text-gray-900">
            Your password reset session has expired or is no longer valid.
          </h1>
          <p className="mt-2 mb-6 text-sm text-gray-600">
            Request a new verification code to reset your password.
          </p>
        </div>
        <Link
          to="/forgot-password"
          className={cn(buttonVariants({ size: "lg" }), "w-full")}
        >
          Request New Code
          <ArrowRight aria-hidden className="size-[18px]" />
        </Link>
        <BackToSignIn />
      </AuthLayout>
    )

  const formError =
    reset.error && !errorBody(reset.error) && apiErrorMessage(reset.error)

  function update(field: Fields, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    if (errors[field])
      setErrors((current) => ({ ...current, [field]: undefined }))
  }

  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reset.isPending) return
    const result = resetPasswordSchema.safeParse(values)
    if (!result.success) {
      setErrors(z.flattenError(result.error).fieldErrors)
      reset.reset()
      return
    }
    setErrors({})
    reset.mutate(result.data.password)
  }

  const passwordField = (field: Fields, label: string, hint?: string) => (
    <Field data-invalid={!!errors[field]}>
      <div className="flex items-baseline justify-between">
        <FieldLabel htmlFor={field} className="font-heading font-semibold">
          {label}
        </FieldLabel>
        {hint && (
          <span aria-hidden className="text-xs text-gray-500">
            {hint}
          </span>
        )}
      </div>
      <InputGroup className="h-12 bg-white">
        <InputGroupAddon>
          <Lock aria-hidden className="size-5 text-gray-400" />
        </InputGroupAddon>
        <InputGroupInput
          id={field}
          name={field}
          type={shown[field] ? "text" : "password"}
          autoComplete="new-password"
          value={values[field]}
          onChange={(event) => update(field, event.target.value)}
          aria-invalid={errors[field] ? true : undefined}
          aria-required
          aria-describedby={
            [
              errors[field] && `${field}-error`,
              field === "password" && "password-hint",
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
          className="h-full"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-sm"
            className="size-10"
            aria-label={`${shown[field] ? "Hide" : "Show"} ${label.toLowerCase()}`}
            aria-pressed={shown[field]}
            onClick={() =>
              setShown((current) => ({ ...current, [field]: !current[field] }))
            }
          >
            {shown[field] ? (
              <Eye className="size-5" />
            ) : (
              <EyeOff className="size-5" />
            )}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <FieldError
        id={`${field}-error`}
        errors={errors[field]?.map((message) => ({ message }))}
      />
    </Field>
  )

  return (
    <AuthLayout intro={RECOVERY_INTRO}>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-gray-900">
          Create a new password
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Choose a new password to regain access to your BUSSCO account.
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

          <div className="flex flex-col gap-2">
            {passwordField("password", "New Password", "Min. 12 characters")}
            <PasswordRuleHints password={values.password} />
          </div>

          {passwordField("confirmation", "Confirm New Password")}

          <Button
            type="submit"
            disabled={reset.isPending}
            size="lg"
            className="w-full"
          >
            {reset.isPending ? (
              "Resetting password…"
            ) : (
              <>
                Reset Password
                <ArrowRight aria-hidden className="size-[18px]" />
              </>
            )}
          </Button>
        </FieldGroup>
      </form>

      <BackToSignIn />
    </AuthLayout>
  )
}
