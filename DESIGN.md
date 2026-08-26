# Design System: Melbon POS

## 1. Visual Theme & Atmosphere
A crisp, high-contrast, professional Point of Sale (POS) interface. The atmosphere is sharp, sterile in a good way, and incredibly focused—inspired by the premium hardware-accelerated feel of Square POS and Shopify POS. It rejects generic warm/beige aesthetics ("AI slop") in favor of an ultra-clean Slate and White palette that maximizes legibility in bright retail environments.

## 2. Color Palette & Roles
- **Canvas Base (Slate 50 / `#F8FAFC`)** — Primary background surface. Crisp and high-contrast.
- **Pure Surface (`#FFFFFF`)** — Component fill for cards, modals, and list rows.
- **Ink Primary (Slate 900 / `#0F172A`)** — Primary text, near-black for maximum razor-sharp contrast.
- **Ink Muted (Slate 500 / `#64748B`)** — Secondary text, labels, metadata, and empty states.
- **Border Default (Slate 200 / `#E2E8F0`)** — Structural lines, dividers, and subtle card borders.
- **Accent Blue (Blue 600 / `#2563EB`)** — Single accent color for primary buttons, active tabs, and focus rings. High-trust, professional.
- **Accent Hover (Blue 700 / `#1D4ED8`)** — Interactive hover state for primary actions.
- **Row Alt (Slate 50/10 / `#F8FAFC`)** — Alternating list row background for dense data tables.

## 3. Typography Rules
- **Font Stack:** `Geist Sans` for UI, `Geist Mono` for all numbers.
- **Tabular Data (CRITICAL):** All prices, quantities, and inventory counts MUST use `font-mono` and `tnum`. Numbers must never jump when shifting values.
- **Hierarchy:** Rely on `font-bold` vs `font-medium` and slate-900 vs slate-500 rather than massive font sizes.

## 4. Component Stylings & Layout Architecture

### Global Structural Layout
- **Top Bar (Crucial):** Every screen must have a clear, persistent Top Bar for contextual actions (Page Title, Search, User Profile, Store Info).
- **Mobile Bottom Navigation:** Exactly 5 evenly spaced, thumb-friendly icons (`Dashboard`, `POS`, `Invoices`, `Inventory`, `Menu`). The `Menu` triggers a full-screen drawer for secondary routes. NO horizontal scrolling in the bottom nav.
- **Main Content Padding:** Mobile must use `p-4` with `pb-28` (safe area clearance). Desktop scales up to `md:p-8`. Never use `p-8` on mobile screens.

### Lists & Inventory (Progressive Disclosure)
- **Accordions/Dropdowns:** Do NOT dump all variant data on screen at once. High-density lists (like the Inventory catalog) must group variants under a parent Product card. Variants must be hidden inside an accordion or expandable dropdown by default to save vertical space.
- **Dividers:** 1px solid `border-border` between rows.

### POS Checkout (The "Sticky" Rule)
- **Mobile Checkout Flow:** The cart list must take up the main scrollable area. The "Proceed to Checkout" (or Total) button MUST be permanently sticky at the bottom of the cart (`fixed` or `sticky bottom-0`) floating ABOVE the bottom navigation bar.
- **Touch Targets:** Quantity adjusters (`+`, `-`) and delete buttons (`Trash`) must be massive on mobile (minimum `w-10 h-10` or `44x44px`) to ensure cashiers never mis-tap.

### Buttons & Inputs
- **Tactile Feedback:** All buttons must scale down on press (`active:scale-95`).
- **Primary Action:** Solid `bg-accent` with white text.
- **Form Inputs:** Must trigger native mobile keyboards when appropriate (`type="number"` for quantities/cash). 

## 5. Anti-Patterns (Banned)
- **NO Beige or Warm Colors:** `#F0E9D3`, `#C23E00`, and `#8B0000` are strictly banned.
- **NO Data Dumping:** Never render a flattened list of 50 variants. Group them.
- **NO Hidden Primary Actions:** If an invoice cannot be completed because the checkout button scrolled off-screen, the layout is broken.
- **NO Desktop Tables on Mobile:** `<table>` is banned for mobile views. Use flex stacks or CSS Grid for responsive cards.
