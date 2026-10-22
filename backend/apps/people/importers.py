"""CSV / Excel (.xlsx) bulk import for students, teachers and parents.

Every import is validated first (dry run). Nothing is written until the caller repeats the request with dry_run=false.
Temporary passwords and teacher sign-in codes generated for new accounts are returned once in the response.
"""
import csv
import io
import re
import secrets
from datetime import date, datetime

from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework.response import Response

from apps.academics.models import SchoolClass, Stream, Subject
from apps.audit.services import audit
from apps.users.models import User

from .models import Student, TeacherProfile
from .serializers import StudentSerializer, generate_unique_index_no, generate_unique_teacher_code

MAX_BYTES, MAX_ROWS = 2 * 1024 * 1024, 2000
COLUMNS = {
    "students": ["name", "gender", "class", "stream", "date_of_birth", "index_no", "candidate_no"],
    "teachers": ["name", "gender", "subject", "username", "email", "phone", "password", "signin_code"],
    "parents": ["name", "username", "email", "phone", "password", "children"],
}

ALIASES = {
    "student_name": "name",
    "teacher_name": "name",
    "full_name": "name",
    "school_class": "class",
    "index_number": "index_no",
    "candidate_number": "candidate_no",
    "dob": "date_of_birth",
    "subjects": "subject",
    "code": "signin_code",
    "sign_in_code": "signin_code",
    "teacher_code": "signin_code",
    "telephone": "phone",
}


def _key(k):
    norm = re.sub(r"[^a-z0-9]+", "_", str(k or "").strip().lower()).strip("_")
    return ALIASES.get(norm, norm)


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


def _names(row):
    first = _s(row.get("first_name"))
    last = _s(row.get("last_name"))
    if first and last:
        return first, last
    full = _s(row.get("name")) or _s(row.get("full_name")) or _s(row.get("student_name")) or _s(row.get("teacher_name"))
    if not full:
        if first:
            return first, "-"
        if last:
            return "-", last
        return "", ""
    parts = full.split()
    if len(parts) == 1:
        return parts[0], parts[0]
    return parts[0], " ".join(parts[1:])


def _dob(v):
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return date.fromisoformat(_s(v)) if _s(v) else None


def _gender(v):
    val = _s(v).upper()
    if val in ("M", "MALE", "BOY"):
        return "M"
    if val in ("F", "FEMALE", "GIRL"):
        return "F"
    g = val[:1]
    if g in ("M", "F"):
        return g
    raise ValueError("gender must be M or F")


def _password(row, label="password"):
    pwd = _s(row.get("password"))
    generated = not pwd
    pwd = pwd or secrets.token_urlsafe(9)
    try:
        password_validation.validate_password(pwd)
    except DjangoValidationError as e:
        raise ValueError(f"{label}: {' '.join(e.messages)}")
    return pwd, generated


def _unique_teacher_username(first, last, seen_set):
    f_clean = re.sub(r"[^a-z0-9]", "", first.lower())
    l_clean = re.sub(r"[^a-z0-9]", "", last.lower())
    base = f"{f_clean}.{l_clean}".strip(".") or "teacher"
    cand = base
    counter = 1
    while cand in seen_set or User.objects.filter(username__iexact=cand).exists():
        counter += 1
        cand = f"{base}{counter}"
    return cand


