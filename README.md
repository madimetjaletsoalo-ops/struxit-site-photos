# STRUXIT Site Photos — server-backed version

This is the migrated version of the chat artifact demo, with a small Express
server added so it can authenticate against Autodesk Platform Services (APS)
and push sorted photos straight into ACC/BIM 360 project folders.

## What's here

```
site-sorter-app/
  package.json
  .env.example
  server/
    index.js   — Express app: OAuth routes + API endpoints
    aps.js     — APS OAuth + Data Management API calls (folders, upload)
  public/
    index.html — the map/sort/review UI, now wired to the APS endpoints:
                 connect to Autodesk, pick a hub/project/folder, and upload
                 the sorted photos straight into ACC (ZIP export still works too)
```

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `APS_CLIENT_ID` / `APS_CLIENT_SECRET` — from your app on
     https://aps.autodesk.com (My Apps / your Developer Hub)
   - `APS_CALLBACK_URL` — must exactly match the callback URL you registered
     for the app, e.g. `http://localhost:3000/auth/callback`
3. `npm start`
4. Open `http://localhost:3000` and use the **Connect to Autodesk** button in
   the Export step to sign in and grant consent.

See "How to run this (demo walkthrough)" below for the full end-to-end flow.

## What the server already does

- `GET /auth/login` → sends you to Autodesk's login/consent screen
- `GET /auth/callback` → exchanges the code for an access + refresh token,
  stored in a signed session cookie (fine for a single-user demo; not
  meant for multiple simultaneous users as-is)
- `GET /auth/status` → `{ loggedIn: true|false }`, used by the UI on load to
  decide whether to show "Connect to Autodesk" or the hub/project/folder picker
- `GET /api/hubs`, `/api/hubs/:hubId/projects`,
  `/api/hubs/:hubId/projects/:projectId/topfolders` → browse into your ACC
  account to find the project and root folder you want to use
- `POST /api/projects/:projectId/folders` → create a folder
  (`{ parentFolderId, name }`)
- `POST /api/projects/:projectId/folders/:folderId/upload` → upload a single
  file into a folder (multipart form field `file`)
- `GET /api/sites` → returns the saved site polygons (`[]` if none yet)
- `PUT /api/sites` → overwrites the saved set with a JSON array of sites
  (see "Data storage" below)

## How to run this (demo walkthrough)

Prerequisites: Node.js 18+ (tested on Node 24), and an APS app registered at
https://aps.autodesk.com with a callback URL of
`http://localhost:3000/auth/callback` and access to the ACC/BIM 360 account
you want to upload into.

1. **Install & configure** (one-time):
   ```
   npm install
   cp .env.example .env      # then edit .env with your real APS credentials
   ```
   Fill in `APS_CLIENT_ID`, `APS_CLIENT_SECRET`, keep `APS_CALLBACK_URL` as
   `http://localhost:3000/auth/callback`, and set any random `SESSION_SECRET`.

2. **Start the server:**
   ```
   npm start           # or: npm run dev  (auto-restarts on file changes)
   ```
   You should see `STRUXIT Site Photos server running on http://localhost:3000`.

3. **Open** `http://localhnost:3000` in your browser.

4. **Connect to Autodesk** — scroll to step 4 (Export). The "Autodesk
   Construction Cloud" panel shows *Not connected*; click **Connect to
   Autodesk**, sign in, and grant consent. You'll be redirected back and the
   panel flips to *Connected*.

5. **Pick a destination** — choose a **Hub → Project → Destination folder**
   from the three dropdowns (each unlocks the next).

6. **Do the actual sorting** (steps 1–3 on the page):
   - draw one or more site polygons on the map and name them,
   - drop in photos (JPEG/HEIC with GPS metadata sort automatically; anything
     without location lands in "Unsorted"),
   - review the auto-assignments and reassign any photo via its dropdown.

7. **Add a visit purpose (optional)** — in the Review step, each date sub-heading
   has an "add purpose…" box (e.g. *Site inspection*, *Snagging*, *Technical
   meeting*). Start typing and the suggestion list filters; you can also type
   your own. The purpose is appended to that date's folder name — see below.

8. **Export** — first enter **Your initials** in the Export step (required —
   they're added to every folder name; remembered for next time). Then either
   **Download ZIP** (a folder per site, a subfolder per date), or **Upload to
   ACC**, which creates the same `Site/Date/` structure inside your chosen
   destination folder and uploads each photo. A live log shows per-file progress
   and any failures. Folders are named `YYYY-MM-DD - Purpose - Initials`.

Demo tip: photos need GPS EXIF to auto-sort. If your sample images have no
location data they'll all show as "Unsorted" — just reassign them manually
with the dropdowns before exporting.

## Folder naming, visit purpose & initials

Both exports use the structure `Site / Date / photo.jpg`. Each date folder is
named from the non-empty parts of `Date - Purpose - Initials`, joined with
` - `. Initials are always present (required); the purpose is optional, so a
date with no purpose collapses cleanly to `Date - Initials` (no empty gap). For
example, with initials `JD`:

```
KwaMashu SC/
  2026-07-27 - Site inspection - JD/
    IMG_4221.JPG
  2026-08-03 - JD/            # no purpose set for this date
    IMG_4400.JPG
```

- **Purpose** is **per site + date**, so the same day can be labelled
  differently under different sites. Entered in the Review step; the suggestion
  list lives in the `<datalist id="purposeOptions">` in `public/index.html` —
  edit that list to change the offered purposes. Any free-text value is allowed.
- **Initials** are a single **global** value entered in the Export step and
  applied to every folder. Export/upload is blocked until they're filled in.
- Purposes are **session-only** (held in memory, not saved), because dates come
  from the photos you drop in each session. Initials are remembered per browser
  (see below).

### Initials & identity — migration plan

- **Now (local testing):** initials are a free-typed field, remembered in the
  browser via `localStorage` (key `siteSorter.initials`) so the same person
  doesn't retype them each session. This is per-browser and self-declared — fine
  for a single-user local tool, but not verified or shared.
- **For deployment:** replace the free-typed box with the **authenticated
  user's identity**. Once real login exists (derive it from the Autodesk/APS
  logged-in user via the userprofile API, or from an app user record), use that
  name/initials so every folder is reliably attributable and can't be spoofed —
  and store it per-user server-side (alongside the sites store) rather than in
  `localStorage`. The UI would then show the signed-in name instead of an input.

