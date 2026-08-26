# Local Development Guide

This guide explains how to run the MelbunPOS stack (Next.js + Cloudflare Pages + Supabase) locally for development and testing.

## Prerequisites
Before you begin, ensure you have the following installed on your machine:
- **Node.js** (v18 or v20 recommended)
- **npm** (comes with Node.js)
- **Docker Desktop** (Required for running Supabase locally)
- **Wrangler CLI** (`npm install -g wrangler`)
- **Supabase CLI** (`npm install -g supabase`)

---

## 1. Local Database & Auth (Supabase)

Instead of using a remote database for development, we use the Supabase CLI to spin up a complete local Supabase instance (Postgres, Auth, Storage, API) using Docker.

### Initializing and Starting Supabase:
1. Open your terminal in the project root.
2. Initialize Supabase (only needed once):
   ```bash
   supabase init
   ```
3. Start the local instance:
   ```bash
   supabase start
   ```
   *Note: Docker must be running on your machine.*

Once started, the CLI will output your local credentials, which will look something like this:
```text
API URL: http://127.0.0.1:54321
DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
Studio URL: http://127.0.0.1:54323
anon key: eyJhbGciOiJIUzI1NiIsInR5c...
```
You can visit the **Studio URL** in your browser to view your local database UI, manage tables, and view auth logs (just like the hosted Supabase dashboard).

---

## 2. Environment Variables

Create a `.env.local` file in the root of your project and add the keys provided by `supabase start`:

```env
# .env.local
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_local_anon_key_here
```

---

## 3. Running the App locally

Just like your previous setup, you only need one command to run the entire application (UI, APIs, and everything) locally.

Run the standard Next.js development server:
```bash
npm run dev
```
- **Access:** Open `http://localhost:3000` in your browser.
- **How it works:** This command starts your local server. It will look exactly like the hosted version, allowing you to click around, test features, interact with the local Supabase database, and ensure everything works perfectly before you push your code to GitHub.

---

## 4. Stopping the Environment
To stop the local Supabase containers when you are done working:
```bash
supabase stop
```
*(If you want to completely reset your local database and wipe all data, use `supabase stop --no-backup`)*
