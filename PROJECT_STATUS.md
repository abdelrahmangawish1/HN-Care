# HN-Care project status

Audit and implementation update: 2026-10-15

Latest follow-up: separated Firebase account creation from optional profile
display-name syncing, improved Firebase/Firestore error guidance, and added a
standalone API server so maps and assistant status no longer require the legacy
PostgreSQL server. The Vite preview server now proxies API requests as well as
the dev server, and starting a pharmacy search clears any prior locations.
The observed Firebase `auth/configuration-not-found` response now has a
specific translated explanation and exact Firebase Console setup steps. The
backend's ordinary `dev` command now starts the lightweight API; the legacy
PostgreSQL server is available through the explicit `legacy:dev` command.
Latest UI work adds a local-only prescription/medicine image preview and
Egypt-centered pharmacy and medical-facility search; the image is not uploaded
or interpreted and the app does not recommend medicines. Emergency service
cards for 123, 105, and 137 are now added with direct telephone links; the
contact form opens a prefilled draft in the visitor's email app and does not
claim server-side delivery.
Latest safety-tools work adds FDA-label interaction searching with explicit
limitations, a UID-scoped medication schedule and daily taken/pending tracking,
a linked first-aid guide, and a local-only plain-text/CSV lab-results viewer.
None of these tools provides clinical interpretation or dosing recommendations.
Latest HealthTech update adds a private emergency passport with local QR
generation, a red-flag-first symptom guide, and adult BMI/water/energy
calculators. The Egyptian medicine-price UI links to the official EDA services
page but does not fabricate results: a verified public machine-readable
Egyptian price/generic catalogue is not connected.
Latest visual update applies an Emerald-to-Cyan MedTech glass theme, a mobile
RTL navigation menu in the requested order, and an Arabic-first landing hero.
The hero describes image preview and medicine information accurately; it does
not claim prescription analysis or medical supervision.
Latest medical-guidance update adds a local-only lab-image preview and
source-linked educational cards for IV fluids, tetanus/rabies immune products,
and snake antivenom. The cards explicitly prohibit self-administration and
direct users to clinical care; the map is not represented as confirming stock
or emergency response. The MVP disclaimer now states that the platform does
not provide clinical supervision. No AI/OCR lab or prescription analysis has
been implemented, and no 100% medical-supervision claim is made.
Latest accessibility/share update adds a pharmacy filter for records carrying
an exact OpenStreetMap `opening_hours=24/7` tag, user-entered prescription and
lab text export through browser print-to-PDF or WhatsApp, and a persistent
larger-text/high-contrast mode. The pharmacy filter does not claim live opening
or availability; exported summaries contain text only and are not clinically
reviewed by HN-Care.

## Audit findings

- [x] Frontend is a plain HTML/CSS/JavaScript application in `Frontend/`; it has no frontend framework or client router. Vite now bundles its npm dependencies.
- [x] Existing frontend was an Arabic informational landing page with a mobile menu and Firebase Analytics initialization.
- [x] Root npm manifest now owns the Firebase web SDK and Vite; browser modules import Firebase from npm packages.
- [x] Legacy backend is an Express application in `backend/` with PostgreSQL, password hashing, database-backed HTTP sessions, and register/login/logout/current-user routes.
- [x] A separate lightweight Express API (`npm run dev:api`, port 3001) serves the pharmacy and assistant routes without PostgreSQL or the legacy session secret.
- [x] `npm run dev:backend` / `npm --prefix backend run dev` start the lightweight API and no longer fail due to missing legacy PostgreSQL session configuration.
- [x] Before this update there was no Firebase Authentication/Firestore integration, health dashboard, pharmacy map, medication center, AI route, or centralized translations.

## Feature checklist

### Authentication and database

- [x] Firebase email/password registration and sign-in code.
- [x] Sign-out and browser-local Firebase Auth session persistence code.
- [x] Password-reset email flow; Firebase handles the linked reset action.
- [x] Dashboard is hidden until Firebase reports an authenticated user.
- [x] User profile at `users/{uid}` and health records under `users/{uid}/records`.
- [x] Firestore profile and record create/read/update/delete operations, client validation, timestamps, loading, success, and error states.
- [x] Firestore rules restrict each user's documents to their own Firebase Auth UID and validate allowed record fields/categories.
- [x] Authentication errors distinguish unauthorized domains, disabled Email/Password sign-in, invalid credentials/configuration, Firestore rule denials, and an uncreated Firestore database.
- [x] `auth/configuration-not-found` directs the user to initialize Firebase Authentication and enable Email/Password for the configured Firebase project.
- [ ] Firebase Console setup, rules publication, and live authentication/Firestore access (manual and not verified in this environment).