def validate(kind, rows):
    valid, invalid, dupes, seen = [], [], [], set()
    streams = {f"{s.school_class.name}|{s.name}".lower(): s for s in Stream.objects.select_related("school_class")}
    classes = {c.name.lower(): c for c in SchoolClass.objects.all()}
    subjects = {s.name.lower(): s for s in Subject.objects.all()}
    for s in Subject.objects.all():
        subjects[s.code.lower()] = s

    usernames = set(User.objects.values_list("username", flat=True).iterator())
    usernames = {u.lower() for u in usernames}
    existing_students = {(s.first_name.lower(), s.last_name.lower(), s.date_of_birth) for s in Student.objects.all()} if kind == "students" else set()
    student_indexes = {s.index_no.lower() for s in Student.objects.all()} if kind == "students" else set()
    candidate_numbers = {s.candidate_no.lower() for s in Student.objects.exclude(candidate_no__isnull=True)} if kind == "students" else set()
    index = {s.index_no.lower(): s for s in Student.objects.filter(is_archived=False)} if kind == "parents" else {}

    for i, r in enumerate(rows, start=2):
        try:
            first, last = _names(r)
            if not first or not last:
                raise ValueError("first_name and last_name (or name) are required")
            gender = _gender(r.get("gender")) if kind != "parents" else None

            if kind == "students":
                class_str = _s(r.get("class"))
                stream = None
                if class_str:
                    school_class = classes.get(class_str.lower())
                    if not school_class:
                        school_class = SchoolClass.objects.create(name=class_str)
                        classes[class_str.lower()] = school_class

                    stream_str = _s(r.get("stream"))
                    if stream_str:
                        key_stream = f"{school_class.name}|{stream_str}".lower()
                        stream = streams.get(key_stream)
                        if not stream:
                            stream = Stream.objects.create(school_class=school_class, name=stream_str)
                            streams[key_stream] = stream
                    else:
                        stream = school_class.streams.first()
                        if not stream:
                            stream = Stream.objects.create(school_class=school_class, name="A")
                            streams[f"{school_class.name}|{stream.name}".lower()] = stream
                else:
                    stream_str = _s(r.get("stream"))
                    if stream_str:
                        stream = Stream.objects.filter(name__iexact=stream_str).first()

                dob = _dob(r.get("date_of_birth"))
                index_no = _s(r.get("index_no"))
                candidate_no = _s(r.get("candidate_no")) or None

                key = (first.lower(), last.lower(), dob)
                if key in existing_students or key in seen:
                    dupes.append({"row": i, "name": f"{first} {last}"})
                    continue

                if not index_no:
                    index_no = generate_unique_index_no()
                elif index_no.lower() in student_indexes or index_no.lower() in seen:
                    raise ValueError("index_no is already in use")

                if candidate_no:
                    if candidate_no.lower() in candidate_numbers or candidate_no.lower() in seen:
                        raise ValueError("candidate_no is already in use")
                    seen.add(candidate_no.lower())
                    candidate_numbers.add(candidate_no.lower())

                seen.add(key)
                seen.add(index_no.lower())
                student_indexes.add(index_no.lower())

                valid.append({
                    "first_name": first, "last_name": last, "gender": gender, "date_of_birth": dob,
                    "stream": stream, "index_no": index_no, "candidate_no": candidate_no
                })

            elif kind == "teachers":
                subject_str = _s(r.get("subject"))
                subject_obj = None
                if subject_str:
                    subject_obj = subjects.get(subject_str.lower())
                    if not subject_obj:
                        code = re.sub(r"[^A-Za-z0-9]", "", subject_str)[:10].upper() or "SUBJ"
                        subject_obj, _ = Subject.objects.get_or_create(code=code, defaults={"name": subject_str.title()})
                        subjects[subject_str.lower()] = subject_obj
                        subjects[code.lower()] = subject_obj

                uname = _s(r.get("username"))
                if not uname:
                    uname = _unique_teacher_username(first, last, usernames | seen)
                elif uname.lower() in usernames or uname.lower() in seen:
                    dupes.append({"row": i, "name": uname})
                    continue

                seen.add(uname.lower())
                usernames.add(uname.lower())
                pwd, generated = _password(r)
                raw_code = _s(r.get("signin_code"))
                if not raw_code:
                    raw_code = generate_unique_teacher_code()

                class_str = _s(r.get("class"))
                stream_str = _s(r.get("stream"))
                stream_obj = None
                if class_str and stream_str:
                    stream_obj = streams.get(f"{class_str}|{stream_str}".lower())
                elif stream_str:
                    stream_obj = Stream.objects.filter(name__iexact=stream_str).first()
                if not stream_obj and subject_obj:
                    stream_obj = Stream.objects.first()

                valid.append({
                    "username": uname, "first_name": first, "last_name": last, "gender": gender,
                    "email": _s(r.get("email")), "phone": _s(r.get("phone")),
                    "password": pwd, "generated": generated, "signin_code": raw_code,
                    "subject": subject_obj, "stream": stream_obj
                })

            else:  # parents
                uname = _s(r.get("username"))
                if not uname:
                    uname = _unique_teacher_username(first, last, usernames | seen)
                if uname.lower() in usernames or uname.lower() in seen:
                    dupes.append({"row": i, "name": uname})
                    continue
                seen.add(uname.lower())
                usernames.add(uname.lower())
                pwd, generated = _password(r)
                kids = []
                for idx in [x.strip() for x in _s(r.get("children")).replace(",", ";").split(";") if x.strip()]:
                    if idx.lower() not in index:
                        raise ValueError(f"unknown student index number '{idx}'")
                    kids.append(index[idx.lower()])
                valid.append({
                    "username": uname, "first_name": first, "last_name": last, "email": _s(r.get("email")),
                    "phone": _s(r.get("phone")), "password": pwd, "generated": generated, "children": kids
                })

        except Exception as e:
            invalid.append({"row": i, "error": str(e)})

    return valid, invalid, dupes


