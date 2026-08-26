# Design System: SLYD POS

## 1. Visual Theme & Atmosphere
A high-density, tactile, and highly functional Point of Sale (POS) interface. The atmosphere is warm, physical, and focused—like a well-crafted mechanical cash register translated to a digital screen. It rejects generic SaaS aesthetics in favor of a "Cockpit Dense" layout (Density: 8, Variance: 4, Motion: 6) that prioritizes tabular data readability, rapid touch interactions, and clear physical states. The design uses warm beige backgrounds to reduce eye strain during late-night operations, paired with striking burnt orange accents.

## 2. Color Palette & Roles
- **Canvas Base (`#F0E9D3`)** — Primary background surface. Warm, non-fatiguing for long shifts.
- **Pure Surface (`#FFFFFF`)** — Component fill for cards, modals, and list rows.
- **Ink Primary (`#1F1A17`)** — Primary text, deep brown-black for maximum contrast without harshness.
- **Ink Muted (`#5C534A`)** — Secondary text, labels, metadata, and empty states.
- **Border Default (`#E5DCC8`)** — Structural lines, dividers, and subtle card borders.
- **Accent Burnt Orange (`#C23E00`)** — Single accent color for primary buttons, active tabs, and focus rings.
- **Accent Hover (`#A03000`)** — Interactive hover state for primary actions.
- **Row Alt (`#FDFAF3`)** — Alternating list row background for dense data tables.

## 3. Typography Rules
- **Font Stack:** `Geist Sans` for UI, `Geist Mono` for all numbers.
- **Display/Headlines:** Track-tight, controlled scale. Hierarchy through weight (semibold/bold) rather than massive size.
- **Body:** Compact leading. Dense data context requires clear legible sizes (minimum 14px/1rem).
- **Tabular Data (CRITICAL):** All prices, quantities, and inventory counts MUST use `font-tabular` (Geist Mono with `tnum` feature enabled). Numbers must never jump when shifting values.
- **Banned:** `Inter`, generic system fonts, and all Serif fonts (completely banned in this POS context).

## 4. Component Stylings

### Lists & Data Tables
- **Structure:** Edge-to-edge on mobile, contained in `Surface` cards on desktop.
- **Zebra Striping:** Use `bg-surface` and `bg-row-alt` for alternating rows in high-density inventory/invoice lists.
- **Dividers:** 1px solid `border-default` between rows. No thick gaps between list items.
- **Alignment:** Numbers (prices, quantities, totals) must ALWAYS be right-aligned and use tabular mono fonts. Text strings (product names, categories) left-aligned.

### KPI Cards (Dashboards)
- **Shape:** `rounded-card` (16px), strict 1px `border-default`.
- **Shadows:** Subtle diffused shadow: `box-shadow: 0 1px 2px rgba(31, 26, 23, 0.04), 0 4px 16px rgba(31, 26, 23, 0.04)`.
- **Layout:** Muted label top-left, giant tabular number bottom-left, optional trend indicator (success/danger) bottom-right.
- **High-Density Override:** If displaying more than 4 KPIs, replace individual cards with a single surface divided by internal border-right lines (a stat grid) to reduce visual noise.

### Buttons & Touch Targets
- **Tactile Feedback:** All buttons must use `.btn-tactile` which applies an `active:scale-[0.98]` physical push effect. No neon outer glows.
- **Sizing:** Absolute minimum touch target height `min-h-[44px]`.
- **Primary Action:** Solid `bg-accent` with white text.
- **Secondary Action:** Ghost or outline using `border-default` and `text-ink-muted`.
- **Segmented Pills:** Use `.pill-segment` structure for toggles (e.g., Cash/UPI). Active state uses `bg-accent`.

### Inputs & Forms
- **Structure:** Label above, input field, error below. Text size locked to 16px to prevent iOS auto-zoom.
- **Focus Rings:** `focus-visible` must trigger a strict 2px `ring-accent` with a 2px `ring-offset-canvas`.
- **Corner Radius:** `rounded-control` (10px).

### Modals & Dialogs
- **Backdrop:** `bg-[rgba(31,26,23,0.5)]` overlay.
- **Animation:** Spring-physics scale-in (`modal-in` keyframe).
- **Surface:** `bg-surface` with `rounded-card` (16px) and heavy `shadow-modal`.

## 5. Layout Principles
- **Grid-First:** CSS Grid is preferred over Flexbox for dense KPI and catalog layouts.
- **Spatial Zones:** No overlapping text. Every component has a dedicated zone.
- **Padding:** Generous internal padding (p-4 to p-6) inside cards, but tight list padding (py-3) to allow scanning.
- **Mobile Navigation:** Bottom tab bar using `.mb-nav` and `.pb-safe` for iOS home indicator clearance.
- **Desktop Strategy:** Sidebar navigation (left) with a max-width contained main stage.
- **Viewport Constraints:** Full height screens must use `min-h-[100dvh]` to avoid Safari toolbar jumping.

## 6. Motion & Interaction
- **Physical Resistance:** `.btn-tactile` provides immediate, non-delayed physical feedback downscaling to 0.98 on press.
- **Micro-Interactions:** Fast transitions (`150ms` to `200ms`) using crisp cubic-bezier curves (`cubic-bezier(0.16, 1, 0.3, 1)`).
- **Orchestration:** List items should mount instantly (no cascading staggers) as this is a high-speed utility app where cashiers cannot wait for animations.
- **Toast Notifications:** Slide up gracefully (`toast-in`).

## 7. Anti-Patterns (Banned)
- **NO Generic Fonts:** `Inter`, `Roboto`, `Arial` are banned. Serif fonts are banned. Use `Geist` only.
- **NO Purple/Blue/Neon:** The only accent is Burnt Orange (`#C23E00`). No glowing shadows.
- **NO Pure Black/Pure White Contrast:** Do not use `#000000`. Ink (`#1F1A17`) on Canvas (`#F0E9D3`) provides ergonomic contrast.
- **NO Layout Shifts:** Hover states must not change element dimensions. Buttons do not grow on hover.
- **NO Floating Labels:** Form inputs must have standard labels above the field.
- **NO Emojis:** Use proper SVG icons (lucide-react).
- **NO Bouncing Arrows/Chevrons:** This is a utility POS, not a marketing site.
- **NO Slow Animations:** Cashiers require instant feedback. Never use linear easing or >200ms durations for core actions.
- **NO Hidden Overflow on Lists:** High-density lists must scroll natively. Do not chop off rows.
