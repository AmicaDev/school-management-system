"""CSV / Excel (.xlsx) bulk import for students, teachers and parents.

Every import is validated first (dry run). Nothing is written until the caller repeats the request with dry_run=false.
Temporary passwords generated for new accounts are returned once in the response and are never stored in plain text.
"""
import csv
import io
import re
import secrets
from datetime import date, datetime

from django.core.exceptions import ValidationError as DjangoValidationError
from django.contrib.auth import password_validation
from django.db import transaction
from rest_framework.response import Response

from apps.academics.models import Stream
from apps.audit.services import audit
from apps.users.models import User

from .models import Student, TeacherProfile
from .serializers import StudentSerializer

MAX_BYTES, MAX_ROWS = 2 * 1024 * 1024, 2000
COLUMNS = {
    "students": ["first_name", "last_name", "gender", "date_of_birth", "class", "stream", "index_no", "candidate_no"],
    "teachers": ["username", "first_name", "last_name", "gender", "email", "phone", "password"],
    "parents": ["username", "first_name", "last_name", "email", "phone", "password", "children"],
}


def _key(k):
    return re.sub(r"[^a-z0-9]+", "_", str(k or "").strip().lower()).strip("_")


def read_rows(upload):
    name = upload.name.lower()
    if upload.size > MAX_BYTES:
        raise ValueError("File is larger than 2 MB.")
    if name.endswith(".csv"):
        raw = list(csv.DictReader(io.StringIO(upload.read().decode("utf-8-sig"))))
    elif name.endswith(".xlsx"):
        from openpyxl import load_workbook
        ws = load_workbook(upload, read_only=True, data_only=True).active
        data = list(ws.iter_rows(values_only=True))
        if not data:
            return []
        head = [_key(h) for h in data[0]]
        raw = [dict(zip(head, row)) for row in data[1:] if any(c not in (None, "") for c in row)]
    else:
        raise ValueError("Upload a .csv or .xlsx file.")
    return [{_key(k): ("" if v is None else v) for k, v in r.items() if k} for r in raw[:MAX_ROWS]]


def _s(v):
    return str(v).strip() if v is not None else ""


def _dob(v):
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return date.fromisoformat(_s(v)) if _s(v) else None


def _gender(v):
    g = _s(v).upper()[:1]
    if g not in ("M", "F"):
        raise ValueError("gender must be M or F")
    return g


def _password(row, label="password"):
    pwd = _s(row.get("password"))
    generated = not pwd
    pwd = pwd or secrets.token_urlsafe(9)
    try:
        password_validation.validate_password(pwd)
    except DjangoValidationError as e:
        raise ValueError(f"{label}: {' '.join(e.messages)}")
    return pwd, generated