## Notes on the ACC upload

- Folder names use the same sanitiser as the ZIP export, so the ACC structure
  mirrors the ZIP exactly (including the ` - Purpose` and ` - Initials` suffixes).
- Re-running an upload into the **same** destination will likely fail with a
  `409` when it tries to recreate an already-existing site/date folder — the
  UI surfaces that per group in the log and keeps going. Reusing existing
  folders (rather than creating fresh ones) would mean listing folder contents
  first; that's not implemented yet.

## Data storage

Site polygons (the boundaries you draw in step 1) are persisted in a
**Supabase Postgres** table, so they survive a refresh, a restart, or a
redeploy (needed since the app runs on Render's free tier, which has no
persistent disk).

- **Where:** the `sites` table in your Supabase project. Schema:
  ```sql
  create table sites (
    id      text primary key,
    name    text not null,
    color   text,
    latlngs jsonb not null
  );
  ```
- **What's stored:** one row per site — `id`, `name`, `color`, and `latlngs`
  (the polygon's `[[lat, lng], …]` coordinates, stored as `jsonb`). The
  Leaflet map layer is *not* stored — it's rebuilt from `latlngs` on load.
- **What's NOT stored:** uploaded photos and their site assignments. Photos are
  read locally each session; only the site boundaries persist.
- **How it's accessed:** `server/db.js` talks to Supabase using the
  **service role key** (server-side only, bypasses Row Level Security) — see
  `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` in `.env.example`.
- **When it's written:** automatically, every time you add, rename, or remove a
  site (the UI `PUT`s the full set to `/api/sites`, which does a delete-all +
  reinsert against the `sites` table). On page load the UI `GET`s
  `/api/sites` and redraws the saved polygons.
- **`data/sites.json`:** still in the repo (gitignored) as the source for the
  one-off `scripts/seed-sites.js`, which loads it into Supabase. It's not read
  by the running server anymore.

Current limitations (fine for single-user use, revisit before sharing): it's
one shared `sites` table for whoever opens the app — not per-user — and
concurrent writes aren't locked, so two browsers saving at the exact same
moment could race.

### Migration plan (per-user scoping)

The frontend only ever talks to `GET /api/sites` and `PUT /api/sites`, so
further storage changes can happen without touching the UI:

1. **Move to per-record writes.** The current `PUT /api/sites` rewrites the
   whole set on every change, which is wasteful against a DB. Add granular
   endpoints — `POST /api/sites` (create), `PUT /api/sites/:id` (update),
   `DELETE /api/sites/:id` (remove) — and have the UI call the one that
   matches the action instead of resending everything.
2. **Scope to a user/account.** Once login identity is available (from the APS
   token or a separate app login), add an `owner`/`account` column and filter
   sites by owner so each user sees only their own.
3. **Consider photos + assignments** if you later want a full session to be
   restorable — that means storing the image files (e.g. object storage) and a
   `photos` table linking filename → site → date. Deliberately out of scope for
   now.

## Deploying to Render

The repo includes `render.yaml` (a Render Blueprint) so the free-tier web
service can be provisioned in one step:

1. **Create the Supabase table** — run the `create table sites (...)` SQL
   above in your Supabase project's SQL editor.
2. **Seed existing data (optional)** — with `.env` filled in locally
   (`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`), run
   `node scripts/seed-sites.js` to copy `data/sites.json` into the new table.
3. **Deploy** — in the Render dashboard: New → Blueprint → connect this
   GitHub repo. Render reads `render.yaml` and provisions the service. Fill in
   the env vars it prompts for (`APS_CLIENT_ID`, `APS_CLIENT_SECRET`,
   `APS_CALLBACK_URL`, `SESSION_SECRET`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`) in the Environment tab.
4. **Update the APS callback** — once Render assigns a URL (e.g.
   `https://struxit-site-photos.onrender.com`), register
   `https://struxit-site-photos.onrender.com/auth/callback` as the callback
   URL at aps.autodesk.com, and set `APS_CALLBACK_URL` in Render to match.

Note: the free plan sleeps after ~15 minutes idle, so the first request after
a while takes a few seconds to wake up.

## A few honest caveats

- This has not been run against a live APS app — the OAuth and Data
  Management calls are built to the documented v2 API shapes, but treat this
  as a solid first draft to debug against your actual credentials, not
  guaranteed-correct code.
- Session storage here is a signed cookie holding the token in memory —
  fine for local development, not production-ready auth.
- No retry/backoff logic on API rate limits (APS enforces per-endpoint
  limits) — worth adding once the happy path works.
