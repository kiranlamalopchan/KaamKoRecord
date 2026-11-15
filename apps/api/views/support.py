from django import forms
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView
from rest_framework.response import Response
from ..models import SupportReport
from ..errors import form_errors


class ReportForm(forms.ModelForm):
    class Meta:
        model = SupportReport
        fields = ('description', 'screenshot', 'app_version', 'build', 'platform')

    def clean_screenshot(self):
        photo = self.cleaned_data.get('screenshot')
        if photo and photo.size > 8 * 1024 * 1024:
            raise forms.ValidationError('Choose a screenshot smaller than 8 MB.')
        return photo


class Report(APIView):
    def post(self, request):
        form = ReportForm(request.data, request.FILES)
        if not form.is_valid():
            return Response(form_errors(form), status=400)
        report = form.save(commit=False)
        report.user = request.user
        report.save()
        return Response({'id': report.pk, 'message': 'Your report has been saved for the administrator.'}, status=201)


def version_key(version):
    """'1.10.2' -> (1, 10, 2), so versions sort as numbers, not as text."""
    parts = []
    for piece in str(version).strip().split('.'):
        digits = ''.join(ch for ch in piece if ch.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts)


class Release(APIView):
    """The newest release and the oldest version still allowed to run.

    Asked before sign-in as well as after (a phone that must update should
    not be shown the sign-in form first), so it needs no token — and ignores
    a stale one rather than answering 401.
    """
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        from ..models import MobileRelease
        release = MobileRelease.objects.order_by('-created_at').first()
        required = [r.version for r in MobileRelease.objects.filter(required=True)]
        return Response({
            'version': release.version if release else '',
            'minimum_version': max(required, key=version_key) if required else '',
            'android_url': release.android_url if release else 'https://play.google.com/store/apps/details?id=com.kiranlama.merokaam',
            'ios_url': release.ios_url if release else 'https://apps.apple.com/app/id6813073450',
        })
