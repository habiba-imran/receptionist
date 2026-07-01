# WhatsApp / Green API Setup

This project now sends post-call messages only through WhatsApp when the caller agreed to WhatsApp on the Retell call.

## Current Logic

- If `whatsapp_suitable = true`, Supabase sends WhatsApp through Green API.
- If `whatsapp_suitable = false`, no post-call message is sent.
- There is no SMS fallback in this setup.

## Country Code

Phone normalization now defaults to country code `92`.

Examples:

- `3012345678` -> `+923012345678`
- `+923012345678` -> `+923012345678`

## What Message Is Sent

### If `intake_method = voice`

The confirmation message includes:

- first name
- reason
- appointment timing
- patient status
- insurance summary
- assigned doctor

### If `intake_method = form`

The form-link message includes only the details already collected during the call:

- first name
- reason
- appointment timing
- patient status

Then it includes the secure form link for insurance/intake completion.

## Supabase Secrets To Set

Set these in the Supabase project where the edge functions are deployed:

```text
GREEN_API_URL=https://api.green-api.com
GREEN_ID_INSTANCE=your_green_api_instance_id
GREEN_API_TOKEN=your_green_api_token

FORM_BASE_URL=https://your-intake-form-site.vercel.app
DEFAULT_DOCTOR=Dr. Adeel Rahman
RETELL_SHARED_SECRET=your_retell_shared_secret
CRM_SECRET=your_crm_secret
```

## Vercel Variables

### `crm-ui`

Set:

```text
CRM_API_URL=https://xyvsrxgxcjauyqzhomru.supabase.co/functions/v1/crm-api
CRM_SECRET=your_crm_secret
```

### `intake-form-site`

This form site is static and currently uses `config.js`, not runtime Vercel env vars.

Before deploy, update:

- `intake-form-site/config.js`

to:

```js
window.INTAKE_FORM_CONFIG = {
  submitUrl: "https://xyvsrxgxcjauyqzhomru.supabase.co/functions/v1/submit-form",
};
```

## Recommended Deployment Order

1. Deploy updated Supabase function code:
   - `retell-webhook`
   - `submit-form`
   - `crm-api`
2. Deploy `intake-form-site`
3. Set `FORM_BASE_URL` in Supabase secrets to the deployed intake form URL
4. Test:
   - voice intake + WhatsApp allowed
   - form intake + WhatsApp allowed
   - no-message case when WhatsApp was not chosen

## Verification

Check `public.bookings`:

```sql
select
  call_id,
  contact_number,
  whatsapp_suitable,
  intake_method,
  form_status,
  confirmation_status,
  confirmation_channel
from public.bookings
order by created_at desc
limit 20;
```

Check `public.message_log`:

```sql
select
  created_at,
  call_id,
  purpose,
  channel,
  provider,
  status,
  to_number,
  error
from public.message_log
order by created_at desc
limit 20;
```