def validate(kind, rows):
    valid, invalid, dupes, seen = [], [], [], set()
    streams = {f"{s.school_class.name}|{s.name}".lower(): s for s in Stream.objects.select_related("school_class")}
    usernames = set(User.objects.values_list("username", flat=True).iterator())
    usernames = {u.lower() for u in usernames}
    existing_students = {(s.first_name.lower(), s.last_name.lower(), s.date_of_birth) for s in Student.objects.all()} if kind == "students" else set()
    student_indexes = {s.index_no.lower() for s in Student.objects.all()} if kind == "students" else set()
    candidate_numbers = {s.candidate_no.lower() for s in Student.objects.exclude(candidate_no__isnull=True)} if kind == "students" else set()
    index = {s.index_no.lower(): s for s in Student.objects.filter(is_archived=False)} if kind == "parents" else {}
    for i, r in enumerate(rows, start=2):
        try:
            first, last = _s(r.get("first_name")), _s(r.get("last_name"))
            if not first or not last:
                raise ValueError("first_name and last_name are required")
            gender = _gender(r.get("gender")) if kind != "parents" else None
            if kind == "students":
                dob = _dob(r.get("date_of_birth"))
                stream = None
                if _s(r.get("class")):
                    stream = streams.get(f"{_s(r['class'])}|{_s(r.get('stream'))}".lower())
                    if not stream:
                        raise ValueError("unknown class/stream")
                index_no = _s(r.get("index_no"))
                if not index_no:
                    raise ValueError("index_no is required; the administrator must assign it")
                candidate_no = _s(r.get("candidate_no"))
                key = (first.lower(), last.lower(), dob)
                if key in existing_students or key in seen:
                    dupes.append({"row": i, "name": f"{first} {last}"}); continue
                if index_no and index_no.lower() in student_indexes:
                    raise ValueError("index_no is already in use")
                if candidate_no and candidate_no.lower() in candidate_numbers:
                    raise ValueError("candidate_no is already in use")
                seen.add(key)
                seen.update(value.lower() for value in (index_no, candidate_no) if value)
                if index_no:
                    student_indexes.add(index_no.lower())
                if candidate_no:
                    candidate_numbers.add(candidate_no.lower())
                valid.append({"first_name": first, "last_name": last, "gender": gender, "date_of_birth": dob,
                              "stream": stream, "index_no": index_no, "candidate_no": candidate_no})
            else:
                uname = _s(r.get("username"))
                if not uname:
                    raise ValueError("username is required")
                if uname.lower() in usernames or uname.lower() in seen:
                    dupes.append({"row": i, "name": uname}); continue
                seen.add(uname.lower())
                pwd, generated = _password(r)
                rec = {"username": uname, "first_name": first, "last_name": last, "email": _s(r.get("email")), "phone": _s(r.get("phone")),
                       "password": pwd, "generated": generated}
                if kind == "teachers":
                    rec["gender"] = gender
                else:
                    kids = []
                    for idx in [x.strip() for x in _s(r.get("children")).replace(",", ";").split(";") if x.strip()]:
                        if idx.lower() not in index:
                            raise ValueError(f"unknown student index number '{idx}'")
                        kids.append(index[idx.lower()])
                    rec["children"] = kids
                valid.append(rec)
        except Exception as e:  # row-level problem: report and continue
            invalid.append({"row": i, "error": str(e)})
    return valid, invalid, dupes


@transaction.atomic
def _create(kind, valid):
    out = []
    for v in valid:
        if kind == "students":
            ser = StudentSerializer(data={**v, "stream": v["stream"].id if v["stream"] else None})
            ser.is_valid(raise_exception=True)
            ser.save()
        else:
            user = User(username=v["username"], first_name=v["first_name"], last_name=v["last_name"], email=v["email"], phone=v["phone"],
                        role="TEACHER" if kind == "teachers" else "PARENT")
            user.set_password(v["password"])
            user.save()
            if kind == "teachers":
                TeacherProfile.objects.create(user=user, gender=v["gender"])
            else:
                user.children.set(v["children"])
            if v["generated"]:
                out.append({"username": v["username"], "temporary_password": v["password"]})
    return out


def handle_import(request, kind):
    f = request.FILES.get("file")
    if not f:
        return Response({"detail": "Choose a file to upload."}, status=400)
    try:
        rows = read_rows(f)
    except Exception as e:
        return Response({"detail": f"Could not read the file: {e}"}, status=400)
    missing = [c for c in COLUMNS[kind][:2] if rows and c not in rows[0]]
    if missing:
        return Response({"detail": f"Missing required column(s): {', '.join(missing)}. Expected: {', '.join(COLUMNS[kind])}."}, status=400)
    dry = str(request.data.get("dry_run", "true")).lower() != "false"
    valid, invalid, dupes = validate(kind, rows)
    created, credentials = 0, []
    if not dry and valid:
        credentials = _create(kind, valid)
        created = len(valid)
        audit(request, "BULK_IMPORT", kind, f"{created} {kind}")
    return Response({"dry_run": dry, "valid": len(valid), "invalid": invalid, "duplicates": dupes, "created": created,
                     "credentials": credentials, "columns": COLUMNS[kind]})
