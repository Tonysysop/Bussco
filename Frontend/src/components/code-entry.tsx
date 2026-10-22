import { useEffect, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { REGEXP_ONLY_DIGITS } from "input-otp"
import { CircleCheck, Clock, LoaderCircle } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { ApiError, apiErrorMessage, apiPost } from "@/lib/api"

// Mirrors User::EMAIL_RESEND_COOLDOWN, shared by verification and reset codes. Informational only:
// inside it Rails still answers 202 and sends nothing.
const RESEND_COOLDOWN_MS = 60_000
const CONFIRMATION_MS = 4_000

// The six-digit code input shared by email verification and password recovery.
export function CodeField({
  ref,
  value,
  onChange,
  error,
}: {
  ref: React.Ref<HTMLInputElement>
  value: string
  onChange: (value: string) => void
  error?: string
}) {
  return (
    <Field data-invalid={!!error}>
      <div className="flex items-baseline justify-between">
        <FieldLabel htmlFor="code" className="font-heading font-semibold">
          Verification code
        </FieldLabel>
        <span aria-hidden className="text-xs text-gray-500">
          6 digits
        </span>
      </div>
      <InputOTP
        ref={ref}
        id="code"
        name="code"
        maxLength={6}
        pattern={REGEXP_ONLY_DIGITS}
        inputMode="numeric"
        autoComplete="one-time-code"
        value={value}
        onChange={onChange}
        aria-invalid={error ? true : undefined}
        aria-required
        aria-describedby={error ? "code-error" : undefined}
        containerClassName="w-full"
      >
        <InputOTPGroup className="w-full justify-between gap-2 sm:gap-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <InputOTPSlot
              key={index}
              index={index}
              aria-invalid={error ? true : undefined}
              className="h-14 flex-1 rounded-md border bg-gray-50 font-heading text-2xl font-semibold text-gray-900 first:rounded-md last:rounded-md data-[active=true]:bg-white"
            />
          ))}
        </InputOTPGroup>
      </InputOTP>
      <FieldError id="code-error">{error}</FieldError>
    </Field>
  )
}

// "Didn't receive a code?" with the cooldown countdown and one polite region for the result.
// getEmail returns the address to send to, or undefined after flagging it as invalid.
// hideFeedback is true once a code is submitted; the earlier result is then discarded.
export function ResendCode({
  path,
  codeSentAt = 0,
  getEmail,
  hideFeedback,
  message,
}: {
  path: string
  codeSentAt?: number
  getEmail: () => string | undefined
  hideFeedback: boolean
  message: string
}) {
  const [resendAt, setResendAt] = useState(codeSentAt + RESEND_COOLDOWN_MS)
  const [now, setNow] = useState(Date.now)
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000))
  useEffect(() => {
    if (secondsLeft === 0) return
    const timer = setTimeout(() => setNow(Date.now()), 1000)
    return () => clearTimeout(timer)
  }, [now, secondsLeft])

  const resend = useMutation({
    mutationFn: (email: string) => apiPost(path, { email }),
    onSuccess: () => setResendAt(Date.now() + RESEND_COOLDOWN_MS),
    onError: (error) => {
      if (error instanceof ApiError && error.retryAfter)
        setResendAt(Date.now() + error.retryAfter * 1000)
    },
    onSettled: () => setNow(Date.now()),
  })

  // Once a code is submitted the last resend result is stale for good, not just while hidden.
  const { reset } = resend
  useEffect(() => {
    if (hideFeedback) reset()
  }, [hideFeedback, reset])

  // Only the latest 202 sets resendAt, and refresh, navigation or a failed resend all clear
  // isSuccess. The countdown's ticker re-renders past the 4 s mark.
  const showConfirmation =
    !hideFeedback &&
    resend.isSuccess &&
    now - (resendAt - RESEND_COOLDOWN_MS) < CONFIRMATION_MS

  function handleResend() {
    const email = getEmail()
    if (email) resend.mutate(email)
  }

  return (
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
              {message}
            </AlertDescription>
          </Alert>
        )}
        {!hideFeedback && resend.isError && (
          <p className="text-xs text-gray-600">
            {apiErrorMessage(resend.error)}
          </p>
        )}
      </div>
    </div>
  )
}
