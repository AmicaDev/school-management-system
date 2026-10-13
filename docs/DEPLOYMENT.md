# Deployment guide — GitHub, Vercel (frontend) and Render (backend)

```
GitHub repo ──► Vercel   builds /frontend  → https://your-app.vercel.app      (static React PWA)
            └─► Render   builds /backend   → https://school-api.onrender.com   (Django API + PostgreSQL)
```
Vercel hosts the React app. The Django API needs a long-running Python process, PostgreSQL and (optionally) Celery/Redis, so it is deployed on a container
host. `render.yaml` is included; Railway, Fly.io, a VPS with `docker-compose.prod.yml`, or any Docker host work the same way.

## 1. Publish the repository to GitHub (PowerShell)
This project is already a Git repository. Review its current branch, history, changes, and remote before pushing; do not reinitialize it or stage ignored local data.

```powershell
git status --short --branch
git branch --show-current
git --no-pager log -5 --oneline --decorate
git remote -v
git ls-remote --heads origin
```

The configured repository is `https://github.com/AmicaDev/school-management-system.git`. If `origin` is missing, add that URL with `git remote add origin https://github.com/AmicaDev/school-management-system.git`. If the GitHub repository already has commits, inspect and integrate its history before pushing; never force-push. Push only when the remote is empty or the local `main` is a safe fast-forward:

```powershell
git push -u origin main
```

`.env` files are git-ignored. The workflow in `.github/workflows/ci.yml` runs backend tests (PostgreSQL) and the frontend build on every push.

## 2. Deploy the API on Render
1. Render → **New → Blueprint** → select the repository. It reads `render.yaml` and creates the web service and a PostgreSQL database.
2. When prompted, fill in:
   - `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `FRONTEND_URL` → your Vercel URL (you can put a placeholder first and update after step 3).
   - `BOOTSTRAP_ADMIN_USERNAME / EMAIL / PASSWORD` (and optionally `BOOTSTRAP_DEVELOPER_*`) → a **strong** password (12+ characters). These create the first accounts on first start.
3. The required database migrations are committed in the repository. Keep `AUTO_MAKEMIGRATIONS=False`; the backend entrypoint applies them with `migrate`.
4. After the first successful start, **delete the `BOOTSTRAP_*` variables**.
5. Check `https://<service>.onrender.com/api/v1/developer/status/` returns `{"maintenance": false, ...}`.

Notes for free plans: web services sleep when idle (first request is slow), the disk is ephemeral (uploaded logos/photos and generated ZIPs are lost on redeploy —
add a persistent disk or move uploads to object storage for production) and free databases expire after 30 days. For a real school use paid plans, or point
`DATABASE_URL` at Neon/Supabase (`DATABASE_SSL_REQUIRE=True`).

## 3. Deploy the frontend on Vercel
1. Vercel → **Add New Project** → import the repository → set **Root Directory** to `frontend` (recommended; `frontend/vercel.json` supplies the Vite build, API/media proxy, SPA fallback, cache and security headers). A root-level `vercel.json` is also provided for Vercel projects whose Root Directory is the repository root.
2. Do not set `VITE_API_BASE_URL` in Vercel. Production builds use same-origin `/api/v1` requests, which Vercel proxies to Render; this avoids client-device DNS and cross-origin CORS dependencies. Local development can still set `VITE_API_BASE_URL` if needed.
3. Deploy, then copy the Vercel URL into the Render variables `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS` and `FRONTEND_URL` (no trailing slash) and redeploy the API. These settings remain useful for other direct API clients and Django admin.
4. Open the site over HTTPS; the browser offers **Install app** (PWA). The service worker is only active in production builds.

The backend adds the exact hostname from `FRONTEND_URL` to Django's allowed hosts so Vercel's same-origin `/api/v1/*` proxy can reach the API. The committed Vercel rewrites proxy both `/api/v1/*` and `/media/*` to the Render service before the SPA catch-all. Set the rewrite destination to your Render service hostname if it changes.

### Developer dashboard: administrator accounts
After deploying the backend and applying migrations, sign in to the existing authenticated developer account and open **Admin accounts**. This API is enabled only on the Render production service connected to the configured `school_db` PostgreSQL database. It does not accept a database URL or operate from local development or Codespaces.

Create admins with a username, email, and password; the server validates and hashes the password. Existing admins can be deactivated and recovered only for 30 days after recorded deactivation. Deleted accounts and older deactivations are not recoverable through this feature. All management actions are audited. Django Admin remains at `https://<service>.onrender.com/django-admin/`; ordinary school admins need Django `is_staff` access to use that separate interface.

## 4. Migrations
The model-bearing apps’ migration files are included. On first deployment and each subsequent release, the backend entrypoint runs `python manage.py migrate --noinput`. Locally, validate migration state with `python manage.py makemigrations --check --dry-run`. For future model changes, generate and review migrations locally, commit them with the model change, then deploy; keep `AUTO_MAKEMIGRATIONS=False`.

## 5. Docker on your own server (PowerShell)
Run `Copy-Item .env.example .env` (set `DJANGO_SECRET_KEY`, `DATABASE_*`, `DJANGO_DEBUG=False`, `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`), then
`docker compose -f docker-compose.prod.yml up -d --build`. Nginx serves the built SPA and proxies `/api`, `/media`. Put TLS (Caddy/Traefik/certbot) in front.
Create users with the `BOOTSTRAP_*` variables or `docker compose -f docker-compose.prod.yml exec backend python manage.py create_initial_user --role ADMIN --username ... --email ...`.

## 6. Production checklist
- `DJANGO_DEBUG=False`, unique `DJANGO_SECRET_KEY`, correct `DJANGO_ALLOWED_HOSTS` / CORS origins.
- Back up PostgreSQL (`pg_dump`) and uploaded media on a schedule.
- With several web workers, set `REDIS_URL` so maintenance mode and caching are shared between processes.
- Set a real `EMAIL_BACKEND` (SMTP) for password-reset emails.
- Bump `VERSION` in `frontend/public/sw.js` when you ship a new frontend so installed apps show the "Update now" banner.
