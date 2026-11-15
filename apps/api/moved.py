"""
The old server, once the site has moved.

With `SITE_MOVED_TO` set (only ever on the server being retired), nothing is
read or saved here any more:

- the app's requests are refused with a sentence telling people to update.
  It is a 400 with a `detail`, because that is the one answer every app
  already in the stores prints as written — on the sign-in screen and on
  every other screen alike. A 401 would sign them out; a 5xx or a 410 would
  be worded over as "something went wrong".
- pages, and anything else a browser asks for, go to the same path on the
  new address.

Unset, it does nothing at all.
"""

from django.conf import settings
from django.http import HttpResponsePermanentRedirect, JsonResponse

MOVED = (
    "KaamKoRecord has moved. Please update the app from the App Store or "
    "Google Play to keep recording your shifts."
)


class SiteMovedMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        target = getattr(settings, "SITE_MOVED_TO", "")
        if not target:
            return self.get_response(request)
        if request.path.startswith("/api/"):
            return JsonResponse({"detail": MOVED}, status=400)
        return HttpResponsePermanentRedirect(target + request.get_full_path())
