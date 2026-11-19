"""
Blocking and reporting, on the site and through the API: what disappears,
what is refused, and what a report does.
"""

from django.contrib.auth.models import User
from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import FriendRequest, Friendship
from apps.noticeboard.models import Comment, Notice, Visibility
from apps.notifications.models import Notification
from apps.stories.models import Story

from .filter import objectionable
from .models import AUTO_HIDE_AT, Block, Kind, Reason, Report


def _story(author):
    return Story.objects.create(author=author, expires_at=timezone.now() + timezone.timedelta(hours=1))


class BlockTests(TestCase):
    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw12345678")
        self.sam = User.objects.create_user("sam", password="pw12345678")
        self.client.login(username="kiran", password="pw12345678")

    def test_blocking_hides_their_notices_and_comments_both_ways(self):
        theirs = Notice.objects.create(author=self.sam, body="From Sam")
        mine = Notice.objects.create(author=self.kiran, body="From Kiran")
        Comment.objects.create(notice=mine, author=self.sam, body="Sam replying")
        Block.block(self.kiran, self.sam)

        self.assertNotIn(theirs, Notice.visible(self.kiran))
        self.assertNotIn(mine, Notice.visible(self.sam))
        self.assertIn(mine, Notice.visible(self.kiran))
        self.assertEqual(mine.thread(self.kiran), [])

    def test_blocking_ends_the_friendship_and_the_requests(self):
        Friendship.befriend(self.kiran, self.sam)
        FriendRequest.objects.create(from_user=self.sam, to_user=self.kiran)
        Block.block(self.kiran, self.sam)
        self.assertFalse(Friendship.are_friends(self.kiran, self.sam))
        self.assertFalse(FriendRequest.objects.exists())

    def test_a_blocked_pair_cannot_ask_to_be_friends(self):
        Block.block(self.kiran, self.sam)
        self.client.post(reverse("accounts:friend_request_send", args=["sam"]))
        self.assertFalse(FriendRequest.objects.exists())
        # And not from the other side either.
        self.client.logout()
        self.client.login(username="sam", password="pw12345678")
        self.client.post(reverse("accounts:friend_request_send", args=["kiran"]))
        self.assertFalse(FriendRequest.objects.exists())

    def test_blocking_hides_stories_both_ways(self):
        theirs = _story(self.sam)
        mine = _story(self.kiran)
        Block.block(self.kiran, self.sam)
        self.assertNotIn(theirs, Story.objects.for_viewer(self.kiran))
        self.assertNotIn(mine, Story.objects.for_viewer(self.sam))
        self.assertIn(mine, Story.objects.for_viewer(self.kiran))

    def test_no_notifications_across_a_block(self):
        from apps.noticeboard import notify
        Block.block(self.kiran, self.sam)
        notice = Notice.objects.create(author=self.sam, body="Hello board")
        notify.notice_posted(notice)
        self.assertFalse(Notification.objects.filter(recipient=self.kiran).exists())

    def test_the_person_page_when_blocked(self):
        Block.block(self.kiran, self.sam)
        resp = self.client.get(reverse("notices:person", args=["sam"]))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "Unblock")
        # Sam cannot find Kiran's page at all.
        self.client.logout()
        self.client.login(username="sam", password="pw12345678")
        resp = self.client.get(reverse("notices:person", args=["kiran"]))
        self.assertEqual(resp.status_code, 404)

    def test_block_and_unblock_on_the_site(self):
        self.client.post(reverse("moderation:block", args=["sam"]))
        self.assertTrue(Block.is_blocking(self.kiran, self.sam))
        resp = self.client.get(reverse("moderation:blocked"))
        self.assertContains(resp, "sam")
        self.client.post(reverse("moderation:unblock", args=["sam"]))
        self.assertFalse(Block.is_blocking(self.kiran, self.sam))

    def test_you_cannot_block_yourself(self):
        self.client.post(reverse("moderation:block", args=["kiran"]))
        self.assertFalse(Block.objects.exists())

    def test_ids_for_is_remembered_and_forgotten(self):
        self.assertEqual(Block.ids_for(self.kiran), set())
        Block.block(self.kiran, self.sam)
        self.assertEqual(Block.ids_for(self.kiran), {self.sam.pk})
        self.assertEqual(Block.ids_for(self.sam), {self.kiran.pk})
        Block.unblock(self.kiran, self.sam)
        self.assertEqual(Block.ids_for(self.kiran), set())


