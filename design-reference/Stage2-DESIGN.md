---
name: Institutional Excellence
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f3'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1a1c1c'
  on-surface-variant: '#5d3f3c'
  inverse-surface: '#2f3131'
  inverse-on-surface: '#f1f1f1'
  outline: '#926e6b'
  outline-variant: '#e7bdb8'
  surface-tint: '#c00015'
  primary: '#b90014'
  on-primary: '#ffffff'
  primary-container: '#e31b23'
  on-primary-container: '#fff9f8'
  inverse-primary: '#ffb4ac'
  secondary: '#705d00'
  on-secondary: '#ffffff'
  secondary-container: '#fcd400'
  on-secondary-container: '#6e5c00'
  tertiary: '#5b5b5a'
  on-tertiary: '#ffffff'
  tertiary-container: '#747373'
  on-tertiary-container: '#fdfaf9'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdad6'
  primary-fixed-dim: '#ffb4ac'
  on-primary-fixed: '#410002'
  on-primary-fixed-variant: '#93000d'
  secondary-fixed: '#ffe16d'
  secondary-fixed-dim: '#e9c400'
  on-secondary-fixed: '#221b00'
  on-secondary-fixed-variant: '#544600'
  tertiary-fixed: '#e5e2e1'
  tertiary-fixed-dim: '#c8c6c5'
  on-tertiary-fixed: '#1c1b1b'
  on-tertiary-fixed-variant: '#474746'
  background: '#f9f9f9'
  on-background: '#1a1c1c'
  surface-variant: '#e2e2e2'
typography:
  display-lg:
    fontFamily: Public Sans
    fontSize: 56px
    fontWeight: '700'
    lineHeight: 64px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Public Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Public Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
  headline-md:
    fontFamily: Public Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Source Sans 3
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Source Sans 3
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Public Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  container-max: 1280px
  gutter: 24px
---

## Brand & Style

The design system is engineered to project industrial strength, unwavering reliability, and national significance. It caters to stakeholders, partners, and the public, evoking an emotional response of security and progress. 

The aesthetic is **Corporate Modern with High-Contrast influences**. It utilizes a bold, authoritative color palette balanced by a rigid, systematic layout. The style avoids superfluous ornamentation, focusing instead on clarity, structural integrity, and high-impact visual communication that reflects a leading multi-sector conglomerate.

## Colors

The palette is driven by the legacy colors of the brand, optimized for digital accessibility. 

- **Primary Red (#E31B23):** Used for headlines, primary actions, and critical brand accents. It signals energy and leadership.
- **Secondary Yellow (#FFD700):** Employed as a distinctive background for content sections and secondary highlights. To maintain readability, text on yellow backgrounds must use the Tertiary Black.
- **Tertiary Black (#1A1A1A):** Used for primary body text and high-contrast UI elements to ensure institutional gravity.
- **Neutral Gray (#F4F4F4):** Provides a calm canvas for data-heavy sections where yellow may be too stimulating.

Contrast ratios must be strictly monitored; use white text on red surfaces and black text on yellow surfaces.

## Typography

This design system uses a pairing of **Public Sans** and **Source Sans 3** to establish an institutional and accessible tone. 

- **Public Sans** is utilized for headlines and labels. Its sturdy, neutral, and institutional character provides a sense of official authority. Headlines should primarily appear in Primary Red or Tertiary Black.
- **Source Sans 3** is used for all body copy. It offers exceptional legibility at smaller scales and a professional, approachable feel.

For mobile layouts, headline sizes are scaled down to ensure they do not overwhelm the smaller viewport, while body sizes remain constant to ensure readability.

## Layout & Spacing

The layout philosophy follows a **Fixed Grid** model for desktop to convey stability and order. 

- **Desktop:** A 12-column grid with a maximum container width of 1280px. Gutters are fixed at 24px to provide ample breathing room between complex data sets.
- **Tablet:** An 8-column fluid grid with 16px margins.
- **Mobile:** A 4-column fluid grid with 16px margins.

Spacing follows a strict 8px base-unit scale. Content should be grouped logically using larger gaps (xxl) between major sections to prevent visual clutter, reflecting the "Institutional" need for clear information hierarchy.

## Elevation & Depth

To maintain a professional and "grounded" feel, this design system minimizes the use of shadows. Depth is primarily communicated through **Tonal Layers** and **Low-Contrast Outlines**.

- **Surface Tiers:** Use the Primary Red for the highest hierarchy (primary buttons), the Secondary Yellow for specialized containers, and light gray for standard content blocks.
- **Borders:** Instead of shadows, use 1px solid borders in a slightly darker shade of the background color or a 10% opacity black. This creates a flat, architectural look that feels "engineered."
- **Focus States:** Use a 2px offset ring in Primary Red to indicate keyboard focus, ensuring high visibility.

## Shapes

The shape language is conservative and precise. A **Soft (Level 1)** roundedness is applied to all UI elements. 

The 4px (0.25rem) corner radius strikes a balance between the modern approachability of rounded corners and the serious, industrial feel of sharp edges. This uniformity applies to buttons, input fields, and cards. Larger containers (rounded-lg) may use 8px to maintain visual proportion.

## Components

- **Buttons:** Primary buttons are solid Primary Red with White text. Secondary buttons use a Primary Red outline or Tertiary Black text on a Secondary Yellow background.
- **Input Fields:** Use a 1px border in a mid-tone gray. Labels should be in Public Sans (Label-md) for clear identification. On focus, the border transitions to Primary Red.
- **Cards:** For institutional reports or news, cards use a white background with a thin gray border. Feature cards may use a Secondary Yellow background to draw immediate attention.
- **Chips/Badges:** Small, high-contrast pills. Use Tertiary Black for status or categories to stand out against the Red/Yellow brand colors.
- **Lists:** Clean, strictly aligned rows with subtle dividers (1px, light gray). Use Primary Red for bullet points or icons to lead the eye.
- **Data Tables:** Highly structured with Primary Red headers (white text) and alternating row colors for readability.