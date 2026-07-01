# Awaaz Labs CRM UI

Internal Next.js dashboard for reviewing AI-captured cardiology bookings, post-call intake status, and outbound message activity.

## What This App Does

- Reads CRM data through the local Next.js proxy route at `/api/crm`
- Shows recent bookings and booking details
- Supports client-side search and quick filters
- Supports resend actions for:
  - confirmation messages
  - intake form links
- Shows related message history for the selected booking

## Architecture

The browser does **not** call the Supabase edge function directly.

Instead:

1. The frontend calls `GET /api/crm` and `POST /api/crm`
2. `src/app/api/crm/route.ts` runs server-side
3. That proxy route forwards requests to the deployed Supabase edge function
4. The proxy injects `x-crm-secret` from server environment variables when configured

This keeps the CRM secret out of the browser and works well for Vercel deployment.

## Required Environment Variables

Set these in local `.env.local` and in the Vercel project settings:

```bash
CRM_API_URL=https://YOUR_SUPABASE_PROJECT.supabase.co/functions/v1/crm-api
CRM_SECRET=your_crm_secret_if_used
```

Notes:

- `CRM_API_URL` should point to the deployed Supabase `crm-api` function.
- `CRM_SECRET` must match the `CRM_SECRET` configured in the Supabase edge function environment if that secret is enabled there.
- If the Supabase function does not enforce `CRM_SECRET`, this value can be omitted, but keeping it enabled is recommended for production.

## Local Development

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Vercel Deployment

If deploying this sub-app to Vercel:

1. Import the repository into Vercel
2. Set the project root directory to `crm-ui`
3. Confirm the framework is detected as `Next.js`
4. Add these environment variables in Vercel:
   - `CRM_API_URL`
   - `CRM_SECRET`
5. Deploy with the default Next.js settings:
   - Install Command: `npm install`
   - Build Command: `npm run build`
   - Output Directory: leave default

You can copy the variable names from `.env.example`.

Recommended production setup:

- Keep `CRM_SECRET` enabled on the Supabase edge function
- Keep `CRM_API_URL` pointed at the production Supabase project
- Do not expose Supabase edge secrets to client components

## Current Limitations

- The dashboard relies on the latest bookings/messages returned by the existing backend and does not yet have server-side pagination.
- Search and quick filters run client-side on the loaded dataset.
- The UI is resilient to partial Retell extraction data, but sparse records may still show many fallback values.

## Useful Files

- `src/app/page.tsx`
- `src/components/Dashboard.tsx`
- `src/app/api/crm/route.ts`
- `src/utils/api.ts`
- `src/utils/format.ts`
- `src/types/crm.ts`
