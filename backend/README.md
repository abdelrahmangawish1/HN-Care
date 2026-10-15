# HN-Care backend

This folder contains the Express APIs and optional legacy PostgreSQL
integration. The Firebase patient dashboard and lightweight pharmacy/assistant
API do not need PostgreSQL. The database-backed sign-in server is a separate
legacy option. This is not a production or regulatory-compliance
certification.

## Optional: prepare PostgreSQL for the legacy auth server

Make sure PostgreSQL is installed, running, and listening on the host and port
in `.env` (the defaults are `localhost:5432`). In PowerShell, connect to the
local PostgreSQL administrator:

```powershell
psql -U postgres -h localhost
```

At the `psql` prompt, create a dedicated application role:

```sql
CREATE ROLE hn_care_app LOGIN;
```

Set a unique password without placing it in the command history:

```text
\password hn_care_app
```

Then create the development database and exit:

```sql
CREATE DATABASE hn_care OWNER hn_care_app;
\q
```

## Optional: configure the legacy auth server

From this `backend` folder, copy the example:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set `PGPASSWORD` to the role password you just chose. Generate
a different random session secret for this installation:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put that output in `SESSION_SECRET`. Do not share or commit `.env`; it is
excluded by `.gitignore`. Use a managed secret store in production instead of
a local `.env` file.

## Configure Firebase for the web app

The Firebase patient dashboard does not use PostgreSQL. For the pharmacy and
assistant APIs, start the lightweight service server from the repository root
with `npm run dev:api`; it listens on `http://localhost:3001` and does not
require PostgreSQL or the legacy session secret.

The static frontend production bundle is served by the service server at
`http://localhost:3001`.
The Firebase web-app configuration is in `Frontend/firebase.js`; it is a
public client configuration, not a server credential. In the Firebase Console
for the configured project:

1. Add `localhost` to **Authentication → Settings → Authorized domains**.
2. Enable **Authentication → Sign-in method → Email/Password**.
3. Create the **Cloud Firestore** database.
4. Publish the repository's `firestore.rules` as the database's Firestore
   Security Rules. This includes the owner-only `users/{uid}/passport/current`
   emergency health summary and its strict field validation. The frontend
   cannot read or write private records until the current rules are published.
5. Review the password-reset email template and action URL under Authentication
   templates. The Firebase hosted action link completes the reset flow.
6. Enable Analytics only if it is wanted and permitted for the deployment.

Do not place Firebase Admin credentials or provider secrets in the frontend.
The old PostgreSQL sign-in endpoints remain available, but the HN-Care patient
dashboard uses Firebase Authentication and Firestore.

## 4. Optional AI assistant

The assistant route returns a clear unavailable response until its provider
is configured. Add these variables to `backend/.env` to enable the OpenAI
Chat Completions-compatible provider:

- `OPENAI_API_KEY`: secret key, backend only.
- `OPENAI_MODEL`: model identifier enabled for the account.
- `OPENAI_BASE_URL`: optional HTTPS Chat Completions endpoint; defaults to
  `https://api.openai.com/v1/chat/completions`.

Never use a frontend-prefixed variable for the secret. The browser sends only
the current question and selected language; it does not attach Firestore data
or the user's health records.

## 5. Install, build, and run

From the repository root, install the frontend dependencies and build the
static frontend bundle:

```powershell
npm install
npm run build
```

For development, use two terminals in the repository root:

```powershell
npm run dev:api
```

```powershell
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`).
Vite's dev and preview servers proxy `/api` requests to `http://localhost:3001`.
For a production-build preview, run `npm run build` and `npm run preview` in
place of `npm run dev` (while keeping `npm run dev:api` running). Do not open
the frontend with VS Code Live Server or `file://`; those do not proxy `/api`,
which makes the assistant and pharmacy search unavailable.

The normal Firebase app does not need PostgreSQL. Start the lightweight
service API from the repository root with `npm run dev:backend` if you prefer
that command instead of `npm run dev:api`. Both commands run the same service
server and need no `SESSION_SECRET`.

Only prepare the legacy database-backed auth server if you specifically intend
to use its separate PostgreSQL auth API:

```powershell
npm install
npm run db:setup
npm test
npm run dev
```

`db:setup` creates the initial `users` table. `npm test` checks password
hashing and APIs locally and does not need a running database. The legacy
server can still be started explicitly with `npm run legacy:dev` from the
`backend` folder; it requires PostgreSQL and a valid `SESSION_SECRET`. For
production-style serving of the Firebase frontend and lightweight APIs, run
`npm run build`
from the repository root, then run `npm run dev:api`; Express serves the
generated `Frontend/dist` bundle and the same-origin APIs. PostgreSQL and
`SESSION_SECRET` are required only if the separate legacy PostgreSQL
authentication server is used.

## API endpoints currently available

- `GET /api/health` checks that Express is responding.
- `GET /api/db-health` checks that PostgreSQL can answer a query.
- `POST /api/auth/register` creates an account using `fullName`, `email`, and
  a password of at least 12 characters.
- `POST /api/auth/login` checks the account credentials.
- `POST /api/auth/logout` ends the current session.
- `GET /api/auth/me` returns the signed-in user's basic profile.
- `GET /api/assistant/status` indicates whether an AI provider is configured.
- `POST /api/assistant` sends one educational question to the configured
  server-side provider; without configuration it returns HTTP 503.
- `POST /api/pharmacies` validates a coordinate/radius request and proxies a
  bounded pharmacy search to Overpass, avoiding browser CORS failures.
- `GET /api/pharmacies/geocode?q=...&language=...` geocodes a manually entered
  place through Nominatim, avoiding browser CORS restrictions.
- `GET /api/medications/interactions?medications=name%7Cname` searches U.S. FDA
  drug-label text through openFDA for explicit mentions of another submitted
  medicine. It is rate-limited and returns source excerpts, not a complete
  interaction check, clinical severity rating, or proof that an unmentioned
  combination is safe. The submitted medicine names are sent to openFDA for
  lookup and are not persisted by this service.

The signed-in medication schedule is stored at
`users/{uid}/medications/{medicationId}` and is protected by the same UID-bound
Firestore rules as the patient profile and records. Lab-result text and files
are read and previewed only in the browser; they are not uploaded or saved.

The emergency health passport is stored at
`users/{uid}/passport/current`. Its QR is generated in the browser and is not
sent to a QR service; the QR contains the selected emergency details in
readable, unencrypted form. Generate/share it only after reviewing the
disclosure. BMI, water-reference, calorie, and symptom-triage tools run in the
browser and do not store or submit the entered values.

Egyptian medicine lookup links to the Egyptian Drug Authority's public
medicines/services page. HN-Care has no connected, verified public machine
readable feed for current Egyptian prices, registered active ingredients, or
generic equivalence, so the interface deliberately does not return invented
prices or substitutions. Confirm product, strength, pack, and current price
with a pharmacist or the EDA.

The legacy PostgreSQL auth API stores a derived password hash, not the
original password. Database queries that include user input use PostgreSQL
placeholders such as `$1`. Sessions are stored in PostgreSQL, and the browser
session cookie is HTTP-only. Firebase reset emails are supported by the
frontend; email verification, production deployment review, and regulatory
compliance remain outside this starter implementation.
