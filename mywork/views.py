"""
Project-level screens: the app chooser you land on after signing in, plus the
account pages that belong to KaamKoRecord as a whole rather than to either app.

KaamKoRecord hosts two independent apps — PLU Management and TimeSheet Management.
Nothing here knows what either one does; it only points at their front doors.
"""

import logging
import re
from datetime import date
from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from apps.accounts.forms import RegistrationForm
from django.conf import settings
from django.shortcuts import redirect, render
from django.urls import reverse
from django.utils import timezone
from apps.holidays.services import card_for_user
from apps.noticeboard.views import board_context, recent_for_hub

from .daily import daily


@login_required
def home(request):
    """
    The hub. Two cards, one per app — picking one hands the whole navigation
    over to that app's own section, so the tab bar only ever shows the
    features of the app you're currently inside.

    Under them, the notice board: the one thing on KaamKoRecord that everybody
    shares, so it belongs on the page everybody lands on.

    Above both, the next public holiday — one line of the year everybody wants
    to know and nobody wants to go looking for, which is the whole argument
    for it being on the page you land on rather than a screen you navigate to.
    """
    from apps.accounts.models import Friendship
    from apps.stories.views import tray_for
    from .seasons import home_festival_banner

    notices, total = recent_for_hub(request.user)
    holiday_state, holiday = card_for_user(request.user)

    # The wide-screen hub's own extras (see home.html): today's date, a
    # thought for the day and a little laugh — the hub's, not another
    # tab's. Picked by the date, so the same for everyone until midnight.
    today = timezone.localdate()

    return render(request, "home.html", board_context(
        request,
        notices=notices,
        notice_total=total,
        next_url=request.path,
        holiday=holiday,
        holiday_state=holiday_state,
        stories=tray_for(request.user),
        today=today,
        daily=daily(today),
        festival_banner=home_festival_banner(),
        friends=Friendship.faces_for(request.user),
    ))


def register(request):
    """Public sign-up. On success the new account lands on the hub."""
    if request.user.is_authenticated:
        return redirect("home")

    if request.method == "POST":
        form = RegistrationForm(request.POST)
        if form.is_valid():
            user = form.save()
            if form.cleaned_data.get("invited_by"):
                from apps.invites.services import InviteError, record
                try:
                    record(user, form.cleaned_data["invited_by"])
                except InviteError:
                    pass  # checked by the form; a race just leaves it unlinked
            request.session.pop("invite_ref", None)
            login(request, user)
            messages.success(request, "Account created. You are now logged in.")
            return redirect("home")
        messages.error(request, "Please correct the errors below.")
    else:
        # Came from somebody's invite link (/get/?ref=…, or ?ref= here): filled in for them.
        ref = request.GET.get("ref", "")
        ref = ref if _REF.match(ref) else request.session.get("invite_ref", "")
        form = RegistrationForm(initial={"invited_by": ref})

    return render(request, "registration/register.html", {"form": form})


# The date the policy last changed. Bump it when privacy.html changes in substance.
PRIVACY_EFFECTIVE = date(2026, 10, 19)
TERMS_EFFECTIVE = date(2026, 11, 11)


def privacy(request):
    """
    What KaamKoRecord keeps about you and why — public, and linked from the way in
    and from your profile. The app stores ask for it by address, so it lives
    at one that never moves: /privacy/.
    """
    return render(request, "privacy.html", {"contact_email": settings.CONTACT_EMAIL, "effective": PRIVACY_EFFECTIVE})


def terms(request):
    """
    The rules for using KaamKoRecord — public, beside the privacy policy, at
    an address that never moves (/terms/), because Google Play and the App
    Store link to it.
    """
    return render(request, "terms.html", {"contact_email": settings.CONTACT_EMAIL, "effective": TERMS_EFFECTIVE})


APP_STORE = "https://apps.apple.com/au/app/kaamkorecord/id6813073450"
GOOGLE_PLAY = "https://play.google.com/store/apps/details?id=com.kiranlama.merokaam"
_SOURCE = re.compile(r"^[a-z0-9-]{1,30}$")
_REF = re.compile(r"^[A-Za-z0-9]{4,12}$")
_installs = logging.getLogger("mywork.get_app")


def get_app(request):
    """
    The one link to hand out — invites from the app, posters, posts:
    /get/. A phone goes straight to its own store; anything else sees both
    stores with a QR code each. `?src=poster` (a short lowercase word) says
    where the link was found: it rides along to Google Play as the install
    referrer and goes in the log, so the channels can be compared. Nothing
    about the visitor is kept.
    """
    src = request.GET.get("src", "").lower()
    src = src if _SOURCE.match(src) else ""
    # Somebody's invite code: kept for the website's sign-up, and handed to
    # Google Play, which passes it to the app on its first start (Android).
    ref = request.GET.get("ref", "")
    ref = ref.upper() if _REF.match(ref) else ""
    if ref:
        request.session["invite_ref"] = ref
    agent = request.headers.get("User-Agent", "")
    referrer = "%26".join(part for part in (
        f"utm_source%3D{src}" if src else "", "utm_medium%3Dlink" if src else "", f"utm_content%3D{ref}" if ref else "",
    ) if part)
    play = f"{GOOGLE_PLAY}&referrer={referrer}" if referrer else GOOGLE_PLAY
    if re.search(r"iPhone|iPad|iPod", agent):
        to = "ios"
    elif "Android" in agent:
        to = "android"
    else:
        to = "web"
    _installs.info("get-app src=%s to=%s ref=%s", src or "direct", to, "yes" if ref else "no")
    if to == "ios":
        return redirect(APP_STORE)
    if to == "android":
        return redirect(play)
    return render(request, "get_app.html", {"app_store": APP_STORE, "google_play": play,
                                            "here": request.build_absolute_uri(reverse("get_app"))})