class ReportTests(TestCase):
    def setUp(self):
        self.kiran = User.objects.create_user("kiran", password="pw12345678")
        self.sam = User.objects.create_user("sam", password="pw12345678")
        self.client.login(username="kiran", password="pw12345678")

    def test_reporting_a_notice_records_it(self):
        notice = Notice.objects.create(author=self.sam, body="Something rude")
        resp = self.client.post(reverse("moderation:report"), {"kind": "notice", "id": notice.pk, "reason": "harassment", "note": "see this"})
        self.assertEqual(resp.status_code, 302)
        report = Report.objects.get()
        self.assertEqual(report.accused, self.sam)
        self.assertEqual(report.reason, Reason.HARASSMENT)
        self.assertEqual(report.excerpt, "Something rude")
        self.assertTrue(report.is_open)

    def test_reporting_twice_counts_once(self):
        notice = Notice.objects.create(author=self.sam, body="x")
        for reason in ("spam", "hate"):
            self.client.post(reverse("moderation:report"), {"kind": "notice", "id": notice.pk, "reason": reason})
        self.assertEqual(Report.objects.count(), 1)
        self.assertEqual(Report.objects.get().reason, Reason.HATE)

    def test_enough_reports_hide_the_thing(self):
        notice = Notice.objects.create(author=self.sam, body="x")
        for i in range(AUTO_HIDE_AT):
            who = User.objects.create_user(f"p{i}", password="pw12345678")
            Report.file(who, Kind.NOTICE, notice, Reason.SPAM)
        notice.refresh_from_db()
        self.assertTrue(notice.hidden)
        self.assertNotIn(notice, Notice.visible(self.kiran))
        # Its author still sees it.
        self.assertIn(notice, Notice.visible(self.sam))

    def test_hidden_comments_and_stories_are_hidden(self):
        notice = Notice.objects.create(author=self.kiran, body="mine")
        comment = Comment.objects.create(notice=notice, author=self.sam, body="theirs", hidden=True)
        self.assertFalse(comment.visible_to(self.kiran))
        story = _story(self.sam)
        story.hidden = True
        story.save()
        self.assertNotIn(story, Story.objects.for_viewer(self.kiran))

    def test_you_cannot_report_your_own(self):
        notice = Notice.objects.create(author=self.kiran, body="mine")
        self.client.post(reverse("moderation:report"), {"kind": "notice", "id": notice.pk, "reason": "spam"})
        self.assertFalse(Report.objects.exists())

    def test_the_report_form_shows_the_thing(self):
        notice = Notice.objects.create(author=self.sam, body="Quoted words")
        resp = self.client.get(reverse("moderation:report"), {"kind": "notice", "id": notice.pk})
        self.assertContains(resp, "Quoted words")
        self.assertContains(resp, "Block sam")

    @override_settings(CONTACT_EMAIL="owner@example.com", EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_a_report_emails_the_site(self):
        notice = Notice.objects.create(author=self.sam, body="x")
        Report.file(self.kiran, Kind.NOTICE, notice, Reason.SPAM)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("Report", mail.outbox[0].subject)

    def test_the_rules_page_is_public(self):
        self.client.logout()
        resp = self.client.get(reverse("moderation:rules"))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "no tolerance")


class FilterTests(TestCase):
    def test_slurs_and_threats_are_caught_whole_word_only(self):
        self.assertTrue(objectionable("you absolute cunt"))
        self.assertTrue(objectionable("KYS"))
        self.assertTrue(objectionable("I will kill you tomorrow"))
        self.assertFalse(objectionable("the class starts at nine"))
        self.assertFalse(objectionable("scunthorpe united"))
        self.assertFalse(objectionable(""))

    def test_a_refused_notice_is_not_posted(self):
        kiran = User.objects.create_user("kiran", password="pw12345678")
        self.client.login(username="kiran", password="pw12345678")
        resp = self.client.post(reverse("notices:create"), {"body": "kys", "visibility": Visibility.PUBLIC})
        self.assertFalse(Notice.objects.exists())
        self.assertNotEqual(resp.status_code, 500)

    @override_settings(OBJECTIONABLE_WORDS=("bananas",))
    def test_the_list_can_be_extended(self):
        self.assertTrue(objectionable("this is bananas"))


