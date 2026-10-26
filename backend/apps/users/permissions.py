from rest_framework.permissions import BasePermission

from .models import User

R = User.Role


def roles_required(*roles):
    class _RolePermission(BasePermission):
        message = "You do not have permission to perform this action."

        def has_permission(self, request, view):
            u = request.user
            return bool(u and u.is_authenticated and u.is_active and u.role in roles)

    _RolePermission.__name__ = "Is" + "Or".join(r.title() for r in roles)
    return _RolePermission


IsAdmin = roles_required(R.ADMIN)
IsTeacher = roles_required(R.TEACHER)
IsParent = roles_required(R.PARENT)
IsBursar = roles_required(R.BURSAR)
IsDeveloper = roles_required(R.DEVELOPER)
IsAdminOrTeacher = roles_required(R.ADMIN, R.TEACHER)
IsFinanceUser = roles_required(R.ADMIN, R.BURSAR)
IsSchoolUser = roles_required(R.ADMIN, R.TEACHER, R.PARENT, R.BURSAR)


class AdminWriteAuthenticatedRead(BasePermission):
    """Any school user may read; only ADMIN may write. Developers are excluded from school data."""

    def has_permission(self, request, view):
        u = request.user
        if not (u and u.is_authenticated and u.is_active):
            return False
        if u.role == R.DEVELOPER:
            return False
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return True
        return u.role == R.ADMIN
