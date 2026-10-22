import { useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { ArrowRight, CircleAlert, Pencil } from "lucide-react"
import { Link, Navigate, useLocation, useNavigate } from "react-router"
import { z } from "zod"

import {
  AuthLayout,
  BackToSignIn,
  RECOVERY_INTRO,
} from "@/components/auth-layout"
import { CodeField, ResendCode } from "@/components/code-entry"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import { ApiError, apiErrorMessage, apiPost } from "@/lib/api"
import { verifyEmailSchema } from "@/lib/validation"

const PATH = "/api/v1/auth/password_resets"
// Rails gives one answer for a wrong, expired, used or superseded code and for an unknown email.
const INVALID_CODE =
  "That code is incorrect or has expired. Enter the latest code or request a new one."

export function ResetCodePage() {
  const navigate = useNavigate()
  // From the forgot-password screen; history state survives a reload. It only names the address:
  // the reset authorization exists solely in Rails' session cookie once the code verifies.
  const state = useLocation().state as {
    email?: string
    codeSentAt?: number
  } | null
  const email = state?.email
  const [code, setCode] = useState("")
  const [codeError, setCodeError] = useState<string>()
  const codeInput = useRef<HTMLInputElement>(null)

  const verify = useMutation({
    mutationFn: (body: z.output<typeof verifyEmailSchema>) =>
      apiPost(`${PATH}/verify`, body),
    // Replace, so Back doesn't return to a code that is now used.
    onSuccess: () => navigate("/reset-password", { replace: true }),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 422) {
        setCodeError(INVALID_CODE)
        setCode("")
        codeInput.current?.focus()
      }
    },
  })

  if (!email) return <Navigate to="/forgot-password" replace />

  const formError =
    verify.error &&
    !(verify.error instanceof ApiError && verify.error.status === 422) &&
    apiErrorMessage(verify.error)

  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (verify.isPending) return
    const result = verifyEmailSchema.safeParse({ email, code })
    if (!result.success) {
      setCodeError(z.flattenError(result.error).fieldErrors.code?.[0])
      verify.reset()
      return
    }
    setCodeError(undefined)
    verify.mutate(result.data)
  }

  return (
    <AuthLayout intro={RECOVERY_INTRO}>
      <div className="mb-6 text-center">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-gray-900">
          Verify your identity
        </h1>
        {/* Worded the same whether or not the account exists. */}
        <p className="mt-2 text-sm text-gray-600">
          If an account exists for
          <strong className="my-0.5 block text-base text-gray-900">
            {email}
          </strong>
          you&apos;ll receive a 6-digit code. It expires in 10 minutes.
        </p>
        <Link
          to="/forgot-password"
          className="mt-2 inline-flex items-center gap-1.5 rounded-sm font-heading text-sm font-semibold text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Pencil aria-hidden className="size-3.5" />
          Use a different email
        </Link>
      </div>

      <form noValidate onSubmit={handleSubmit}>
        <FieldGroup>
          {formError && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <CodeField
            ref={codeInput}
            value={code}
            onChange={(value) => {
              setCode(value)
              if (codeError) setCodeError(undefined)
            }}
            error={codeError}
          />

          <Button
            type="submit"
            disabled={verify.isPending}
            size="lg"
            className="w-full"
          >
            {verify.isPending ? (
              "Verifying…"
            ) : (
              <>
                Verify Code
                <ArrowRight aria-hidden className="size-[18px]" />
              </>
            )}
          </Button>
        </FieldGroup>
      </form>

      {/* A new request supersedes the earlier code and any reset authorization. */}
      <ResendCode
        path={PATH}
        codeSentAt={state.codeSentAt}
        getEmail={() => {
          verify.reset()
          setCodeError(undefined)
          return email
        }}
        hideFeedback={!verify.isIdle}
        message="If eligible, a new code will arrive shortly."
      />

      <BackToSignIn />
    </AuthLayout>
  )
}
