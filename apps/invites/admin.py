from django.contrib import admin

from .models import InviteCode, Invitation


@admin.register(InviteCode)
class InviteCodeAdmin(admin.ModelAdmin):
    list_display = ("code", "user", "created_at")
    search_fields = ("code", "user__username")
    raw_id_fields = ("user",)


@admin.register(Invitation)
class InvitationAdmin(admin.ModelAdmin):
    list_display = ("inviter", "invited", "created_at", "active_at")
    list_filter = ("active_at",)
    search_fields = ("inviter__username", "invited__username")
    raw_id_fields = ("inviter", "invited")
