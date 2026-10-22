import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

// The five steps in design-reference/Stage1–5.png. Keys are Rails' stage names; "review" is a
// navigation step only, never "complete" (Rails' progress.stages has no entry for it).
export const STAGES = [
  {
    key: "employment",
    label: "Employment",
    title: "Complete your membership application",
    intro:
      "Tell us about your employment. You can save your progress and return anytime.",
  },
  {
    key: "personal",
    label: "Personal",
    title: "Personal details",
    intro: "Add your contact information and personal details.",
  },
  {
    key: "next_of_kin",
    label: "Next of kin",
    title: "Next of kin",
    intro: "Provide your next of kin's details for our membership records.",
  },
  {
    key: "savings",
    label: "Contributions",
    title: "Monthly contribution",
    intro: "Choose your monthly contribution and proposed start date.",
  },
  {
    key: "review",
    label: "Review",
    title: "Review your application",
    intro: "Check your details before submitting.",
  },
] as const

export type Stage = (typeof STAGES)[number]

// Grey page, red-top card and copyright line shared by every application screen (Stage1.png,
// Final-stage.png). Each screen draws its own header: the designs differ there.
export function ApplicationLayout({
  narrow = false,
  children,
}: {
  narrow?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-4 py-6 sm:py-12">
      <main
        className={cn(
          "w-full rounded-xl border-t-[6px] border-primary bg-card p-5 shadow-sm sm:p-10",
          narrow ? "max-w-[560px]" : "max-w-[720px]"
        )}
      >
        {children}
      </main>
      <footer className="mt-6 max-w-[720px] text-center text-xs text-gray-500">
        © {new Date().getFullYear()} BUA Senior Staff Multipurpose Cooperative
        Society Limited. All rights reserved.
      </footer>
    </div>
  )
}

// "Step n of 5" with one segment per stage. Only Rails' progress marks a stage complete; the
// stage being viewed is shown separately, so moving through steps never looks like finishing them.
export function StageProgress({
  current,
  stages = {},
}: {
  current: Stage
  stages?: Record<string, "complete" | "incomplete">
}) {
  const position = STAGES.indexOf(current) + 1
  return (
    <div className="rounded-lg bg-muted p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3 text-xs">
        <p className="font-heading font-bold tracking-wide text-primary uppercase">
          Step {position} of {STAGES.length}
          <span className="sm:hidden"> — {current.label}</span>
        </p>
        <p className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-gray-600">
          <span aria-hidden className="size-2 rounded-full bg-brand-yellow" />
          Application draft
        </p>
      </div>
      <ol className="grid grid-cols-5 gap-1.5">
        {STAGES.map((stage, index) => {
          const complete = stages[stage.key] === "complete"
          const isCurrent = stage === current
          return (
            <li
              key={stage.key}
              aria-current={isCurrent ? "step" : undefined}
              className="flex flex-col gap-2"
            >
              <span
                aria-hidden
                className={cn(
                  "h-1.5 rounded-full bg-gray-200",
                  complete && "bg-primary",
                  isCurrent && "bg-primary ring-2 ring-primary/25 ring-offset-1"
                )}
              />
              {/* Labels are hidden below sm, as in the designs, but stay readable to screen readers. */}
              <span
                className={cn(
                  "sr-only items-center gap-1 text-[11px] text-gray-600 sm:not-sr-only sm:flex",
                  isCurrent && "font-bold text-primary"
                )}
              >
                {complete && (
                  <Check aria-hidden className="size-3 shrink-0 text-primary" />
                )}
                {index + 1}. {stage.label}
                <span className="sr-only">
                  {complete
                    ? " (complete)"
                    : isCurrent
                      ? ""
                      : " (not complete)"}
                </span>
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
