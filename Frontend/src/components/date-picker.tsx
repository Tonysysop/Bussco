import { useState } from "react"
import { CalendarDays } from "lucide-react"

import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

// Values are Rails' ISO dates (YYYY-MM-DD). They are built from the local date parts, never
// toISOString(), which would shift a day picked near midnight into UTC.
const toDate = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number)
  return new Date(year, month - 1, day)
}
const toIso = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")

const SHOWN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
})

// The shadcn Calendar in a popover, for every date field. The trigger is named by its label, the
// chosen date and "required" (aria-required isn't allowed on a button), so screen readers hear all three.
export function DatePicker({
  id,
  value,
  onChange,
  min,
  max,
  placeholder = "Select a date",
  "aria-required": required,
  ...props
}: {
  id: string
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  placeholder?: string
  "aria-invalid"?: boolean
  "aria-required"?: boolean
  "aria-describedby"?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = value ? toDate(value) : undefined
  const first = min ? toDate(min) : undefined
  const last = max ? toDate(max) : undefined

  return (
    // Non-modal: Escape or a click outside closes and returns focus here; Tab from the days closes
    // and moves on to the next field (Shift+Tab reaches the month and year dropdowns).
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        aria-labelledby={[
          `${id}-label`,
          `${id}-value`,
          required && `${id}-required`,
        ]
          .filter(Boolean)
          .join(" ")}
        {...props}
        className="flex h-12 w-full items-center justify-between gap-2 rounded-lg border border-input bg-white px-3 text-left text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm"
      >
        <span
          id={`${id}-value`}
          className={cn(!selected && "text-muted-foreground")}
        >
          {selected ? SHOWN.format(selected) : placeholder}
        </span>
        {required && (
          <span id={`${id}-required`} className="sr-only">
            required
          </span>
        )}
        <CalendarDays aria-hidden className="size-5 shrink-0 text-primary" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          autoFocus
          captionLayout="dropdown"
          selected={selected}
          defaultMonth={selected ?? last}
          startMonth={first}
          endMonth={last}
          disabled={[
            ...(first ? [{ before: first }] : []),
            ...(last ? [{ after: last }] : []),
          ]}
          onSelect={(date) => {
            if (!date) return
            onChange(toIso(date))
            setOpen(false)
          }}
          className="[--cell-size:--spacing(9)]"
        />
      </PopoverContent>
    </Popover>
  )
}
