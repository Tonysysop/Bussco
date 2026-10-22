import { CircleHelp, ShieldCheck } from "lucide-react"

import logo from "@/assets/bussco.png"

const LOGO_ALT = "BUA Senior Staff Multipurpose Cooperative Society"

// Split-screen shell from design-reference/stitch/Signup.png: brand panel left, form panel right.
export function AuthLayout({
  children,
  intro = "Create your account to begin your membership application and access cooperative savings and loan benefits.",
}: {
  children: React.ReactNode
  intro?: string
}) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-white lg:flex-row lg:bg-transparent">
      <aside className="relative hidden w-5/12 flex-col justify-between overflow-hidden bg-brand-panel p-12 text-white lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -bottom-24 size-96 rounded-full bg-brand-yellow/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 -left-20 size-80 rounded-full bg-black/20 blur-2xl"
        />
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full opacity-10 mix-blend-overlay"
          fill="none"
          viewBox="0 0 500 800"
        >
          <path
            d="M-100 200C50 250 120 400 80 550C40 700 220 820 400 800"
            stroke="#fcd400"
            strokeLinecap="round"
            strokeWidth="60"
          />
          <path
            d="M50 50C150 120 280 200 320 400C360 600 220 750 480 850"
            stroke="#ffffff"
            strokeLinecap="round"
            strokeWidth="40"
          />
        </svg>

        <div className="relative">
          <div className="inline-block max-w-[260px] rounded-xl bg-white px-5 py-3 shadow-md">
            <img
              src={logo}
              alt={LOGO_ALT}
              className="h-12 w-auto object-contain"
            />
          </div>
        </div>

        <div className="relative my-auto max-w-lg py-10">
          <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 font-heading text-xs font-bold tracking-wider text-white/90 uppercase">
            <span className="size-1.5 rounded-full bg-brand-yellow" />
            BUA Staff Cooperative Portal
          </span>
          <h2 className="mb-4 font-heading text-4xl leading-tight font-extrabold tracking-tight">
            Your cooperative, at your fingertips
          </h2>
          <p className="text-lg leading-relaxed text-white/85">{intro}</p>
        </div>

        <div className="relative flex items-center gap-3 border-t border-white/15 pt-6">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
            <ShieldCheck aria-hidden className="size-5 text-brand-yellow" />
          </div>
          <div className="text-xs leading-snug">
            <p className="font-heading font-semibold">
              BUA Senior Staff Multipurpose Cooperative Society (BUSSCO)
            </p>
            <p className="text-white/70">
              Secure Member Onboarding &amp; Verification
            </p>
          </div>
        </div>
      </aside>

      <main className="flex flex-col items-center justify-between px-4 py-6 sm:p-10 lg:w-7/12 lg:p-12">
        {/* Support has no destination yet, so it is plain text, not a link. */}
        <div className="mb-2 hidden w-full max-w-[480px] justify-end lg:flex">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 font-heading text-xs font-semibold text-gray-500">
            <CircleHelp aria-hidden className="size-4" />
            Cooperative Support
          </span>
        </div>

        <div className="my-auto flex w-full max-w-[480px] flex-col items-center">
          <div className="mb-5 rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm lg:hidden">
            <img
              src={logo}
              alt={LOGO_ALT}
              className="h-10 w-auto object-contain"
            />
          </div>
          <section className="w-full lg:rounded-2xl lg:border lg:border-gray-200 lg:bg-card lg:p-10 lg:shadow-sm">
            {children}
          </section>
          <p className="mt-5 text-center text-xs text-gray-500">
            Need help?{" "}
            <span className="font-medium text-gray-700">
              Contact Cooperative Support
            </span>
          </p>
        </div>

        <footer className="w-full max-w-[480px] pt-6 pb-2 text-center text-xs text-gray-400">
          © {new Date().getFullYear()} BUA Senior Staff Multipurpose Cooperative
          Society Limited. All rights reserved.
        </footer>
      </main>
    </div>
  )
}
