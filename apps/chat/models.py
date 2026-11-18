"""Private conversations between friends."""

import uuid
from io import BytesIO
from os.path import basename
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage
from django.db import IntegrityError, models, transaction
from django.utils.deconstruct import deconstructible
from django.db.models import Case, Count, F, IntegerField, Max, Q, When
from django.utils import timezone

from apps.accounts.models import Friendship
from apps.moderation.filter import REFUSED, objectionable
from apps.moderation.models import Block

MAX_LENGTH = 2000
PHOTO_MAX_SIDE = 2048
PHOTO_QUALITY = 82


@deconstructible
class PrivateMessageStorage(FileSystemStorage):
    """Message media lives outside the web server's public media root."""

    def __init__(self):
        super().__init__(location=settings.BASE_DIR / "private_media", base_url=None)


message_photo_storage = PrivateMessageStorage()


def message_photo_path(instance, filename):
    suffix = Path(filename).suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}:
        suffix = ".jpg"
    return f"messages/{instance.sender_id}/{uuid.uuid4().hex}{suffix}"


def attachment_path(instance, filename):
    suffix = Path(filename).suffix.lower()[:12]
    if not suffix or any(character not in ".abcdefghijklmnopqrstuvwxyz0123456789" for character in suffix):
        suffix = ".bin"
    return f"chat_attachments/{instance.message.conversation_id}/{uuid.uuid4().hex}{suffix}"


def normalise_message_photo(upload):
    """Straighten and bound private chat photos before permanent storage."""
    from PIL import Image, ImageOps

    try:
        upload.seek(0)
        image = Image.open(upload)
        if image.width * image.height > 40_000_000:
            raise ValueError("image dimensions are too large")
        image = ImageOps.exif_transpose(image)
        if image.mode not in ("RGB", "L"):
            backdrop = Image.new("RGB", image.size, (255, 255, 255))
            backdrop.paste(image, mask=image.convert("RGBA").split()[-1])
            image = backdrop
        image = image.convert("RGB")
        image.thumbnail((PHOTO_MAX_SIDE, PHOTO_MAX_SIDE), Image.Resampling.LANCZOS)
        output = BytesIO()
        image.save(output, format="JPEG", quality=PHOTO_QUALITY, optimize=True)
        return ContentFile(output.getvalue(), name="message.jpg")
    except Exception as exc:
        raise ValidationError("Choose a valid photo and try again.") from exc


class Conversation(models.Model):
    """A stable thread identity. Direct threads have exactly two members."""

    class Kind(models.TextChoices):
        DIRECT = "direct", "Direct"
        GROUP = "group", "Group"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=8, choices=Kind.choices, default=Kind.DIRECT)
    # min(user id):max(user id), making direct-thread creation race safe.
    direct_key = models.CharField(max_length=48, unique=True, null=True, blank=True)
    title = models.CharField(max_length=100, blank=True)
    photo = models.ImageField(upload_to="group_photos/", storage=message_photo_storage, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="conversations_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        ordering = ["-updated_at"]

    @staticmethod
    def pair_key(a, b):
        low, high = sorted((a.pk, b.pk))
        return f"{low}:{high}"

    @classmethod
    def for_pair(cls, a, b):
        """Return the one direct conversation for a pair, creating members once."""
        key = cls.pair_key(a, b)
        try:
            conversation, _ = cls.objects.get_or_create(
                direct_key=key,
                defaults={"kind": cls.Kind.DIRECT, "created_by": a},
            )
        except IntegrityError:
            # Another request created the pair between our SELECT and INSERT.
            conversation = cls.objects.get(direct_key=key)
        ConversationMember.objects.bulk_create(
            [ConversationMember(conversation=conversation, user=a), ConversationMember(conversation=conversation, user=b)],
            ignore_conflicts=True,
        )
        return conversation

    @classmethod
    def create_group(cls, creator, title, users):
        title = (title or "").strip()
        if not title:
            raise ValidationError("Give the group a name.")
        if len(title) > 100:
            raise ValidationError("Keep the group name under 100 characters.")
        members = {user.pk: user for user in users if user.pk != creator.pk}
        if len(members) < 2:
            raise ValidationError("Choose at least two friends for a group.")
        if len(members) > 49:
            raise ValidationError("A group can have up to 50 people.")
        for user in members.values():
            if not Message.can_talk(creator, user):
                raise ValidationError("Groups can only include your friends.")
        with transaction.atomic():
            conversation = cls.objects.create(kind=cls.Kind.GROUP, title=title, created_by=creator)
            ConversationMember.objects.bulk_create([
                ConversationMember(conversation=conversation, user=creator, role=ConversationMember.Role.ADMIN),
                *[ConversationMember(conversation=conversation, user=user) for user in members.values()],
            ])
        return conversation


class ConversationMember(models.Model):
    """Per-person inbox state without changing or deleting shared history."""

    class Role(models.TextChoices):
        MEMBER = "member", "Member"
        ADMIN = "admin", "Admin"

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="conversation_memberships")
    role = models.CharField(max_length=8, choices=Role.choices, default=Role.MEMBER)
    joined_at = models.DateTimeField(auto_now_add=True)
    pinned_at = models.DateTimeField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    muted_until = models.DateTimeField(null=True, blank=True)
    marked_unread = models.BooleanField(default=False)
    last_read_message = models.ForeignKey(
        "Message", on_delete=models.SET_NULL, null=True, blank=True, related_name="last_read_by",
    )
    last_delivered_message = models.ForeignKey(
        "Message", on_delete=models.SET_NULL, null=True, blank=True, related_name="last_delivered_to",
    )
    # Group history policy: somebody added to an existing group sees what is
    # said from the moment they joined, never the conversation before them.
    # Null means the whole history (direct threads, a group's first members).
    history_from = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["conversation", "user"], name="one_membership_per_conversation_user"),
        ]
        indexes = [models.Index(fields=["user", "archived_at", "pinned_at"])]