@transaction.atomic
def _create(kind, valid):
    out = []
    for v in valid:
        if kind == "students":
            ser = StudentSerializer(data={
                "first_name": v["first_name"],
                "last_name": v["last_name"],
                "gender": v["gender"],
                "date_of_birth": v["date_of_birth"],
                "stream": v["stream"].id if v["stream"] else None,
                "index_no": v["index_no"],
                "candidate_no": v["candidate_no"],
            })
            ser.is_valid(raise_exception=True)
            ser.save()
        elif kind == "teachers":
            user = User(
                username=v["username"],
                first_name=v["first_name"],
                last_name=v["last_name"],
                email=v["email"],
                phone=v["phone"],
                role="TEACHER"
            )
            user.set_password(v["password"])
            user.save()
            profile = TeacherProfile.objects.create(user=user, gender=v["gender"])
            profile.set_signin_code(v["signin_code"])
            profile.save(update_fields=["signin_code", "signin_code_hash", "signin_code_issued_at"])

            if v.get("subject") and v.get("stream"):
                from apps.academics.models import TeachingAssignment
                TeachingAssignment.objects.get_or_create(
                    stream=v["stream"],
                    subject=v["subject"],
                    paper_number=1,
                    defaults={"teacher": user}
                )

            out.append({
                "username": v["username"],
                "temporary_password": v["password"],
                "signin_code": v["signin_code"],
                "full_name": f"{v['first_name']} {v['last_name']}",
                "subject": v["subject"].name if v.get("subject") else "",
            })
        else:  # parents
            user = User(
                username=v["username"],
                first_name=v["first_name"],
                last_name=v["last_name"],
                email=v["email"],
                phone=v["phone"],
                role="PARENT"
            )
            user.set_password(v["password"])
            user.save()
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

    if rows:
        row_keys = set(rows[0].keys())
        has_name = "name" in row_keys or ("first_name" in row_keys and "last_name" in row_keys)
        if kind == "students":
            missing = []
            if not has_name:
                missing.append("name (or first_name and last_name)")
            if "gender" not in row_keys:
                missing.append("gender")
            if missing:
                return Response({
                    "detail": f"Missing required column(s): {', '.join(missing)}. Students require name, gender, and class (other fields are optional)."
                }, status=400)
        elif kind == "teachers":
            missing = []
            if not has_name and "username" not in row_keys:
                missing.append("name (or first_name and last_name, or username)")
            if "gender" not in row_keys:
                missing.append("gender")
            if missing:
                return Response({
                    "detail": f"Missing required column(s): {', '.join(missing)}. Teachers require name, gender, and subject (other fields are optional)."
                }, status=400)
        elif kind == "parents":
            if not has_name and "username" not in row_keys:
                return Response({
                    "detail": "Missing required column(s): username or name."
                }, status=400)

    dry = str(request.data.get("dry_run", "true")).lower() != "false"
    valid, invalid, dupes = validate(kind, rows)
    created, credentials = 0, []
    if not dry and valid:
        credentials = _create(kind, valid)
        created = len(valid)
        audit(request, "BULK_IMPORT", kind, f"{created} {kind}")
    return Response({
        "dry_run": dry,
        "valid": len(valid),
        "invalid": invalid,
        "duplicates": dupes,
        "created": created,
        "credentials": credentials,
        "columns": COLUMNS[kind]
    })
