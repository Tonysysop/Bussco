import { useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CircleAlert, CircleCheck, Mail, Pencil } from "lucide-react"
import { Link, useLocation, useNavigate } from "react-router"
import { z } from "zod"

import { AuthLayout } from "@/components/auth-layout"
import { CodeField, ResendCode } from "@/components/code-entry"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  ApiError,
  apiErrorMessage,
  apiPatch,
  meQuery,
  type Me,
} from "@/lib/api"
import { verifyEmailSchema } from "@/lib/validation"

const PATH = "/api/v1/auth/email_verification"
const INVALID_CODE =
  "That code is incorrect or has expired. Enter the latest code or request a new one."

type Errors = { email?: string; code?: string }
type VerifyResponse = { email_verified: true; user?: Me["user"] }

export function VerifyEmailPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Signup passes the email and when its code was sent; a direct visit has neither.
  const state = useLocation().state as {
    email?: string
    codeSentAt?: number
  } | null
  const knownEmail = state?.email
  const [email, setEmail] = useState(knownEmail ?? "")
  const [code, setCode] = useState("")
  const [errors, setErrors] = useState<Errors>({})
  const codeInput = useRef<HTMLInputElement>(null)

  const verify = useMutation({
    mutationFn: (body: z.output<typeof verifyEmailSchema>) =>
      apiPatch(PATH, body) as Promise<VerifyResponse>,
    // Only the registering browser gets `user`; Rails has then set the auth cookie.
    // Caching the user replaces a signed-out answer from an earlier /me, which would bounce /apply to /login.
    onSuccess: ({ user }) => {
      if (!user) return
      queryClient.setQueryData(meQuery.queryKey, () => ({ user }))
      navigate("/apply", { replace: true })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 422) {
        setErrors({ code: INVALID_CODE })
        setCode("")
        codeInput.current?.focus()
      }
    },
  })

  const verifyFormError =
    verify.error &&
    !(verify.error instanceof ApiError && verify.error.status === 422) &&
    apiErrorMessage(verify.error)

  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (verify.isPending) return
    const result = verifyEmailSchema.safeParse({ email, code })
    if (!result.success) {
      const fields = z.flattenError(result.error).fieldErrors
      setErrors({ email: fields.email?.[0], code: fields.code?.[0] })
      verify.reset()
      return
    }
    setErrors({})
    verify.mutate(result.data)
  }

  function resendEmail() {
    const result = verifyEmailSchema.shape.email.safeParse(email)
    if (!result.success) {
      setErrors((current) => ({
        ...current,
        email: result.error.issues[0].message,
      }))
      return
    }
    verify.reset()
    return result.data
  }

  if (verify.isSuccess && !verify.data.user) {
    return (
      <AuthLayout>
        <div className="text-center">
          <CircleCheck
            aria-hidden
            className="mx-auto mb-4 size-10 text-green-700"
          />
          <h1 className="font-heading text-2xl font-bold tracking-tight text-gray-900">
            Email verified
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Sign in with your email and password to continue your membership
            application.
          </p>
          <Link
            to="/login"
            className="mt-4 inline-block rounded-sm font-heading text-sm font-semibold text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Sign in
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <div className="mb-6 text-center">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-gray-900">
          Verify your email
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Enter the 6-digit verification code sent to
          {knownEmail ? (
            <strong className="mt-0.5 block text-base text-gray-900">
              {knownEmail}
            </strong>
          ) : (
            " your work email address."
          )}
        </p>
        {/* No change-email endpoint: a different address means a new registration. */}
        <Link
          to="/signup"
          className="mt-2 inline-flex items-center gap-1.5 rounded-sm font-heading text-sm font-semibold text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Pencil aria-hidden className="size-3.5" />
          Use a different email
        </Link>
      </div>

      <form noValidate onSubmit={handleSubmit}>
        <FieldGroup>
          {verifyFormError && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{verifyFormError}</AlertDescription>
            </Alert>
          )}

          {!knownEmail && (
            <Field data-invalid={!!errors.email}>
              <FieldLabel
                htmlFor="email"
                className="font-heading font-semibold"
              >
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
                    if (errors.email)
                      setErrors((current) => ({ ...current, email: undefined }))
                  }}
                  aria-invalid={errors.email ? true : undefined}
                  aria-required
                  aria-describedby={errors.email ? "email-error" : undefined}
                  className="h-full"
                />
              </InputGroup>
              <FieldError id="email-error">{errors.email}</FieldError>
            </Field>
          )}

          <CodeField
            ref={codeInput}
            value={code}
            onChange={(value) => {
              setCode(value)
              if (errors.code)
                setErrors((current) => ({ ...current, code: undefined }))
            }}
            error={errors.code}
          />

          <Button
            type="submit"
            disabled={verify.isPending}
            size="lg"
            className="w-full"
          >
            {verify.isPending ? "Verifying…" : "Verify Email"}
          </Button>

          <p className="text-center text-sm text-gray-600">
            After verification, you&apos;ll complete your membership
            application.
          </p>
        </FieldGroup>
      </form>

      <ResendCode
        path={PATH}
        codeSentAt={state?.codeSentAt}
        getEmail={resendEmail}
        hideFeedback={!verify.isIdle}
        message="If eligible, a new verification code will arrive shortly."
      />
    </AuthLayout>
  )
}