### Patient dashboard

- [x] Personal profile and optional birth date.
- [x] Medical history, chronic conditions, allergies/reactions, current medication, previous conditions, and medical notes.
- [x] Record create/edit/delete, creation/update timestamps, per-user separation, and Firestore persistence after refresh.
- [x] No fictional sample records are seeded or shown as real patient data.
- [ ] Live persistence and cross-account isolation against the configured Firestore project (requires Console setup).
- [x] Emergency digital health passport preview with blood type, chronic conditions, and drug allergies.
- [x] Passport data stored separately at `users/{uid}/passport/current`, with owner-only Firestore rules and field validation.
- [x] QR code generated locally in the browser only after consent; contains only name and selected emergency fields, is not uploaded, and is explicitly disclosed as readable/unencrypted.
- [ ] Live passport persistence and account-isolation validation (requires Firebase Console rule publication and configured auth).

### Pharmacy map

- [x] Leaflet and OpenStreetMap map with a same-origin Express proxy to real Overpass pharmacy data (the proxy is required because the browser call was blocked by Overpass CORS).
- [x] Explicit user-initiated browser geolocation and manual city/address search fallback.
- [x] Pharmacy markers, available name/address details, OpenStreetMap links, loading/empty/error states.
- [x] Interface states that map listings do not verify opening hours or medication stock.
- [x] Map initially centers on Egypt; users can select pharmacies or medical facilities, enter a place manually, or explicitly grant browser geolocation.
- [x] Medical-location search queries mapped hospitals, clinics, doctors, health centres, and ambulance stations; cards show available mapped address/contact information and links.
- [x] Medical facilities are labeled from OpenStreetMap tags without claiming that emergency services are active or available.
- [x] Emergency section lists the requested Egyptian ambulance (123), Ministry of Health hotline (105), and hospital emergency/transfer hotline (137), each with a direct `tel:` link and an immediate-emergency disclaimer.
- [x] API health and Vite `/api` proxy verified while both local servers were running; Overpass and Nominatim behavior are covered by mocked route tests.
- [x] Vite preview `/api` proxy verified at `127.0.0.1:4173`; `/api/health` and `/api/assistant/status` both returned valid JSON from the API.
- [x] Live manual city search tested in the browser through Nominatim and Overpass; the query returned 200 pharmacy results and the map rendered. A first attempt failed upstream, so the API now sends an explicit JSON `Accept` and identifying `User-Agent` header.
- [x] Verified a subsequent city search that received upstream HTTP 502 clears previous pharmacy cards and map markers and displays the translated map-service error (rather than stale locations or a false success).
- [ ] Browser location permission flow (not exercised; requires the user's explicit browser permission).

### Medication Safety Center

- [x] Responsive prescription/medicine image picker and drag/drop preview with supported image types, 5 MB limit, remove action, and object-URL cleanup.
- [x] The image stays in local browser preview only; the UI explicitly says it is not uploaded or analyzed and does not provide OCR or medicine recommendations.
- [x] Medication-name search through the U.S. National Library of Medicine RxNorm API.
- [x] Links to RxNorm and official DailyMed labeling, clear limitations, and no invented warnings, interactions, doses, or substitutions.
- [x] Empty, loading, unavailable, and error states.
- [x] RxNorm search smoke-tested in the browser with a generic medicine query; results and source links rendered.
- [ ] DailyMed source link and complete medication lookup flow (not opened end-to-end).
- [ ] Inline parsing/display of label warnings and interaction sections; users are directed to the authoritative label instead of having unverified warnings summarized.
- [x] Added an interaction-search API that returns explicit medicine-name mentions found in FDA label interaction text, with excerpts and source links.
- [x] The interface labels only source-text mentions; it does not infer a clinical severity score or claim that an unmentioned combination is safe.
- [x] Interaction lookup validates 2–5 distinct Latin-script medicine names and reports missing labels, rate limits, and upstream failures.
- [ ] FDA label lookup is not a complete or personalized interaction checker. Comprehensive coverage and clinical validation require a qualified/appropriately licensed data provider.
- [x] Added an account-specific medication schedule under `users/{uid}/medications` with add/edit/delete, scheduled time, prescribed user-entered instructions, daily taken/pending status, persistence, and progress.
- [x] Added owner-only Firestore rules and data validation for medication schedules.
- [ ] Live Firebase schedule persistence, cross-account isolation, and deployed-rule behavior require Firebase Console configuration and have not been verified here.
- [x] Added a quick first-aid guide for burns, adult CPR, fainting, and adult choking, with emergency guidance and named source links.
- [x] Added a local TXT/CSV/pasted-results viewer with size/row limits; inputs are not uploaded or stored and no lab interpretation is claimed.
- [x] New UI and safety strings have matching translations in all five supported languages.
- [x] Egypt medicine name/active-ingredient input opens the official Egyptian Drug Authority medicines/services page with explicit limitations and pharmacist-verification guidance; the query is not sent or falsely represented as a result.
- [ ] A verified machine-readable Egyptian current-price, product/ingredient, and generic-equivalence source is not connected; therefore no price or substitute result is shown. Integrate only after obtaining a stable official feed and validating products/strengths/packs.

### Symptom guide and health indicators

- [x] Symptom guide runs entirely in the browser and does not send or save entered health information.
- [x] Red-flag answers take precedence and show emergency guidance with an Egyptian 123 telephone link.
- [x] Non-emergency topic selection suggests a broad specialty, with explicit wording that the result is not a diagnosis and cannot rule out an emergency.
- [x] Adult BMI, total-water reference, and Mifflin–St Jeor energy estimates with range validation, accessible tabs/progress indicators, limitations, and source links.
- [x] New strings are translated in English, Arabic, French, Italian, and Simplified Chinese.
- [ ] Triage logic and nutrition calculators have not received clinician review and are not medical-device or individualized-care features.

### Emergency contacts and contact form

- [x] Responsive emergency contact cards with the requested Egyptian service numbers and direct-call links.
- [x] Contact form includes required name, email, and message inputs with browser validation.
- [x] Form opens a prefilled email draft; the visitor chooses the recipient and sends it from their email app. HN-Care does not claim to deliver or store the message.
- [x] Form warns users not to include private health information and not to use it for emergencies or medical advice.
- [x] Emergency and contact section copy is translated across all five languages.

### AI healthcare assistant

- [x] Express endpoint supports a configured HTTPS OpenAI-compatible Chat Completions provider using backend-only environment variables.
- [x] Provider readiness endpoint and explicit unconfigured state.
- [x] Request validation, rate limiting, timeout/provider error handling, educational-only system guidance, and emergency guidance.
- [x] Frontend sends only the current question and language; it does not attach Firestore data or health records.
- [ ] Real provider response (requires `OPENAI_API_KEY` and `OPENAI_MODEL`; no live secret/provider used). The UI now names the required backend-only environment variables and restart command when unconfigured.

### Multilingual UI and accessibility

- [x] Centralized English-default dictionaries for English, Arabic, French, Italian, and Simplified Chinese.
- [x] Language preference persisted in browser storage; Arabic uses RTL and all other languages LTR.
- [x] Navigation, landing content, forms, validation/status/empty/error states, dashboard controls, map, medication search, and assistant controls are translated.
- [x] Dynamic UI strings and record categories update when switching languages; user-supplied medical data and medicine names are not translated.
- [x] Responsive layouts, semantic form labels, status announcements, focus styles, and accessible menu controls.
- [x] Added map and image-preview UI strings exist in all five locale dictionaries.
- [ ] Full assistive-technology and real-device testing (not performed).

## Local verification

- [x] `npm test` — 11 tests passed, 0 failed. Covers password hashing, AI validation/configuration/mocked provider response, pharmacy proxy behavior, and medical-facility query validation.
- [x] `npm run build` — passed after adding emergency and contact sections; Vite emitted its existing non-blocking large JavaScript chunk warning.
- [x] Browser check at 390 px — emergency cards and direct links displayed, no horizontal overflow, and Arabic contact text switched successfully.
- [x] Translation dictionaries currently have identical key sets across all five supported languages (255 keys each).
- [x] Browser image-preview check — selected a local image, verified its preview and translated status, then removed it and verified the picker returned and selection cleared.
- [x] `node --check` — frontend app and the standalone API, pharmacy, and assistant route files passed.
- [x] Translation coverage check — 5 dictionaries with matching key sets (255 UI strings in the English dictionary).
- [x] Browser checks — Vite loaded npm-bundled Firebase modules; language switching, RTL/LTR changes, translated validation, and a live RxNorm search were observed.
- [x] Mobile-width browser check at 390 px — image picker remained visible within the viewport and the page had no horizontal overflow.
- [x] `npm run build` — passed. Vite emitted a non-blocking warning that the Firebase-containing JS chunk is above 500 kB (about 654 kB uncompressed).
- [x] `npm audit --omit=dev` — 0 production vulnerabilities after overriding the transitive `@grpc/grpc-js` dependency to a patched version.
- [x] Started `npm run dev:api` and `npm run dev`; checked `/api/health` and `/api/assistant/status` both directly and through Vite's proxy. API returned healthy; AI correctly reported `configured:false`.
- [x] Browser opened the running Vite app; all main sections rendered and the assistant showed its explicit not-configured message.
- [x] Browser manual pharmacy search for Paris returned 200 live Overpass results; pharmacy markers and result cards were rendered.
- [ ] Dedicated lint script — not configured in this project.
- [ ] Full-stack browser test — not run against the Express server, PostgreSQL, Firebase, or live external APIs.

### Latest safety-tools verification

- [x] `npm test` — 15 tests passed, 0 failed, including four mocked FDA-label interaction-route tests.
- [x] `npm run build` — passed; Vite emitted the existing non-blocking warning for a JavaScript chunk larger than 500 kB.
- [x] `node --check Frontend/app.js`, `Frontend/translations.js`, `backend/src/medications/routes.js`, and `backend/test/medications.test.js` — passed.
- [x] Translation coverage check — all five language dictionaries contain the same 255 keys; HTML and literal app translation references resolve.
- [x] Browser checks — live FDA-backed warfarin/ibuprofen label match and source excerpt rendered; duplicate-name validation, add/remove medication inputs, Arabic labels/RTL, lab paste preview, TXT/CSV drag/drop preview, and first-aid source links worked.
- [x] Mobile viewport check at 390 px in Arabic — document width 375 px and scroll width 375 px; no horizontal overflow.
- [ ] Firestore emulator/live-project checks for medication schedule access rules — unavailable until Firebase Console setup.

### Latest HealthTech components verification

- [x] `npm install qrcode` — added local QR-code generation; npm reported 0 vulnerabilities.
- [x] `npm run build` — passed; the generated JS bundle is above Vite's default 500 kB advisory threshold.
- [x] `npm test` — all 15 backend tests passed.
- [x] JavaScript syntax checks passed for edited frontend modules and standalone API server.
- [x] Translation parity/coverage — 368 keys in each of five dictionaries; no duplicate HTML IDs, missing app selectors, or unresolved UI keys.
- [x] Browser smoke checks — BMI, water reference, and calorie calculation produced results; selected stroke red flag displayed emergency state and `tel:123`; Arabic and 390 px mobile layout had no horizontal overflow.
- [ ] Browser check with authenticated Firebase account for passport Firestore save/load, QR generation, and deletion — Firebase authentication/project access is not configured in this environment.
- [ ] Official Egyptian pricing/generic search remains incomplete pending a verifiable public feed or authorized data provider.

## Manual setup remaining

1. In Firebase Console for the configured web app, enable Authentication → Email/Password, add the development and production hostnames to Authorized domains, create Firestore, and publish repository-root `firestore.rules`.
2. Review the Firebase password-reset email template/action URL and apply suitable API-key website restrictions for the production domains. The client config in `Frontend/firebase.js` is public web configuration; never add Firebase Admin credentials there.
3. PostgreSQL and `SESSION_SECRET` are optional and needed only for the separate legacy database-backed auth server. They are not needed for Firebase authentication, the pharmacy API, or the assistant API.
4. To enable AI, set `OPENAI_API_KEY` and `OPENAI_MODEL` only in `backend/.env`; optionally set an HTTPS `OPENAI_BASE_URL`. Without them, the assistant intentionally reports how to configure the provider.
5. Serve production over HTTPS for geolocation and deploy the built frontend and API on one origin (or configure a same-origin reverse proxy for `/api`).

Run `npm install` from the repository root to install Firebase and Vite. For development, use two terminals: `npm run dev:api` (port 3001) and `npm run dev` (Vite, port 5173). Vite proxies `/api` to port 3001. Do not use Live Server or `file://` because they do not proxy those endpoints. `npm run build` bundles npm imports into `Frontend/dist`, which `npm run dev:api` serves in production-style mode. The Firebase web config remains in `Frontend/firebase.js`; it is public client configuration, not a server credential.