class ModeratorTests(TestCase):
    """Admins choose moderators; moderators answer reports, on the site and in the app."""

    def setUp(self):
        from rest_framework.authtoken.models import Token
        self.admin = User.objects.create_user("boss", password="pw", is_staff=True)
        self.mod = User.objects.create_user("mona", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")
        self.eve = User.objects.create_user("eve", password="pw")
        self.tokens = {u.username: Token.objects.create(user=u).key for u in (self.admin, self.mod, self.sam, self.eve)}

    def api(self, method, name, who, data=None, args=None):
        return getattr(self.client, method)(reverse("api:" + name, args=args), data=data, content_type="application/json",
                                            HTTP_AUTHORIZATION=f"Token {self.tokens[who]}")

    def report(self, by, thing, kind=Kind.NOTICE):
        return Report.file(by, kind, thing, Reason.SPAM)

    def test_only_an_admin_makes_and_unmakes_moderators(self):
        from .roles import is_moderator
        self.assertEqual(self.api("post", "person_moderator", "sam", args=["mona"]).status_code, 404)
        self.assertFalse(is_moderator(self.mod))
        made = self.api("post", "person_moderator", "boss", args=["mona"])
        self.assertEqual(made.json()["is_moderator"], True)
        self.assertTrue(is_moderator(self.mod))
        page = self.api("get", "person", "boss", args=["mona"]).json()
        self.assertEqual((page["is_moderator"], page["can_make_moderator"]), (True, True))
        self.assertFalse(self.api("get", "person", "sam", args=["mona"]).json()["can_make_moderator"])
        self.assertTrue(self.api("get", "me", "mona").json()["is_moderator"])
        # A moderator can't make more moderators, and an admin isn't demoted here.
        self.assertEqual(self.api("post", "person_moderator", "mona", args=["eve"]).status_code, 404)
        self.assertEqual(self.api("delete", "person_moderator", "boss", args=["boss"]).status_code, 400)
        self.assertEqual(self.api("delete", "person_moderator", "boss", args=["mona"]).json()["is_moderator"], False)
        self.assertFalse(is_moderator(self.mod))

    def test_a_moderator_sees_one_line_per_thing_and_takes_it_down(self):
        from .roles import set_moderator
        set_moderator(self.mod, True)
        notice = Notice.objects.create(author=self.sam, body="Buy cheap watches")
        self.report(self.eve, notice)
        self.report(self.admin, notice)
        self.assertEqual(self.api("get", "moderation_reports", "sam").status_code, 404)
        queue = self.api("get", "moderation_reports", "mona").json()
        self.assertEqual((queue["count"], queue["open"]), (1, 1))
        line = queue["results"][0]
        self.assertEqual((line["kind"], line["reports"], line["up"], line["excerpt"]), ("notice", 2, True, "Buy cheap watches"))
        self.assertEqual(self.api("post", "moderation_report", "sam", {"action": "take_down"}, args=[line["id"]]).status_code, 404)
        done = self.api("post", "moderation_report", "mona", {"action": "take_down"}, args=[line["id"]]).json()
        self.assertEqual((done["closed"], done["report"]["up"]), (2, False))
        notice.refresh_from_db()
        self.assertTrue(notice.hidden)
        self.assertEqual(self.api("get", "moderation_reports", "mona").json()["count"], 0)
        handled = self.client.get(reverse("api:moderation_reports"), {"status": "handled"}, HTTP_AUTHORIZATION=f"Token {self.tokens['mona']}").json()
        self.assertEqual(handled["count"], 2)  # both reports of it, now closed

    def test_dismissing_brings_back_what_the_reports_hid(self):
        notice = Notice.objects.create(author=self.sam, body="Fine notice")
        for who in [User.objects.create_user(f"r{i}") for i in range(AUTO_HIDE_AT)]:
            self.report(who, notice)
        notice.refresh_from_db()
        self.assertTrue(notice.hidden)
        line = self.api("get", "moderation_reports", "boss").json()["results"][0]
        self.api("post", "moderation_report", "boss", {"action": "dismiss"}, args=[line["id"]])
        notice.refresh_from_db()
        self.assertFalse(notice.hidden)
        self.assertFalse(Report.objects.filter(handled_at__isnull=True).exists())

    def test_a_reported_message_is_removed_and_a_person_only_dismissed(self):
        from apps.chat.models import Conversation, Message
        Friendship.befriend(self.sam, self.eve)
        message = Message.send(self.sam, self.eve, "rude words here")
        self.report(self.eve, message, Kind.MESSAGE)
        person = self.report(self.eve, self.sam, Kind.USER)
        line = next(r for r in self.api("get", "moderation_reports", "boss").json()["results"] if r["kind"] == "message")
        self.api("post", "moderation_report", "boss", {"action": "take_down"}, args=[line["id"]])
        message.refresh_from_db()
        self.assertIsNotNone(message.unsent_at)
        self.assertEqual(message.body, "")
        refused = self.api("post", "moderation_report", "boss", {"action": "take_down"}, args=[person.pk])
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(self.api("post", "moderation_report", "boss", {"action": "dismiss"}, args=[person.pk]).status_code, 200)
        self.assertIsNotNone(Conversation)

    def test_the_site_reports_page_and_profile_button(self):
        from .roles import is_moderator
        notice = Notice.objects.create(author=self.sam, body="Spam spam")
        self.report(self.eve, notice)
        self.client.force_login(self.sam)
        self.assertEqual(self.client.get(reverse("moderation:reports")).status_code, 404)
        self.assertNotContains(self.client.get(reverse("notices:person", args=["mona"])), "Make moderator")
        self.client.force_login(self.admin)
        self.assertContains(self.client.get(reverse("notices:person", args=["mona"])), "Make moderator")
        self.client.post(reverse("moderation:moderator", args=["mona"]), {"on": "1"})
        self.assertTrue(is_moderator(self.mod))
        self.client.force_login(self.mod)
        self.assertContains(self.client.get(reverse("accounts:settings")), "Reports (1)")
        page = self.client.get(reverse("moderation:reports"))
        self.assertContains(page, "Spam spam")
        report = Report.objects.get()
        self.client.post(reverse("moderation:reports"), {"report": report.pk, "action": "take_down"})
        notice.refresh_from_db()
        self.assertTrue(notice.hidden)
        self.assertContains(self.client.get(reverse("moderation:reports") + "?status=handled"), "Spam spam")


class ModeratorBadgeTests(TestCase):
    """A moderator wears a badge wherever their name is shown, as an admin does."""

    def setUp(self):
        from .roles import set_moderator
        self.admin = User.objects.create_user("boss", password="pw", is_staff=True)
        self.mod = User.objects.create_user("mona", password="pw")
        self.sam = User.objects.create_user("sam", password="pw")
        set_moderator(self.mod, True)

    def test_the_app_is_told_who_wears_which_badge(self):
        from apps.api import serialize
        flags = lambda u: (serialize.person(None, u)["is_admin"], serialize.person(None, u)["is_moderator"])  # noqa: E731
        self.assertEqual(flags(self.admin), (True, False))
        self.assertEqual(flags(self.mod), (False, True))
        self.assertEqual(flags(self.sam), (False, False))

    def test_the_badge_follows_the_role_at_once(self):
        from .roles import badge, set_moderator
        self.assertEqual(badge(self.mod), "moderator")
        set_moderator(self.mod, False)
        self.assertIsNone(badge(self.mod))
        set_moderator(self.sam, True)
        self.assertEqual(badge(self.sam), "moderator")

    def test_the_site_shows_it_beside_their_notices(self):
        Notice.objects.create(author=self.mod, body="Mind the wet floor", visibility=Visibility.PUBLIC)
        self.client.force_login(self.sam)
        page = self.client.get(reverse("notices:board")).content.decode()
        self.assertIn('class="admin-badge admin-badge--icon admin-badge--moderator"', page)
        self.assertIn('aria-label="Moderator"', page)
        self.assertNotIn('title="Admin"', page)
        profile = self.client.get(reverse("notices:person", args=["mona"])).content.decode()
        self.assertIn('Moderator</span>', profile)

    def test_a_change_made_in_the_django_admin_shows_at_once(self):
        from django.contrib.auth.models import Group
        from .roles import MODERATORS, badge
        self.assertEqual(badge(self.mod), "moderator")
        self.mod.groups.remove(Group.objects.get(name=MODERATORS))
        self.assertIsNone(badge(self.mod))
        Group.objects.get(name=MODERATORS).user_set.add(self.sam)
        self.assertEqual(badge(self.sam), "moderator")
