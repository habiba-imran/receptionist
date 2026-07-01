# Intake Form Site

Standalone patient intake form for the Retell `form` path.

## What It Does

- Reads `cid` and `lang` from the query string
- Posts JSON to the deployed Supabase `submit-form` edge function
- Collects required patient and insurance fields
- Shows conditional sections for:
  - insurance-only fields
  - subscriber fields
  - secondary coverage
  - prior authorization
  - plan changes

## Files

- `index.html`
- `styles.css`
- `app.js`
- `config.js`

## Before You Run

Update `config.js`:

```js
window.INTAKE_FORM_CONFIG = {
  submitUrl: "https://YOUR_SUPABASE_PROJECT.supabase.co/functions/v1/submit-form",
};
```

Use your real deployed Supabase `submit-form` function URL.

## Local Preview

From the repo root:

```powershell
cd intake-form-site
py -m http.server 4173
```

Then open:

```text
http://localhost:4173/?cid=test-call-id&lang=en
```

If `py` is unavailable, try:

```powershell
python -m http.server 4173
```

## Deploy Later

This folder is plain static HTML/CSS/JS, so it can be deployed to Vercel as a static site.

For Vercel:

1. Import the repo
2. Set root directory to `intake-form-site`
3. No build command is required
4. Keep output settings default for a static site
5. Before deploying, make sure `config.js` points to the real `submit-form` URL

## Important Follow-Up After Deploy

Once this site is deployed, update the Supabase secret/config used by `retell-webhook` and `crm-api` so `FORM_BASE_URL` points to the deployed intake form URL.

Example:

```text
https://your-form-site.vercel.app
```

The messaging code will append:

- `?cid=...`
- `&lang=...`