class Message(models.Model):
    conversation = models.ForeignKey(
        Conversation, on_delete=models.CASCADE, related_name="messages", null=True, blank=True,
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="messages_sent"
    )
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="messages_received",
        null=True, blank=True,
    )
    body = models.TextField(max_length=MAX_LENGTH)
    photo = models.ImageField(upload_to=message_photo_path, storage=message_photo_storage, blank=True)
    client_id = models.UUIDField(null=True, blank=True)
    reply_to = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="replies")
    created_at = models.DateTimeField(auto_now_add=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    unsent_at = models.DateTimeField(null=True, blank=True)
    forwarded = models.BooleanField(default=False)
    # A line the conversation says about itself ("Asha added Ram"), not a
    # person's words. Empty for every ordinary message.
    event = models.CharField(max_length=16, blank=True)

    class Meta:
        ordering = ["-created_at", "-pk"]
        indexes = [
            models.Index(fields=["recipient", "read_at"]),
            models.Index(fields=["sender", "recipient", "-created_at"]),
            models.Index(fields=["recipient", "sender", "-created_at"]),
            models.Index(fields=["conversation", "-created_at"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["sender", "client_id"], condition=Q(client_id__isnull=False),
                name="one_message_per_sender_client_id",
            ),
        ]

    def __str__(self):
        destination = self.recipient or self.conversation
        return f"{self.sender} → {destination}: {self.body[:40]}"

    # ---- who may write to whom ------------------------------------------

    @staticmethod
    def can_talk(a, b):
        return Friendship.are_friends(a, b) and not Block.between(a, b)

    @classmethod
    def send(cls, sender, recipient, body, photo=None, client_id=None, reply_to=None):
        if not isinstance(body, str):
            raise ValidationError("Write a message using text.")
        body = (body or "").strip()
        if not body and not photo:
            raise ValidationError("Write something or choose a photo first.")
        if len(body) > MAX_LENGTH:
            raise ValidationError(f"That is too long — keep it under {MAX_LENGTH} characters.")
        if not cls.can_talk(sender, recipient):
            raise ValidationError("You can only message your friends.")
        if objectionable(body):
            raise ValidationError(REFUSED)
        if client_id:
            existing = cls.objects.filter(sender=sender, client_id=client_id).first()
            if existing:
                if existing.recipient_id != recipient.pk:
                    raise ValidationError("That message could not be retried safely.")
                existing._was_created = False
                return existing
        if photo:
            photo = normalise_message_photo(photo)
        conversation = Conversation.for_pair(sender, recipient)
        if reply_to and (
            reply_to.conversation_id != conversation.pk
            and set((reply_to.sender_id, reply_to.recipient_id)) != set((sender.pk, recipient.pk))
        ):
            raise ValidationError("That replied-to message is not in this conversation.")
        candidate = cls(
            conversation=conversation, sender=sender, recipient=recipient, body=body,
            photo=photo, client_id=client_id, reply_to=reply_to,
        )
        try:
            with transaction.atomic():
                candidate.save(force_insert=True)
                message = candidate
        except IntegrityError:
            if candidate.photo and candidate.photo.name:
                candidate.photo.delete(save=False)
            if not client_id:
                raise
            message = cls.objects.get(sender=sender, client_id=client_id)
            if message.recipient_id != recipient.pk:
                raise ValidationError("That message could not be retried safely.")
            message._was_created = False
            return message
        message._was_created = True
        Conversation.objects.filter(pk=conversation.pk).update(updated_at=timezone.now())
        ConversationMember.objects.filter(conversation=conversation, user=sender).update(archived_at=None)
        ConversationMember.objects.filter(conversation=conversation, user=recipient).update(archived_at=None)
        return message

    @classmethod
    def send_to_conversation(cls, sender, conversation, body, *, client_id=None, reply_to=None):
        """Send inside an authorised direct or group conversation."""
        membership = ConversationMember.objects.filter(
            conversation=conversation, user=sender,
        ).first()
        if membership is None:
            raise ValidationError("You are not part of that conversation.")
        if conversation.kind == Conversation.Kind.DIRECT:
            other = conversation.memberships.exclude(user=sender).select_related("user").first()
            if other is None:
                raise ValidationError("That conversation is no longer available.")
            return cls.send(sender, other.user, body, client_id=client_id, reply_to=reply_to)
        blocked = Block.ids_for(sender)
        if conversation.memberships.exclude(user=sender).filter(user_id__in=blocked).exists():
            raise ValidationError("You cannot send in this group while a member is blocked.")
        if not isinstance(body, str):
            raise ValidationError("Write a message using text.")
        body = (body or "").strip()
        if len(body) > MAX_LENGTH:
            raise ValidationError(f"That is too long — keep it under {MAX_LENGTH} characters.")
        if objectionable(body):
            raise ValidationError(REFUSED)
        if client_id:
            existing = cls.objects.filter(sender=sender, client_id=client_id).first()
            if existing:
                if existing.conversation_id != conversation.pk:
                    raise ValidationError("That message could not be retried safely.")
                existing._was_created = False
                return existing
        if reply_to and reply_to.conversation_id != conversation.pk:
            raise ValidationError("That replied-to message is not in this conversation.")
        if not body:
            # Attachments are added immediately after this row by the API.
            body = ""
        candidate = cls(
            conversation=conversation, sender=sender, recipient=None, body=body,
            client_id=client_id, reply_to=reply_to,
        )
        try:
            with transaction.atomic():
                candidate.save(force_insert=True)
                message = candidate
        except IntegrityError:
            if not client_id:
                raise
            message = cls.objects.get(sender=sender, client_id=client_id)
            if message.conversation_id != conversation.pk:
                raise ValidationError("That message could not be retried safely.")
            message._was_created = False
            return message
        message._was_created = True
        Conversation.objects.filter(pk=conversation.pk).update(updated_at=timezone.now())
        ConversationMember.objects.filter(conversation=conversation).update(archived_at=None)
        return message

    # ---- reading ----------------------------------------------------------

    @classmethod
    def between(cls, a, b):
        return cls.objects.filter(Q(sender=a, recipient=b) | Q(sender=b, recipient=a))

    @classmethod
    def mark_read(cls, reader, other):
        return cls.objects.filter(recipient=reader, sender=other, read_at__isnull=True).update(read_at=timezone.now())

    @classmethod
    def unread_count(cls, user):
        return cls.objects.filter(recipient=user, sender__is_active=True, read_at__isnull=True).exclude(sender_id__in=Block.ids_for(user)).count()

    @classmethod
    def threads_for(cls, user):
        """
        One row per person you have exchanged messages with, newest first:
        [(other_user, newest_message, unread_from_them)].
        """
        hidden = Block.ids_for(user)
        visible = (
            cls.objects.filter(Q(sender=user) | Q(recipient=user))
            .exclude(sender_id__in=hidden).exclude(recipient_id__in=hidden)
            .filter(sender__is_active=True, recipient__is_active=True)
        )
        summary = list(visible.annotate(other_id=Case(
            When(sender=user, then=F("recipient_id")), default=F("sender_id"), output_field=IntegerField(),
        )).values("other_id").annotate(
            newest=Max("pk"), unread=Count("pk", filter=Q(recipient=user, read_at__isnull=True)),
        ).order_by("-newest"))
        unread = {item["newest"]: item["unread"] for item in summary}
        rows = visible.filter(pk__in=unread).select_related("sender", "sender__profile", "recipient", "recipient__profile").order_by("-pk")
        threads = []
        for message in rows:
            other = message.recipient if message.sender_id == user.pk else message.sender
            if other.pk in hidden or not other.is_active:
                continue
            threads.append((other, message, unread[message.pk]))
        return threads


class MessageReaction(models.Model):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    emoji = models.CharField(max_length=8)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["message", "user"], name="one_reaction_per_message_user")]


