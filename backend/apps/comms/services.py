from .models import Notification


def notify(user, kind, title, body="", priority="NORMAL"):
    return Notification.objects.create(recipient=user, kind=kind, title=title[:200], body=body, priority=priority)


def notify_many(users, kind, title, body="", priority="NORMAL"):
    Notification.objects.bulk_create([Notification(recipient=u, kind=kind, title=title[:200], body=body, priority=priority)
                                      for u in users])
