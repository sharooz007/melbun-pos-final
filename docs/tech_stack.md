# Technology Stack

## 1. Core Framework: Next.js (React)
- **Framework:** Next.js with App Router (Next.js 14+).
- **Runtime:** Cloudflare Workers (Edge Runtime) via `@cloudflare/next-on-pages`.

## 2. Hosting & Deployment: Cloudflare Pages
- **Platform:** Cloudflare Pages.
- **Deployment:** GitHub auto-deploy (push to `main` for automatic build and deploy).
- **Limitations to note:** No `next/image` optimization, no Node.js native modules (use Web Crypto API), bundle size limits (25MB per worker script).

## 3. Database: Supabase (PostgreSQL)
- **Why:** Replaces Cloudflare D1. Provides a robust, scalable PostgreSQL database.
- **ORM:** Drizzle ORM (highly recommended for Edge compatibility and type safety).
- **Features:** Real-time subscriptions, daily backups, and powerful relational data modeling suited for a POS (inventory, invoices, customers, payments).

## 4. Authentication: Supabase Auth
- **Why:** Replaces custom JWT auth. Built-in, secure, and integrates seamlessly with Supabase PostgreSQL (Row Level Security - RLS).
- **Features:** Email/password, Magic Links, or OAuth. Session management is handled automatically by the Supabase client.

## 5. Styling: Tailwind CSS
- **Why:** Rapid, responsive UI development. Mobile-first approach.

## 6. Icons: Lucide React
- **Why:** Professional, lightweight SVG icons.

## 7. PDF Generation: jspdf + html2canvas (or @react-pdf/renderer)
- **Why:** Generates invoice/receipt PDFs entirely on the client side.
- **Delivery:** Web Share API (`navigator.share()`) for WhatsApp sharing, with fallback download links.
- **Security:** Ensure DOM APIs are used properly to prevent XSS.

## 8. Error Tracking: Sentry (Free Tier)
- **Integration:** `@sentry/nextjs` for crash reporting and performance monitoring.

## 9. Package Manager: npm
- **Why:** Universal, reliable.

---

## Architecture Overview

```text
┌─────────────────────────────────────────────────┐
│                   Browser                        │
│  Next.js App (React) + Client-side PDF (jspdf)  │
└─────────────────┬───────────────────────────────┘
                  │ HTTPS
┌─────────────────▼───────────────────────────────┐
│            Cloudflare Pages                      │
│  Next.js API Routes (Workers Runtime)           │
│  ┌──────────────────────────────────────┐       │
│  │ Supabase Auth Middleware              │       │
│  │ API Routes (/api/*)                   │       │
│  └──────────┬───────────────────────────┘       │
│             │ HTTPS (PostgREST API)              │
│  ┌──────────▼───────────────────────────┐       │
│  │ Supabase (PostgreSQL & Auth)         │       │
│  │ Row Level Security (RLS)              │       │
│  └──────────────────────────────────────┘       │
└─────────────────────────────────────────────────┘
```

## Security Practices

### CSRF Protection & Supabase Auth
- Use Supabase's secure cookies for SSR and API routes.
- Validate the `Origin` header for state-mutating requests (POST, PUT, DELETE).

### Input Sanitization & XSS Prevention
- React automatically escapes rendered variables.
- All API routes must validate and sanitize inputs before database insertion (e.g., trim whitespace, enforce max-length).
- **PDF generation safety:** Build invoice HTML using DOM APIs safely.
- **WhatsApp URL safety:** All user-supplied text in `wa.me` links must be wrapped in `encodeURIComponent()`.
