# Sugar Rush 🍭

Internal ordering and delivery app for a small family-run candy store.
Installable PWA (iPhone + Android), mobile first, all UI in English.

- **Customers** open the public link, tap sweets, optionally leave name/phone/address/notes, and send.
- **Owner** sees every order, creates deliveries received by message, sets amounts / driver's cut / payment method, edits the menu, manages drivers, and settles payouts.
- **Drivers** see open deliveries live, tap **I'll take it** (first tap wins), start a multi-stop route in Google/Apple Maps, mark **Delivered**, and see what they kept vs. owe the owner.
- Every new order is posted to the family **Telegram** group (optionally also taken / delivered), plus optional web **push** notifications.

## Stack

Vite + React + Tailwind · Vercel serverless API (`/api`) · Neon Postgres via Drizzle ORM · own session auth (scrypt + httpOnly cookie).

```
api/[...path].ts   single serverless function (router in lib/)
lib/               schema, db, auth/security, routes, Telegram + push
src/               React app (customer page, owner screens, driver screens)
public/            manifest, service worker, icons, splash screens, 26 placeholder sweets
scripts/           migrate, seed, asset generator, VAPID keys, local API server
drizzle/           SQL migrations
tests/             API integration tests (need a Postgres)
```

## Setup

1. **Neon**: create a database and copy the connection string.
2. **Vercel**: import this repo. Add the environment variables below (Production + Preview).
   The build runs `db:migrate` and `db:seed` automatically (both are idempotent).
3. **Owner login**: set `OWNER_USERNAME` / `OWNER_PASSWORD` before the first deploy (the owner is only created if none exists).
   Log in, then change the password under **Team → My password** and remove `OWNER_PASSWORD` from Vercel if you like.
4. **Telegram**: create a bot with @BotFather, add it to the family group, put the bot token and the group's chat id in the env vars.
   (Chat id: send a message in the group, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `chat.id`; group ids are negative.)
5. **Push (optional)**: `npm run vapid`, copy the three values into Vercel. On iPhone, push only works after *Add to Home Screen*.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon connection string (server only) |
| `SESSION_SECRET` | 16+ random chars, signs the public-form token |
| `OWNER_USERNAME`, `OWNER_NAME`, `OWNER_PASSWORD` | first owner account (10+ char password) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | family group alerts |
| `TELEGRAM_NOTIFY_STATUS` | `false` = only alert on new orders |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | web push |
| `STORE_TZ` | timezone for "today / this week" (default `America/New_York`) |

Forgot the owner password: `OWNER_PASSWORD='new-password-here' npm run db:reset-owner` (with `DATABASE_URL` set).

## Local development

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL, SESSION_SECRET, OWNER_PASSWORD
npm run db:migrate && npm run db:seed
npm run dev:api &           # API on :3000
npm run dev                 # app on :5173 (proxies /api)
```

Tests (real Postgres required, the schema is wiped!):

```bash
TEST_DATABASE_URL=postgres://user@localhost:5432/sugar_test npm test
```

## Using it

- Customer link: your domain `/`. Staff log in at `/app` (install this one to the home screen).
- Driver accounts are created by the owner under **Team** (no public sign-up). **Force logout** and **Log out all** end sessions immediately; **Remove** disables the account and returns its unfinished deliveries to the open list.
- Money: only the owner can set amount, payment method and driver's cut. "Owes owner" auto-fills as amount − cut and stays editable.
- Payouts: today/this week come from delivered orders; the owner taps **Settled** per driver (or per order).
- Menu: **Menu** tab → rename, change price, tap the picture to upload a photo, hide an item, or reset to the built-in sweet.
- Archive: delivered orders can be archived one by one or in bulk (30+ days); archived orders are hidden from drivers and the default list but still count in payouts until settled.
- Repeat last order: customers' phones remember their last order on the device; the owner's **New** form finds returning customers by phone or name and repeats their last order. (The public page never reads server data.)
- Logo: replace `public/logo.svg`, delete nothing else, run `npm run assets` to rebuild icons and splash screens.

## Security notes

- No public sign-up; sessions are random 256-bit tokens stored hashed in the DB, sent in an `HttpOnly; Secure; SameSite=Lax` cookie (90 days, sliding).
- Passwords: scrypt with per-user salt; login is rate limited and constant-time for unknown users.
- Every API route declares its access level (`public | user | owner | driver`); drivers only receive open orders and their own, only the owner can write amounts, menu and users.
- Public order endpoint: create-only, rate limited per IP and globally, honeypot field, signed time-gated token, prices always taken from the server menu.
- State-changing requests must come from the app's own origin (CSRF); strict CSP, HSTS, no framing, no referrer; no secrets in the repo or the browser.
- Input is validated with zod, control characters stripped, Telegram messages HTML-escaped, SQL is parameterised (Drizzle).
