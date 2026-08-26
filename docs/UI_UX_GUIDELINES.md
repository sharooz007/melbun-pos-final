# UI/UX & Design Guidelines

Based on the reference screenshots, the application follows a premium, wholesale-centric design language. It is optimized for widescreen (desktop/landscape tablet) usage.

## 1. Color Palette

- **Primary Brand Color:** Deep Red / Terracotta (Approx `#A4392F` or `#B94A3E`)
  - Used for: Sidebar background, Primary Buttons (Checkout, Save), Active states.
- **Background Color:** Beige / Off-White (Approx `#F4EFE6`)
  - Used for: The main application background. Reduces eye strain during long hours of use compared to pure white.
- **Card Background:** Pure White (`#FFFFFF`)
  - Used for: Widgets, Lists, Modals. Provides contrast against the beige background.
- **Text (Primary):** Dark Grey/Black (`#111827`)
- **Text (Secondary):** Muted Grey (`#6B7280`)
- **Accent (Success):** Soft Green (Approx `#10B981`) for profit/positive metrics.
- **Accent (Danger):** Red (`#EF4444`) for expenses, voided invoices (strikethrough).

## 2. Typography
- **Font:** Clean, modern Sans-serif (e.g., Inter or Roboto).
- **Hierarchy:** 
  - Bold, prominent numbers for monetary metrics (e.g., `₹8,269.00`).
  - Uppercase, small tracking for section headers (e.g., `TODAY'S SALES`).

## 3. Layout Structure
- **Sidebar (Left):** Fixed width. Deep red background with white/light-grey text and Lucide React icons.
- **Main Content (Right):** Fluid width, beige background. 
- **Cards/Widgets:** Rounded corners (approx `rounded-xl`), subtle shadows (`shadow-sm` or `shadow-md`). 

## 4. Interaction Patterns
- **Forms:** Clean, bordered inputs. Labels sit above inputs.
- **Modals:** Used for quick actions like "Price & Stock Lookup". They overlay the screen with a semi-transparent dark backdrop.
- **Data States:** "Voided" or deleted records remain in lists but use red text and a strikethrough (e.g., <del class="text-red-500">MELBUN/0001</del>) to indicate their soft-deleted status.
