# Manual QA checklist
Tick each item after testing on desktop and a phone-width window (320–430px) in light and dark mode.

**Admin** login · dashboard (year/term Apply/Reset) · students (create, edit, search, filter, archive, profile tabs, CSV import validate/import) · parents (assign children, reset credentials) · teachers · staff · classes & streams · subjects & assignments · years & terms · attendance records · results · report card PDF · events (creates notifications) · notifications · enquiries (reply) · school profile + logo · users · audit log.

**Teacher** login · dashboard · my classes (only assigned) · attendance (keyboard P/A/L/E, mark all, save, edit same day, offline save) · marks (validation, max, draft restore, save, offline) · assignments out of N · timetable · notifications · confirm another teacher's class is rejected (403).

**Parent** login with username and with a student index number · children · attendance · results · report card download · performance · timetable · events · notifications · enquiries (offline compose) · confirm another child's id returns 404.

**Developer** login · dashboard · errors (filter, open, resolve) · logs · tests (server + browser) · database · API · PWA · sync · maintenance (password + confirmation) · updates · audit · confirm Admin gets 403 on /api/v1/developer/health/.

**Error testing** stop the backend → UI shows friendly message and OFFLINE banner; throw an error in a component → boundary page + entry in /developer/errors; confirm no passwords/tokens appear in any stored error.
