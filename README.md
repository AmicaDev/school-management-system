# School Management System (v1.0.0)

Django + DRF + PostgreSQL backend · React + Vite + pure-CSS frontend · installable PWA with an offline sync queue.
Roles: **ADMIN**, **TEACHER**, **PARENT**, **DEVELOPER** (a separate `/developer` console). No paid APIs, no payment module.

**Deploying?** → [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) (GitHub → Vercel for the frontend, Render/Docker for the API).

> **Verification status — please read.** Frontend tests (3 passed) and the production build passed in the current Windows environment. Python syntax compilation passed. Backend Django checks, migration consistency checks, and backend tests could not run because required packages (including Celery) are missing; installing `backend/requirements.txt` also failed because the configured package index did not provide the dependencies. Run the backend checks and tests in the CI workflow or an environment with the backend requirements installed before production deployment.

## Features
- **Public site & auth** — landing page, JWT login with refresh rotation/blacklist, password reset by email, role-based routing, one login for every role.
- **People** — students (archive, never delete; parents sign in with the student index number), parents (multiple children), teachers (class teacher, subject assignments + codes), staff.
- **Bulk import** — students, teachers and parents from **CSV or Excel**; validate first (valid / invalid / duplicate counts), then import; generated temporary passwords are shown once.
- **Academics** — classes, streams, subjects, academic years/terms (one active), configurable grade bands and exam types, timetable, events, notifications, enquiries.
- **Attendance** — one state per student per day/session, batch save, edit, summary, large touch targets and keyboard shortcuts (P/A/L/E).
- **Marks & results** — spreadsheet-style entry (assignment out of N, BOT, Mid-term, Final), max-mark validation, local autosave; totals/grades/remarks/positions/trends calculated on the server.
- **Report cards** — PDF per student, or a whole class as one ZIP built by a **background job** (Celery; runs inline when no Redis is configured).
- **Offline** — attendance, marks and parent enquiries queue in IndexedDB with a unique `client_txn_id`; OFFLINE → SYNCING... → SYNC COMPLETE / SYNC ERROR; duplicates are impossible server-side.
- **PWA** — manifest, icons, service worker, offline shell, update banner.
- **Developer console** — health, errors (with secret scrubbing), logs, tests, database, API timing, PWA, sync, maintenance (password re-authentication, audit-logged), updates, retry failed background jobs.
- **Security** — hashed passwords, object-level access rules (`apps/people/access.py`), throttling, upload validation, audit log, strict CSP on Vercel, HTTPS/HSTS in production.

## Layout
```
backend/    Django project (config/) + apps: users, academics, people, attendance, results, timetable, comms, audit, reports, analytics, developer
frontend/   Vite React app (vercel.json included)
docker/  docker-compose.yml  docker-compose.prod.yml  render.yaml  .github/workflows/ci.yml  docs/
```
Results maths (`apps/results/services.py`): each exam type's percentage = mean of its assessments; subject mark = weighted mean (ExamType.weight) of the types that have data;
grade/remark from the admin-configured bands; average = mean of subject marks; position ranks classmates by average.

## Requirements
Python 3.11+, PostgreSQL 14+, Node 20+. Redis is optional (background worker, shared cache); without it everything still works.

## First-run checklist (local, PowerShell)
The repository includes the database migrations; apply them with `migrate` rather than generating replacements.

```powershell
# Configure a local PostgreSQL database and user in pgAdmin or your PostgreSQL tooling first.
Set-Location backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
# Edit .env with your local DATABASE_* settings and a generated DJANGO_SECRET_KEY.
python -c "import secrets; print(secrets.token_urlsafe(50))"
python manage.py check
python manage.py migrate
python manage.py makemigrations --check --dry-run
python manage.py test tests
python manage.py create_initial_user --role ADMIN --username KIYINGI_MEMORIAL_SECONDARY_SCHOOL --email memorialkiyingi06@gmail.com
# Optional developer/testing account; enter a unique username and email.
python manage.py create_initial_user --role DEVELOPER --username AmicaDev --email ojukajames0@gmail.com
python manage.py runserver
```

In a second PowerShell terminal:

```powershell
Set-Location frontend
Copy-Item .env.example .env
npm ci
npm test
npm run dev
npm run build
npm run preview
```

The `create_initial_user` command prompts for the password. Do not put real passwords or credentials in command history, source files, or this README. The supported sign-in roles are ADMIN, TEACHER, PARENT, and DEVELOPER; students are managed as student records and linked to parent accounts.

Then sign in as admin and configure, in this order: school profile → academic year + term (tick active) → classes & streams → subjects → **grade bands** →
**examination types** (codes `ASSIGNMENT`, `BOT`, `MID`, `FINAL`; the Assignments page uses `ASSIGNMENT`) → teachers → teaching assignments (and class teacher on each stream) → students → parents.
Walk through `docs/QA_CHECKLIST.md` for every role.

## Docker
In PowerShell, copy the root example with `Copy-Item .env.example .env`, set `DATABASE_PASSWORD` and `DJANGO_SECRET_KEY` in `.env`, then `docker compose up --build` (development: API :8000, web :5173) or
`docker compose -f docker-compose.prod.yml up -d --build` (production: Gunicorn, Celery, Postgres, Redis, Nginx on :80).

## Configuration
See the root `.env.example` for Docker Compose, `backend/.env.example` for local Django, and `frontend/.env.example` (`VITE_API_BASE_URL`).
`DATABASE_URL` is supported for hosted PostgreSQL. Without `REDIS_URL`, tasks run inline and the cache is per-process.

## Known limitations
- Migrations are committed under each model-bearing app's `migrations/` directory; deployments must apply them with `migrate`.
- JWTs are stored in `localStorage` so offline sync survives reloads (XSS-exposed by design; the Vercel CSP and React escaping mitigate this).
- Uploaded media and generated ZIPs live on local disk; use a persistent volume or object storage in production.
- Frontend tests cover the API helpers only; the offline queue and pages are verified by the manual QA checklist.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `DJANGO_SECRET_KEY must be set` | Set it in `backend/.env` or use `DJANGO_DEBUG=True` locally. |
| `relation "users_user" does not exist` | `makemigrations` then `migrate`. |
| Browser CORS error | Add the frontend origin to `CORS_ALLOWED_ORIGINS` (and `CSRF_TRUSTED_ORIGINS`), no trailing slash. |
| Login works but pages show "Cannot reach the server" | `VITE_API_BASE_URL` wrong or not set at **build** time on Vercel — redeploy after changing it. |
| 503 "maintenance" | Developer console → Maintenance → disable. |
| Service worker stuck on old version | Bump `VERSION` in `frontend/public/sw.js`; hard-reload once. |
| Celery "No worker" | Expected without Redis (tasks run inline). Otherwise start Redis and `celery -A config worker`. |
