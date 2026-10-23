# BUSSCO Admin Login — design handoff

Administrator sign-in page for the BUSSCO (BUA Senior Staff Multipurpose Cooperative Society) Administrative Portal.
Recommended direction: **Editorial Minimalism**. This page is separate from the member login. Do not change the existing Admin Portal.

## What's in this folder

| Path | What it is |
|---|---|
| `source/Main.dc.html` | **Source of truth.** The final page: markup, all states, and the layout values for every breakpoint (`layouts()` in the script block). |
| `source/Mark.dc.html` | Emblem watermark component (`size`, `tone: mono / color`). |
| `source/Final-*.dc.html`, `source/State-*.dc.html` | Thin wrappers that render `Main` at a given viewport or state. They're for reference only. |
| `source/Concept*.dc.html` | The three exploration concepts. Static, not for implementation. |
| `tokens.json` | Colours, type, radii, shadow, sizes, and per-breakpoint layout values. |
| `assets/bussco-emblem.png` | Full-colour emblem with transparent background (header mark). |
| `assets/bussco-emblem-mono.png` | Burgundy tonal emblem (watermark default). |
| `assets/bussco-logo.png` | Full lockup, transparent background. |
| `assets/bussco-logo-original.png` | The original supplied file. |

`.dc.html` files are HTML with `{{hole}}` bindings, `<sc-if>` conditionals and a `class Component extends DCLogic` script block, which behaves like a React class component. Read them as a spec, not as runnable code. Image paths are rewritten to `../assets/…`.

## Implementation rules

- Build one `AdminLogin` page with a fluid layout. Use CSS breakpoints for the four layouts in `tokens.json`. Frames are 1440 / 768 / 390 / 320.
- **Never fake authentication.** Wire submit to the real admin auth endpoint. The prototype's "always incorrect after 1.7 s" behaviour is demo-only and must not ship.
- Do not add registration, role selection, SSO / other auth methods, "forgot password" or compliance badges unless the product team asks.
- The watermark is decorative. Use `aria-hidden="true"`, `pointer-events: none`, and keep it inside an `overflow: hidden` page wrapper so it crops and never causes horizontal scroll. Use `object-fit: contain` and never stretch the logo.
- Use no horizontal scroll at 320 px. Controls must be at least 44 px tall.

## Structure

```
page (bg canvas, min-height 100vh, overflow hidden, flex column)
├─ watermark (absolute, Mark tone=mono, opacity .06)
├─ header: emblem 30×33 · "BUSSCO" (Newsreader 22/500, .06em, #75141A) · 1px divider · "Administrative Portal" (13px, muted)
├─ main (flex-grow; column of width columnWidth, max-width 100%)
│  ├─ intro: eyebrow (28px rule + "BUSSCO ADMINISTRATION", 12/600, .18em, burgundy)
│  │         h1 "Welcome Back" (Newsreader 400, size per breakpoint, lh 1.02, -.025em)
│  │         lead "Sign in to access your administrative workspace." (body colour)
│  ├─ form card (white, 1px border, radius 16, card shadow, padding per breakpoint, gap 20)
│  │  ├─ [banner: session expired | incorrect credentials]
│  │  ├─ Corporate Email Address (label 13.5/500, input 48px, radius 10)
│  │  ├─ Password + show/hide toggle (44×44 button inside the input, right 2px)
│  │  ├─ Primary: "Sign In to Admin Portal →" (52px, burgundy, hover deep burgundy)
│  │  └─ divider + lock icon + "Restricted access. Authorized administrators only." (13px muted)
│  └─ link "← Return to Member Portal" (14/500, min-height 44, underline on hover)
└─ footer "BUA Senior Staff Multipurpose Cooperative Society" (12px muted)
```

## States

| State | Trigger | UI |
|---|---|---|
| Default | Page load | Empty fields. |
| Field validation | Submit with empty or invalid fields | Input border `error`, bg `errorInputBg`, `aria-invalid="true"`, message below with `aria-describedby`. Messages: *"Enter your corporate email address."* / *"Enter a valid email address, e.g. name@company.com."* / *"Enter your password."* Errors clear as the user types in that field. |
| Signing in | Valid submit while request pending | Button disabled, deep burgundy, spinner + "Signing in…". Inputs read-only. Form `aria-busy="true"`. |
| Incorrect credentials | Auth returns 401 | `role="alert"` banner at top of card: **"Incorrect email or password"**, then "Check your details and try again." Clear the password and keep the email. The banner hides once the user edits a field. Use one generic message and don't reveal which field was wrong. |
| Session expired | Redirected here with an expired-session flag (e.g. `?reason=expired`) | `role="status"` banner: **"Your session has expired"**, then "For your security, please sign in again." |

Email check used in the prototype: `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`. Server validation stays authoritative.

## Accessibility

- Real `<form>`, `<label for>`, `<button type="submit">`. Enter submits.
- Email: `type="email"` or `type="text" inputmode="email"`, `autocomplete="username"`, `autocapitalize="none"`, `spellcheck="false"`. Password: `autocomplete="current-password"`.
- Toggle: `aria-label` switches between "Show password" and "Hide password", plus `aria-pressed` and `aria-controls`.
- Focus: inputs get a burgundy border plus a 3px ring at `focusRing`. Buttons and links get a 2px burgundy `:focus-visible` outline. The spinner slows under `prefers-reduced-motion`.
- All text meets 4.5:1 on its background.

## Open note

The `<h1>` in `Main.dc.html` has a fixed `width: 484px; height: 115px` from a hand edit on the canvas. Treat it as a desktop-only tweak. On tablet and mobile the headline must stay fluid, because 484 px overflows the 288–350 px mobile column.
