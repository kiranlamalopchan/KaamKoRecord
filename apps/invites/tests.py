from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from apps.notifications.models import Notification
from apps.timeclock.models import Workplace

from .models import ALPHABET, InviteCode, Invitation
from .services import InviteError, activate, champion, record, summary

User = get_user_model()


def make_user(name, days_ago=0):
    user = User.objects.create_user(name, password="pw-123456-x")
    if days_ago:
        User.objects.filter(pk=user.pk).update(date_joined=timezone.now() - timedelta(days=days_ago))
        user.refresh_from_db()
    return user


class InviteRulesTests(TestCase):
    def setUp(self):
        cache.clear()
        self.kiran = make_user("kiran", days_ago=100)

    def test_everybody_gets_one_readable_code_in_capitals(self):
        code = InviteCode.for_user(self.kiran).code
        self.assertEqual(len(code), 6)
        self.assertEqual(code, code.upper())
        for i in range(30):
            made = InviteCode.for_user(make_user(f"someone{i}")).code
            self.assertRegex(made, r"^[A-Z2-9]{6}$")
        self.assertTrue(set(code) <= set(ALPHABET))
        self.assertNotRegex(code, "[01OIL]")
        self.assertEqual(InviteCode.for_user(self.kiran).code, code)

    def test_linked_by_the_code_once_however_it_is_typed(self):
        code = InviteCode.for_user(self.kiran).code
        priya = make_user("priya")
        record(priya, code.lower())
        self.assertEqual(priya.invited_by.inviter, self.kiran)
        with self.assertRaisesMessage(InviteError, "already said"):
            record(priya, code)
        sita = make_user("sita")
        record(sita, f" {code[:3]}-{code[3:]} ")
        self.assertEqual(sita.invited_by.inviter, self.kiran)

    def test_a_username_is_not_a_code(self):
        priya = make_user("priya")
        with self.assertRaisesMessage(InviteError, "couldn't find that invite code"):
            record(priya, "kiran")

    def test_the_rules_are_said_in_words(self):
        noah = make_user("noah")
        for text, words in [("ZZZZZZ", "couldn't find"), (InviteCode.for_user(noah).code, "can't invite yourself")]:
            with self.assertRaisesMessage(InviteError, words):
                record(noah, text)
        old = make_user("old", days_ago=30)
        with self.assertRaisesMessage(InviteError, "first 14 days"):
            record(old, InviteCode.for_user(self.kiran).code)
        earlier = make_user("earlier", days_ago=5)
        newer = make_user("newer")
        with self.assertRaisesMessage(InviteError, "joined after you"):
            record(earlier, InviteCode.for_user(newer).code)

    def test_it_counts_only_once_they_use_the_app(self):
        priya = make_user("priya")
        record(priya, InviteCode.for_user(self.kiran).code)
        self.assertEqual(summary(self.kiran)["joined"], 0)
        self.assertEqual(summary(self.kiran)["waiting"], 1)
        Workplace.objects.create(user=priya, name="Butcher Shop")
        self.assertIsNotNone(Invitation.objects.get(invited=priya).active_at)
        self.assertEqual(summary(self.kiran)["joined"], 1)
        note = Notification.objects.filter(recipient=self.kiran).latest("pk")
        self.assertIn("started using KaamKoRecord with your invite", note.title)
        self.assertIn("1 of 10 for Bronze Champion", note.body)
        # A second workplace doesn't count twice.
        Workplace.objects.create(user=priya, name="Second job")
        self.assertEqual(summary(self.kiran)["joined"], 1)

    def test_somebody_already_using_the_app_counts_at_once(self):
        priya = make_user("priya")
        Workplace.objects.create(user=priya, name="Butcher Shop")
        record(priya, InviteCode.for_user(self.kiran).code)
        self.assertEqual(summary(self.kiran)["joined"], 1)

    def _bring_in(self, n):
        for i in range(n):
            person = make_user(f"friend{Invitation.objects.count()}x{i}")
            record(person, InviteCode.for_user(self.kiran).code)
            activate(person)

    def test_levels_at_10_25_50_with_a_badge_and_a_note(self):
        self._bring_in(9)
        self.assertIsNone(champion(self.kiran))
        self._bring_in(1)
        self.assertEqual(champion(self.kiran), "bronze")
        self.assertTrue(Notification.objects.filter(recipient=self.kiran, title="You're a Bronze Champion!").exists())
        self._bring_in(15)
        self.assertEqual(champion(self.kiran), "silver")
        self._bring_in(25)
        self.assertEqual(champion(self.kiran), "gold")
        s = summary(self.kiran)
        self.assertEqual((s["level"], s["next_level"], s["next_at"]), ("gold", None, None))
        self.assertTrue(Notification.objects.filter(recipient=self.kiran, title="You're a Gold Champion!").exists())


class InviteApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.kiran = make_user("kiran", days_ago=100)
        self.client = APIClient()

    def as_(self, user):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {Token.objects.create(user=user).key}")

    def test_summary(self):
        self.as_(self.kiran)
        data = self.client.get("/api/v1/me/invites/").json()
        self.assertEqual(data["link"], f"https://kaamkorecord.com/get/?src=invite&ref={data['code']}")
        self.assertEqual((data["joined"], data["level"], data["next_level"], data["next_at"]), (0, None, "bronze", 10))
        self.assertFalse(data["can_say_invited_by"])  # joined 100 days ago

    def test_say_who_invited_you_after_signing_in(self):
        priya = make_user("priya")
        self.as_(priya)
        bad = self.client.post("/api/v1/me/invites/invited-by/", {"invited_by": "kiran"}, format="json")
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.json()["invited_by"], ["We couldn't find that invite code. Check it and try again."])
        ok = self.client.post("/api/v1/me/invites/invited-by/", {"invited_by": InviteCode.for_user(self.kiran).code}, format="json").json()
        self.assertEqual(ok["invited_by"], "kiran")
        self.assertFalse(ok["can_say_invited_by"])

    def test_sign_up_with_who_invited_you(self):
        code = InviteCode.for_user(self.kiran).code
        made = self.client.post("/api/v1/auth/register/", {"username": "priya", "password": "a-long-pass-9", "invited_by": code}, format="json")
        self.assertEqual(made.status_code, 201)
        self.assertEqual(User.objects.get(username="priya").invited_by.inviter, self.kiran)

    def test_a_wrong_code_at_sign_up_is_a_field_to_fix_and_no_account_is_made(self):
        made = self.client.post("/api/v1/auth/register/", {"username": "priya", "password": "a-long-pass-9", "invited_by": "ZZZZZZ"}, format="json")
        self.assertEqual(made.status_code, 400)
        self.assertIn("invited_by", made.json())
        self.assertFalse(User.objects.filter(username="priya").exists())

    def test_the_medal_rides_on_every_name(self):
        self.as_(self.kiran)
        me = self.client.get("/api/v1/me/").json()
        self.assertIn("champion", me)
        self.assertIsNone(me["champion"])


class InviteWebsiteTests(TestCase):
    def setUp(self):
        cache.clear()
        self.kiran = make_user("kiran", days_ago=100)
        self.code = InviteCode.for_user(self.kiran).code

    def test_the_link_carries_the_code_to_google_play_and_the_website_sign_up(self):
        android = self.client.get(f"/get/?src=invite&ref={self.code}", HTTP_USER_AGENT="Mozilla/5.0 (Linux; Android 15) Mobile")
        self.assertIn(f"utm_content%3D{self.code}", android["Location"])
        page = self.client.get(reverse("register"))
        self.assertContains(page, f'value="{self.code}"')

    def test_sign_up_on_the_website_with_who_invited_you(self):
        self.client.post(reverse("register"), {"username": "priya", "password1": "a-long-pass-9", "password2": "a-long-pass-9", "invited_by": self.code})
        self.assertEqual(User.objects.get(username="priya").invited_by.inviter, self.kiran)

    def test_a_code_typed_in_small_letters_on_the_website_is_kept_in_capitals(self):
        page = self.client.post(reverse("register"), {"username": "pr", "password1": "short", "password2": "other", "invited_by": self.code.lower()})
        self.assertContains(page, f'value="{self.code}"')
        self.assertContains(page, "input--code")

    def test_a_wrong_code_on_the_website_is_shown_under_the_box(self):
        page = self.client.post(reverse("register"), {"username": "priya", "password1": "a-long-pass-9", "password2": "a-long-pass-9", "invited_by": "nope"})
        self.assertContains(page, "We couldn&#x27;t find that invite code. Check it and try again.")
        self.assertFalse(User.objects.filter(username="priya").exists())