class MessageAttachment(models.Model):
    class Kind(models.TextChoices):
        PHOTO = "photo", "Photo"
        VIDEO = "video", "Video"
        AUDIO = "audio", "Voice message"
        FILE = "file", "File"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="attachments")
    kind = models.CharField(max_length=8, choices=Kind.choices)
    file = models.FileField(upload_to=attachment_path, storage=message_photo_storage)
    poster = models.ImageField(upload_to=attachment_path, storage=message_photo_storage, blank=True)
    display_name = models.CharField(max_length=180, blank=True)
    content_type = models.CharField(max_length=100)
    size = models.PositiveBigIntegerField(default=0)
    duration = models.FloatField(null=True, blank=True)
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    quality = models.CharField(max_length=8, blank=True)
    # Voice messages: up to 64 loudness levels, 0-100, drawn as the waveform.
    waveform = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "pk"]

    def safe_name(self):
        return basename(self.display_name or self.file.name)[:180]

    def drop_files(self):
        for field in (self.file, self.poster):
            if field:
                try:
                    field.storage.delete(field.name)
                except Exception:
                    pass


class MessageHidden(models.Model):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="hidden_for")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="hidden_messages")
    hidden_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["message", "user"], name="one_hidden_message_per_user")]


class MessagePin(models.Model):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="pins")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="pinned_messages")
    pinned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["message", "user"], name="one_message_pin_per_user")]
        ordering = ["-pinned_at"]
