"""
Files go with their rows. However a message's attachments are deleted —
unsent, an account closed (the cascade from the user), a conversation
removed — the files in private_media go too, after the delete commits.
"""

from django.db import transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import Conversation, Message, MessageAttachment


def _drop(field):
    if not field:
        return
    name, storage = field.name, field.storage
    transaction.on_commit(lambda: storage.delete(name))


@receiver(post_delete, sender=MessageAttachment)
def attachment_gone(sender, instance, **kwargs):
    _drop(instance.file)
    _drop(instance.poster)


@receiver(post_delete, sender=Message)
def message_gone(sender, instance, **kwargs):
    _drop(instance.photo)


@receiver(post_delete, sender=Conversation)
def conversation_gone(sender, instance, **kwargs):
    _drop(instance.photo)
