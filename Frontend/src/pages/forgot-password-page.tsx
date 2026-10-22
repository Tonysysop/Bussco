import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { ArrowRight, CircleAlert, Mail } from "lucide-react"
import { useNavigate } from "react-router"

import {
  AuthLayout,
  BackToSignIn,
  RECOVERY_INTRO,
} from "@/components/auth-layout"
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
  InputGroupInput,
} from "@/components/ui/input-group"
import { apiErrorMessage, apiPost } from "@/lib/api"
import { signupSchema } from "@/lib/validation"

export function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string>()

  // Rails answers 202 for every address, so the next screen can't reveal whether an account exists.
  const request = useMutation({
    mutationFn: (to: string) =>
      apiPost("/api/v1/auth/password_resets", { email: to }),
    onSuccess: (_, to) =>
      navigate("/reset-code", { state: { email: to, codeSentAt: Date.now() } }),
  })

  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (request.isPending) return
    const result = signupSchema.shape.email.safeParse(email)
    if (!result.success) {
      setError(result.error.issues[0].message)
      request.reset()
      return
    }
    setError(undefined)
    request.mutate(result.data)
  }

  return (
    <AuthLayout intro={RECOVERY_INTRO}>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-gray-900">
          Forgot your password?
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Enter your registered email address and we&apos;ll send you a 6-digit
          code to reset your password.
        </p>
      </div>

      <form noValidate onSubmit={handleSubmit}>
        <FieldGroup>
          {request.isError && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>
                {apiErrorMessage(request.error)}
              </AlertDescription>
            </Alert>
          )}

          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="email" className="font-heading font-semibold">
              Work Email Address
            </FieldLabel>
            <InputGroup className="h-12 bg-white">
              <InputGroupAddon>
                <Mail aria-hidden className="size-5 text-gray-400" />
              </InputGroupAddon>
              <InputGroupInput
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="name@buagroup.com"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  if (error) setError(undefined)
                }}
                aria-invalid={error ? true : undefined}
                aria-required
                aria-describedby={
                  error ? "email-error email-hint" : "email-hint"
                }
                className="h-full"
              />
            </InputGroup>
            <FieldError id="email-error">{error}</FieldError>
            <FieldDescription id="email-hint" className="text-xs text-gray-500">
              Use the email address you registered with.
            </FieldDescription>
          </Field>

          <Button
            type="submit"
            disabled={request.isPending}
            size="lg"
            className="w-full"
          >
            {request.isPending ? (
              "Sending…"
            ) : (
              <>
                Send Reset Code
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
