import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { LoaderCircle, LogOut } from "lucide-react"
import { Link, useNavigate } from "react-router"
import { z } from "zod"

import {
  ADMIN_CARD,
  ADMIN_INPUT,
  ADMIN_LABEL,
  ADMIN_PRIMARY_BUTTON,
  ADMIN_SECONDARY_BUTTON,
  AdminBanner,
  AdminFieldMessage,
  AdminIntro,
  AdminLayout,
  useAdminSignOut,
} from "@/components/admin-layout"
import { PasswordRuleHints } from "@/components/password-rule-hints"
import {
  adminMeQuery,
  apiErrorCode,
  apiErrorMessage,
  apiPatch,
  ApiError,
  type AdminMe,
} from "@/lib/api"
import { adminPasswordSchema } from "@/lib/validation"

type Values = z.input<typeof adminPasswordSchema>
type Errors = Partial<Record<keyof Values, string>>

const FIELDS: { name: keyof Values; autoComplete: string }[] = [
  { name: "current_password", autoComplete: "current-password" },
  { name: "password", autoComplete: "new-password" },
  { name: "confirmation", autoComplete: "new-password" },
]

// Changes the signed-in admin's password (PATCH /api/v1/admin/auth/password). After a temporary
// password (the Super Admin's first sign-in) this is the only page the guard allows. Rails ends every
// session and starts a fresh one here; api.ts adopts the rotated CSRF token from the answer.
export function AdminPasswordPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const admin = useQuery(adminMeQuery)
  const logout = useAdminSignOut()
  const [values, setValues] = useState<Values>({
    current_password: "",
    password: "",
    confirmation: "",
  })
  const [errors, setErrors] = useState<Errors>({})
  const inputs = useRef<Partial<Record<keyof Values, HTMLInputElement | null>>>(
    {}
  )

  const change = useMutation({
    mutationFn: ({ current_password, password }: Values) =>
      apiPatch("/api/v1/admin/auth/password", {
        current_password,
        password,
      }) as Promise<AdminMe>,
    onSuccess: async ({ user }) => {
      queryClient.setQueryData(adminMeQuery.queryKey, () => ({ user }))
      await navigate("/admin", { replace: true })
    },
    onError: (error) => {
      // The session ended (expired or revoked): the guard re-asks Rails and returns to sign-in.
      if (error instanceof ApiError && error.status === 401)
        queryClient.invalidateQueries({ queryKey: adminMeQuery.queryKey })
      if (apiErrorCode(error) === "invalid_current_password") {
        setErrors({ current_password: "Your current password is incorrect." })
        setValues((current) => ({ ...current, current_password: "" }))
        inputs.current.current_password?.focus()
      }
      const rails =
        (error instanceof ApiError &&
          (error.body as { errors?: Record<string, string[]> } | null)
            ?.errors) ||
        null
      if (rails?.password)
        setErrors({ password: `Password ${rails.password[0]}` })
    },
  })

  const user = admin.data?.user
  if (!user) return null
  const temporary = user.must_change_password
  const labels: Record<keyof Values, string> = {
    current_password: temporary ? "Temporary password" : "Current password",
    password: "New password",
    confirmation: "Confirm new password",
  }
  const failure =
    change.error &&
    apiErrorCode(change.error) !== "invalid_current_password" &&
    !(change.error instanceof ApiError && change.error.status === 422)
      ? apiErrorMessage(change.error)
      : null

  function update(field: keyof Values, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    if (errors[field])
      setErrors((current) => ({ ...current, [field]: undefined }))
    if (change.error) change.reset()
  }

  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (change.isPending) return
    const result = adminPasswordSchema.safeParse(values)
    if (!result.success) {
      const fields = z.flattenError(result.error).fieldErrors
      const next: Errors = {}
      for (const { name } of FIELDS) next[name] = fields[name]?.[0]
      setErrors(next)
      const first = FIELDS.find(({ name }) => next[name])
      if (first) inputs.current[first.name]?.focus()
      return
    }
    setErrors({})
    change.mutate(result.data)
  }

  return (
    <AdminLayout>
      <AdminIntro
        title={temporary ? "Set your password" : "Change your password"}
        lead={
          temporary
            ? "Replace your temporary password before you continue. It works only for this step."
            : "Choose a new password for the admin portal. You stay signed in here; other sessions end."
        }
      />

      <form
        noValidate
        onSubmit={handleSubmit}
        aria-busy={change.isPending}
        aria-label={temporary ? "Set your password" : "Change your password"}
        className={ADMIN_CARD}
      >
        {failure && (
          <AdminBanner tone="alert" title="We couldn't change your password">
            {failure}
          </AdminBanner>
        )}

        {FIELDS.map(({ name, autoComplete }) => (
          <div key={name} className="flex flex-col gap-2">
            <label htmlFor={`admin-${name}`} className={ADMIN_LABEL}>
              {labels[name]}
            </label>
            <input
              ref={(element) => {
                inputs.current[name] = element
              }}
              id={`admin-${name}`}
              name={name}
              type="password"
              autoComplete={autoComplete}
              value={values[name]}
              onChange={(event) => update(name, event.target.value)}
              readOnly={change.isPending}
              aria-invalid={errors[name] ? true : undefined}
              aria-describedby={
                [
                  errors[name] && `admin-${name}-error`,
                  name === "password" && "password-hint",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              className={ADMIN_INPUT}
            />
            {name === "password" && (
              <PasswordRuleHints password={values.password} />
            )}
            {errors[name] && (
              <AdminFieldMessage id={`admin-${name}-error`}>
                {errors[name]}
              </AdminFieldMessage>
            )}
          </div>
        ))}

        <button
          type="submit"
          disabled={change.isPending}
          className={ADMIN_PRIMARY_BUTTON}
        >
          {change.isPending ? (
            <>
              <LoaderCircle
                aria-hidden
                className="size-[1.125rem] animate-spin motion-reduce:[animation-duration:2.4s]"
              />
              Saving…
            </>
          ) : (
            "Save new password"
          )}
        </button>
        <p role="status" className="sr-only">
          {change.isPending ? "Saving your new password…" : ""}
        </p>

        {logout.isError && (
          <AdminBanner tone="alert" title="We couldn't sign you out">
            {apiErrorMessage(logout.error)}
          </AdminBanner>
        )}
        {temporary ? (
          <button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className={ADMIN_SECONDARY_BUTTON}
          >
            <LogOut aria-hidden className="size-[18px]" strokeWidth={1.8} />
            {logout.isPending ? "Signing out…" : "Sign out"}
          </button>
        ) : (
          <Link to="/admin" className={ADMIN_SECONDARY_BUTTON}>
            Back to the portal
          </Link>
        )}
      </form>
    </AdminLayout>
  )
}
