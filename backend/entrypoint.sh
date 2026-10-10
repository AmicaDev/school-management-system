#!/bin/sh
# Runs before the web process. Safe to run on every start.
set -e
if [ "${AUTO_MAKEMIGRATIONS:-False}" = "True" ]; then
  echo "[entrypoint] AUTO_MAKEMIGRATIONS=True -> generating migrations (commit them to Git, then set this to False)"
  python manage.py makemigrations --noinput
fi
python manage.py migrate --noinput
python manage.py collectstatic --noinput
python manage.py bootstrap_users || true
exec "$@"
