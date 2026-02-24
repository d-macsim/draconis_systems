# Draconis Systems Website

Static-first marketing + lead-generation website for a custom PC building company.

## Stack
- Astro + TypeScript
- Preact islands for reactive UI only
- Netlify hosting + serverless lead API
- Content collections (Markdown) + JSON datasets

## Routes
- `/`
- `/projects`
- `/projects/[slug]`
- `/updates`
- `/configurator`
- `/about`
- `/process`
- `/faq`
- `/contact`
- `/terms`
- `/privacy`
- `/warranty`
- `/404`

## Local Setup
1. Install Node.js 20.11+.
2. Install dependencies: `npm install`
3. Copy env template: `Copy-Item .env.example .env`
4. Start dev server: `npm run dev`
5. Run checks: `npm run build`
6. Run tests: `npm test`

## Environment Variables
Use `.env.example` as the source of truth.

### Public
- `PUBLIC_SITE_URL`
- `PUBLIC_SITE_NAME`
- `PUBLIC_PLAUSIBLE_DOMAIN`
- `PUBLIC_ANALYTICS_REQUIRE_CONSENT`
- `PUBLIC_TURNSTILE_SITE_KEY`

### Server
- `TURNSTILE_SECRET_KEY`
- `LEADS_TO_EMAIL`
- `LEADS_FROM_EMAIL`
- `RESEND_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_LEADS_TABLE`

## Lead Pipeline
`POST /.netlify/functions/lead-submit`

- Validates and sanitizes payload.
- Honeypot spam field short-circuits bots.
- Optional Turnstile verification.
- Best-effort rate limiting per IP.
- Sends email via Resend and stores backup record in Supabase.
- Success response: `{ "ok": true, "leadId": "..." }`
- Failure response: `{ "ok": false, "code": "...", "message": "..." }`

## Content Management
- Projects: `src/content/projects/*.md`
- Updates: `src/content/updates/*.md`
- Services: `src/data/services.json`
- FAQ: `src/data/faq.json`
- Configurator catalog/rules: `src/data/configurator/*.json`

## Performance and QA
- Lighthouse config: `.lighthouserc.json`
- Tests: `tests/`
- No heavy frontend framework hydration on static pages.

## Notes
- Placeholder dragon-head logo is located at `public/images/logo-placeholder.svg`.
- Legal pages use starter templates and must be reviewed by legal counsel before launch.
