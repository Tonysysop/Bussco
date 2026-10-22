import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { REGEXP_ONLY_DIGITS } from "input-otp"
import {
  CircleAlert,
  CircleCheck,
  Clock,
  LoaderCircle,
  Mail,
  Pencil,
} from "lucide-react"
import { Link, useLocation, useNavigate } from "react-router"
import { z } from "zod"

import { AuthLayout } from "@/components/auth-layout"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import {
  ApiError,
  apiErrorMessage,
  apiPatch,
  apiPost,
  meQuery,
  type Me,
} from "@/lib/api"
import { verifyEmailSchema } from "@/lib/validation"

const PATH = "/api/v1/auth/email_verification"
// Mirrors User::EMAIL_RESEND_COOLDOWN. Informational only: inside it Rails still answers 202 and sends nothing.
const RESEND_COOLDOWN_MS = 60_000
const CONFIRMATION_MS = 4_000
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

  const [resendAt, setResendAt] = useState(
    () => (state?.codeSentAt ?? 0) + RESEND_COOLDOWN_MS
  )
  const [now, setNow] = useState(Date.now)
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000))
  useEffect(() => {
    if (secondsLeft === 0) return
    const timer = setTimeout(() => setNow(Date.now()), 1000)
    return () => clearTimeout(timer)
  }, [now, secondsLeft])

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

  const resend = useMutation({
    mutationFn: (to: string) => apiPost(PATH, { email: to }),
    onSuccess: () => setResendAt(Date.now() + RESEND_COOLDOWN_MS),
    onError: (error) => {
      if (error instanceof ApiError && error.retryAfter)
        setResendAt(Date.now() + error.retryAfter * 1000)
    },
    onSettled: () => setNow(Date.now()),
  })

  // Only the latest 202 sets resendAt, and refresh, navigation, a failed resend or submitting
  // the code all clear isSuccess. The countdown's ticker re-renders past the 4 s mark.
  const showConfirmation =
    resend.isSuccess && now - (resendAt - RESEND_COOLDOWN_MS) < CONFIRMATION_MS

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
    resend.reset()
    verify.mutate(result.data)
  }

  function handleResend() {
    const result = verifyEmailSchema.shape.email.safeParse(email)
    if (!result.success) {
      setErrors((current) => ({
        ...current,
        email: result.error.issues[0].message,
      }))
      return
    }
    verify.reset()
    resend.mutate(result.data)
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

          <Field data-invalid={!!errors.code}>
            <div className="flex items-baseline justify-between">
              <FieldLabel htmlFor="code" className="font-heading font-semibold">
                Verification code
              </FieldLabel>
              <span aria-hidden className="text-xs text-gray-500">
                6 digits
              </span>
            </div>
            <InputOTP
              ref={codeInput}
              id="code"
              name="code"
              maxLength={6}
              pattern={REGEXP_ONLY_DIGITS}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(value) => {
                setCode(value)
                if (errors.code)
                  setErrors((current) => ({ ...current, code: undefined }))
              }}
              aria-invalid={errors.code ? true : undefined}
              aria-required
              aria-describedby={errors.code ? "code-error" : undefined}
              containerClassName="w-full"
            >
              <InputOTPGroup className="w-full justify-between gap-2 sm:gap-3">
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <InputOTPSlot
                    key={index}
                    index={index}
                    aria-invalid={errors.code ? true : undefined}
                    className="h-14 flex-1 rounded-md border bg-gray-50 font-heading text-2xl font-semibold text-gray-900 first:rounded-md last:rounded-md data-[active=true]:bg-white"
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <FieldError id="code-error">{errors.code}</FieldError>
          </Field>

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

      <div className="mt-6 border-t border-gray-100 pt-5 text-center text-sm text-gray-600">
        <p>Didn&apos;t receive a code?</p>
        {secondsLeft > 0 ? (
          <p className="mt-1 inline-flex items-center gap-1.5 text-gray-500">
            <Clock aria-hidden className="size-4" />
            Resend code in {Math.floor(secondsLeft / 60)}:
            {String(secondsLeft % 60).padStart(2, "0")}
          </p>
        ) : (
          <Button
            type="button"
            variant="link"
            disabled={resend.isPending}
            onClick={handleResend}
            className="mt-1 h-auto p-0 font-heading text-sm font-semibold"
          >
            {resend.isPending ? (
              <>
                <LoaderCircle
                  aria-hidden
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                />
                Requesting…
              </>
            ) : (
              "Resend code"
            )}
          </Button>
        )}
        {/* One polite region for the resend result; the countdown stays outside it. */}
        <div role="status" aria-live="polite" className="mt-3">
          {showConfirmation && (
            // Alert defaults to role="alert"; dropping it avoids a live region inside this one.
            <Alert
              role={undefined}
              className="mx-auto max-w-sm animate-in border-gray-200 bg-gray-50 py-2 text-xs duration-300 fade-in motion-reduce:animate-none *:[svg]:text-green-700"
            >
              <CircleCheck aria-hidden />
              <AlertTitle className="font-heading text-xs font-semibold text-gray-900">
                Request received
              </AlertTitle>
              {/* Rails answers 202 whether or not it sent anything, so this never claims an email went out. */}
              <AlertDescription className="text-xs text-gray-600">
                If eligible, a new verification code will arrive shortly.
              </AlertDescription>
            </Alert>
          )}
          {resend.isError && (
            <p className="text-xs text-gray-600">
              {apiErrorMessage(resend.error)}
            </p>
          )}
        </div>
      </div>
    </AuthLayout>
  )
}
