"""
Conversations by id — direct and group — driven the way the app drives
them: sending, receipts, attachments, groups and their permissions, and
everything somebody outside a conversation must not be able to reach.
"""

import shutil
import subprocess
import tempfile
import uuid
from io import BytesIO
from unittest import skipUnless
from unittest.mock import patch
from urllib.parse import urlsplit

from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from PIL import Image

from apps.accounts.models import Friendship
from apps.chat import media
from apps.chat.models import Conversation, ConversationMember, Message, MessageAttachment, message_photo_storage
from apps.moderation.models import Block, Report
from apps.notifications.models import Kind, Notification

from .tests import ApiTestCase

HAS_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def jpeg(width=3000, height=2000, gps=False, name="p.jpg"):
    image = Image.new("RGB", (width, height), (200, 80, 40))
    out = BytesIO()
    exif = Image.Exif()
    if gps:
        exif[0x8825] = {1: "N", 2: (34.0, 12.0, 5.0)}
        exif[0x010F] = "PhoneMaker"
    image.save(out, format="JPEG", exif=exif.tobytes())
    return SimpleUploadedFile(name, out.getvalue(), content_type="image/jpeg")


def png_with_alpha():
    image = Image.new("RGBA", (400, 200), (0, 0, 0, 0))
    out = BytesIO()
    image.save(out, format="PNG")
    return SimpleUploadedFile("clear.png", out.getvalue(), content_type="image/png")


class PrivateStorage:
    """Attachments go to a scratch folder, not the project's private_media."""

    def setUp(self):
        super().setUp()
        cache.clear()
        self._dir = tempfile.mkdtemp()
        self._saved = message_photo_storage.__dict__.copy()
        message_photo_storage._location = self._dir
        for attr in ("base_location", "location"):
            message_photo_storage.__dict__.pop(attr, None)

    def tearDown(self):
        message_photo_storage.__dict__.clear()
        message_photo_storage.__dict__.update(self._saved)
        shutil.rmtree(self._dir, ignore_errors=True)
        super().tearDown()


class ConversationTestCase(PrivateStorage, ApiTestCase):
    def setUp(self):
        super().setUp()
        self.ram = User.objects.create_user("ram", password="pw12345678")
        self.eve = User.objects.create_user("eve", password="pw12345678")
        for friend in (self.sam, self.ram):
            Friendship.befriend(self.kiran, friend)
        self.tokens = {"kiran": self.token}
        for name in ("sam", "ram", "eve"):
            self.tokens[name] = self.client.post(reverse("api:login"), {"username": name, "password": "pw12345678"}).json()["token"]

    def as_(self, who):
        return self.tokens[who]

    def direct(self, who="sam", token=None):
        resp = self.api("post", "message_inbox", {"username": who}, token=token)
        self.assertEqual(resp.status_code, 201, resp.content)
        return resp.json()["id"]

    def group(self, title="Night crew", members=("sam", "ram")):
        resp = self.api("post", "message_inbox", {"title": title, "usernames": list(members)})
        self.assertEqual(resp.status_code, 201, resp.content)
        return resp.json()["id"]

    def send(self, cid, body="", token=None, fmt="json", **data):
        return self.api("post", "message_conversation", {"body": body, **data}, args=[cid], token=token, fmt=fmt)

    def open(self, cid, token=None, **query):
        return self.api("get", "message_conversation", query, args=[cid], token=token)


class DirectConversationTests(ConversationTestCase):
    def test_one_conversation_per_pair_whoever_starts_it(self):
        first = self.direct("sam")
        again = self.direct("sam")
        from_sam = self.direct("kiran", token=self.as_("sam"))
        self.assertEqual(len({first, again, from_sam}), 1)
        self.assertEqual(Conversation.objects.filter(kind="direct").count(), 1)

    def test_only_friends_can_start_one(self):
        resp = self.api("post", "message_inbox", {"username": "eve"})
        self.assertEqual(resp.status_code, 400)

    def test_send_is_idempotent_on_client_id_and_ordered_by_the_server(self):
        cid = self.direct()
        key = str(uuid.uuid4())
        with patch("apps.notifications.push.send_to_user"):
            one = self.send(cid, "Hello", client_id=key)
            two = self.send(cid, "Hello", client_id=key)
            self.send(cid, "Second")
        self.assertEqual((one.status_code, two.status_code), (201, 200))
        self.assertEqual(one.json()["id"], two.json()["id"])
        page = self.open(cid, token=self.as_("sam")).json()
        self.assertEqual([m["body"] for m in page["messages"]], ["Hello", "Second"])
        ids = [m["id"] for m in page["messages"]]
        self.assertEqual(ids, sorted(ids))

    def test_history_written_before_conversations_is_still_there(self):
        # A message sent through the username endpoint the released app uses.
        self.api("post", "message_thread", {"body": "From the old app"}, args=["sam"])
        cid = self.direct()
        self.assertEqual([m["body"] for m in self.open(cid).json()["messages"]], ["From the old app"])

    def test_receipts_move_from_sent_to_delivered_to_read(self):
        cid = self.direct()
        sent = self.send(cid, "Are you in?").json()
        self.assertEqual(sent["status"], "sent")
        self.api("post", "message_delivered", args=[sent["id"]], token=self.as_("sam"))
        self.assertEqual(self.open(cid).json()["messages"][0]["status"], "delivered")
        self.open(cid, token=self.as_("sam"))
        self.assertEqual(self.open(cid).json()["messages"][0]["status"], "read")

    def test_pages_go_back_by_cursor_and_forward_after_a_reconnect(self):
        cid = self.direct()
        member = ConversationMember.objects.get(conversation_id=cid, user=self.kiran)
        for n in range(35):
            Message.objects.create(conversation=member.conversation, sender=self.kiran, recipient=self.sam, body=f"m{n}")
        newest = self.open(cid).json()
        self.assertEqual(len(newest["messages"]), 30)
        self.assertTrue(newest["more"])
        older = self.open(cid, before=newest["messages"][0]["id"]).json()
        self.assertEqual([m["body"] for m in older["messages"]], [f"m{n}" for n in range(5)])
        self.assertFalse(older["more"])
        last = newest["messages"][-1]["id"]
        Message.objects.create(conversation=member.conversation, sender=self.sam, recipient=self.kiran, body="late")
        caught_up = self.open(cid, after=last).json()
        self.assertEqual([m["body"] for m in caught_up["messages"]], ["late"])

    def test_a_block_closes_the_conversation_both_ways(self):
        cid = self.direct()
        self.send(cid, "hi")
        Block.objects.create(blocker=self.sam, blocked=self.kiran)
        self.assertEqual(self.open(cid).status_code, 404)
        self.assertEqual(self.send(cid, "still there?").status_code, 404)
        self.assertEqual(self.open(cid, token=self.as_("sam")).status_code, 404)

    def test_strangers_and_forged_senders_get_nothing(self):
        cid = self.direct()
        sent = self.send(cid, "private").json()
        self.assertEqual(self.open(cid, token=self.as_("eve")).status_code, 404)
        self.assertEqual(self.send(cid, "let me in", token=self.as_("eve")).status_code, 404)
        for name in ("message_hide", "message_pin", "message_react", "message_delivered"):
            resp = self.api("post", name, {"emoji": "👍"}, args=[sent["id"]], token=self.as_("eve"))
            self.assertEqual(resp.status_code, 404, name)
        # A sender field in the body is ignored: the message is from whoever is signed in.
        mine = self.send(cid, "who am I", sender="sam").json()
        self.assertTrue(mine["mine"])
        self.assertEqual(Message.objects.get(pk=mine["id"]).sender, self.kiran)

    def test_delete_for_me_leaves_it_for_them(self):
        cid = self.direct()
        sent = self.send(cid, "oops").json()
        self.assertEqual(self.api("post", "message_hide", args=[sent["id"]]).status_code, 204)
        self.assertEqual(self.open(cid).json()["messages"], [])
        self.assertEqual([m["body"] for m in self.open(cid, token=self.as_("sam")).json()["messages"]], ["oops"])

    def test_edit_and_unsend_reach_the_other_side(self):
        cid = self.direct()
        sent = self.send(cid, "typo").json()
        self.api("patch", "message_detail", {"body": "fixed"}, args=[sent["id"]])
        theirs = self.open(cid, token=self.as_("sam")).json()["messages"][0]
        self.assertEqual((theirs["body"], theirs["edited"]), ("fixed", True))
        self.api("delete", "message_detail", args=[sent["id"]])
        theirs = self.open(cid, token=self.as_("sam")).json()["messages"][0]
        self.assertTrue(theirs["unsent"])
        self.assertEqual(theirs["body"], "")

    def test_replies_and_reactions(self):
        cid = self.direct()
        first = self.send(cid, "Saturday?").json()
        reply = self.send(cid, "Yes", token=self.as_("sam"), reply_to=first["id"]).json()
        self.assertEqual(reply["reply"]["body"], "Saturday?")
        reacted = self.api("post", "message_react", {"emoji": "👍"}, args=[first["id"]], token=self.as_("sam")).json()
        self.assertEqual(reacted["reactions"], [{"emoji": "👍", "count": 1}])

    def test_pins_are_mine_and_listed(self):
        cid = self.direct()
        sent = self.send(cid, "Gate code 4321").json()
        self.assertTrue(self.api("post", "message_pin", args=[sent["id"]]).json()["pinned"])
        self.assertEqual([m["body"] for m in self.api("get", "message_pins", args=[cid]).json()["messages"]], ["Gate code 4321"])
        self.assertEqual(self.api("get", "message_pins", args=[cid], token=self.as_("sam")).json()["messages"], [])

    def test_search_inside_a_conversation(self):
        cid = self.direct()
        self.send(cid, "The roster is up")
        self.send(cid, "Nothing here")
        results = self.api("get", "message_search", {"q": "roster"}, args=[cid]).json()["results"]
        self.assertEqual([r["body"] for r in results], ["The roster is up"])

    def test_forward_copies_words_to_another_conversation(self):
        source = self.direct("sam")
        target = self.direct("ram")
        sent = self.send(source, "Pay day moved").json()
        resp = self.api("post", "message_forward", {"conversation_ids": [target]}, args=[sent["id"]])
        self.assertEqual(resp.json()["sent"], [target])
        got = self.open(target, token=self.as_("ram")).json()["messages"][0]
        self.assertEqual((got["body"], got["forwarded"]), ("Pay day moved", True))

    def test_forwarding_into_somebody_elses_conversation_fails(self):
        source = self.direct("sam")
        # sam and ram are not friends, so sam can't open a conversation with ram.
        self.assertEqual(self.api("post", "message_inbox", {"username": "ram"}, token=self.as_("sam")).status_code, 400)
        sent = self.send(source, "x").json()
        foreign = Conversation.objects.create(kind="group", title="Not mine")
        resp = self.api("post", "message_forward", {"conversation_ids": [str(foreign.pk)]}, args=[sent["id"]])
        self.assertEqual(resp.status_code, 400)

    def test_report_sends_only_that_message(self):
        cid = self.direct()
        sent = self.send(cid, "something nasty", token=self.as_("sam")).json()
        resp = self.api("post", "message_report", {"reason": "harassment"}, args=[sent["id"]])
        self.assertEqual(resp.status_code, 201)
        report = Report.objects.get()
        self.assertEqual((report.kind, report.accused, report.excerpt), ("message", self.sam, "something nasty"))
        # Your own message is not yours to report.
        mine = self.send(cid, "mine").json()
        self.assertEqual(self.api("post", "message_report", {"reason": "spam"}, args=[mine["id"]]).status_code, 404)

    def test_sending_too_fast_is_slowed(self):
        cid = self.direct()
        with patch("apps.api.views.conversations.SEND_RATE", 3):
            codes = [self.send(cid, f"n{n}").status_code for n in range(5)]
        self.assertEqual(codes, [201, 201, 201, 429, 429])

    def test_muted_conversations_do_not_notify(self):
        cid = self.direct()
        self.api("patch", "message_conversation", {"muted": True}, args=[cid], token=self.as_("sam"))
        with patch("apps.notifications.push.send_to_user") as push:
            self.send(cid, "quiet")
        push.assert_not_called()
        self.assertFalse(Notification.objects.filter(recipient=self.sam).exists())


class InboxTests(ConversationTestCase):
    def test_inbox_lists_direct_and_group_with_unread_and_previews(self):
        direct = self.direct()
        group = self.group()
        self.send(direct, "hi sam")
        self.send(group, "hi all", token=self.as_("ram"))
        inbox = self.api("get", "message_inbox", token=self.as_("sam")).json()
        rows = {row["id"]: row for row in inbox["conversations"]}
        self.assertEqual(rows[direct]["title"], "kiran")
        self.assertEqual(rows[direct]["last"]["body"], "hi sam")
        self.assertEqual(rows[group]["title"], "Night crew")
        self.assertEqual(rows[group]["last"]["sender"], "ram")
        self.assertEqual(rows[group]["unread"], 1)
        self.assertEqual(inbox["unread"], 2)

    def test_inbox_pages_by_cursor_and_pins_come_first(self):
        friends = []
        for n in range(30):
            friend = User.objects.create_user(f"f{n}", password="pw12345678")
            Friendship.befriend(self.kiran, friend)
            friends.append(friend)
            cid = self.direct(friend.username)
            self.send(cid, f"to f{n}")
        pinned = self.direct("f0")
        self.api("patch", "message_conversation", {"pinned": True}, args=[pinned])
        first = self.api("get", "message_inbox").json()
        self.assertEqual(first["conversations"][0]["id"], pinned)
        self.assertEqual(len(first["conversations"]), 26)  # the pin plus a page of 25
        self.assertIsNotNone(first["next"])
        second = self.api("get", "message_inbox", {"before": first["next"]}).json()
        seen = [row["id"] for row in first["conversations"] + second["conversations"]]
        self.assertEqual(len(seen), len(set(seen)))
        self.assertEqual(len(seen), 30)
        self.assertIsNone(second["next"])

    def test_archive_unread_and_search_filters(self):
        cid = self.direct()
        self.send(cid, "the gate code", token=self.as_("sam"))
        self.api("patch", "message_conversation", {"archived": True}, args=[cid])
        self.assertEqual(self.api("get", "message_inbox").json()["conversations"], [])
        self.assertEqual(len(self.api("get", "message_inbox", {"archived": 1}).json()["conversations"]), 1)
        self.api("patch", "message_conversation", {"archived": False}, args=[cid])
        self.assertEqual(len(self.api("get", "message_inbox", {"unread": 1}).json()["conversations"]), 1)
        self.assertEqual(len(self.api("get", "message_inbox", {"q": "gate"}).json()["conversations"]), 1)
        self.assertEqual(len(self.api("get", "message_inbox", {"q": "nothing like it"}).json()["conversations"]), 0)

    def test_hiding_a_conversation_keeps_it_for_the_other_person(self):
        cid = self.direct()
        self.send(cid, "hello")
        self.assertEqual(self.api("delete", "message_conversation", args=[cid]).status_code, 204)
        self.assertEqual(self.api("get", "message_inbox").json()["conversations"], [])
        self.assertEqual(len(self.api("get", "message_inbox", token=self.as_("sam")).json()["conversations"]), 1)
        # A new message brings it back with only the new line.
        self.send(cid, "again", token=self.as_("sam"))
        rows = self.api("get", "message_inbox").json()["conversations"]
        self.assertEqual(rows[0]["last"]["body"], "again")


class GroupTests(ConversationTestCase):
    def test_a_group_needs_friends_only(self):
        resp = self.api("post", "message_inbox", {"title": "X", "usernames": ["sam", "eve"]})
        self.assertEqual(resp.status_code, 400)

    def test_members_talk_and_strangers_cannot(self):
        cid = self.group()
        with patch("apps.notifications.push.send_to_user"):
            self.assertEqual(self.send(cid, "Shift swap?", token=self.as_("sam")).status_code, 201)
        self.assertEqual(self.open(cid, token=self.as_("eve")).status_code, 404)
        self.assertEqual(self.send(cid, "hi", token=self.as_("eve")).status_code, 404)
        told = Notification.objects.get(recipient=self.ram, kind=Kind.MESSAGE)
        self.assertEqual((told.title, told.body, told.url), ("Night crew", "sam: Shift swap?", f"/profile/?conversation={cid}"))
        self.assertFalse(Notification.objects.filter(recipient=self.sam, kind=Kind.MESSAGE).exists())

    def test_read_receipts_wait_for_everybody(self):
        cid = self.group()
        sent = self.send(cid, "Read me").json()
        self.open(cid, token=self.as_("sam"))
        mine = [m for m in self.open(cid).json()["messages"] if m["id"] == sent["id"]][0]
        self.assertEqual(mine["status"], "sent")  # sam has read it, ram's phone hasn't had it yet
        self.open(cid, token=self.as_("ram"))
        mine = [m for m in self.open(cid).json()["messages"] if m["id"] == sent["id"]][0]
        self.assertEqual(mine["status"], "read")

    def test_only_admins_rename_add_and_remove(self):
        cid = self.group()
        Friendship.befriend(self.sam, self.eve)
        self.assertEqual(self.api("patch", "message_conversation", {"title": "Mine now"}, args=[cid], token=self.as_("sam")).status_code, 400)
        self.assertEqual(self.api("post", "message_members", {"usernames": ["eve"]}, args=[cid], token=self.as_("sam")).status_code, 400)
        self.assertEqual(self.api("delete", "message_member", args=[cid, "ram"], token=self.as_("sam")).status_code, 400)
        self.assertEqual(self.api("patch", "message_conversation", {"title": "Day crew"}, args=[cid]).status_code, 200)
        self.assertEqual(Conversation.objects.get(pk=cid).title, "Day crew")
        self.assertEqual(self.api("delete", "message_member", args=[cid, "ram"]).status_code, 204)
        self.assertEqual(self.open(cid, token=self.as_("ram")).status_code, 404)

    def test_new_members_see_only_what_comes_after_them(self):
        cid = self.group()
        self.send(cid, "before you joined")
        Friendship.befriend(self.kiran, self.eve)
        self.assertEqual(self.api("post", "message_members", {"usernames": ["eve"]}, args=[cid]).status_code, 200)
        self.send(cid, "welcome")
        bodies = [m["body"] for m in self.open(cid, token=self.as_("eve")).json()["messages"] if not m["event"]]
        self.assertEqual(bodies, ["welcome"])
        earlier = Message.objects.get(body="before you joined")
        self.assertEqual(self.api("post", "message_react", {"emoji": "👍"}, args=[earlier.pk], token=self.as_("eve")).status_code, 404)

    def test_the_last_admin_leaving_hands_over(self):
        cid = self.group()
        self.assertEqual(self.api("delete", "message_conversation", {}, args=[cid], QUERY_STRING="leave=1").status_code, 204)
        roles = dict(ConversationMember.objects.filter(conversation_id=cid).values_list("user__username", "role"))
        self.assertEqual(sorted(roles), ["ram", "sam"])
        self.assertIn("admin", roles.values())

    def test_cannot_demote_the_only_admin(self):
        cid = self.group()
        resp = self.api("patch", "message_member", {"role": "member"}, args=[cid, "kiran"])
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.api("patch", "message_member", {"role": "admin"}, args=[cid, "sam"]).status_code, 200)

    def test_a_mention_gets_through_a_mute(self):
        cid = self.group()
        self.api("patch", "message_conversation", {"muted": True}, args=[cid], token=self.as_("sam"))
        self.api("patch", "message_conversation", {"muted": True}, args=[cid], token=self.as_("ram"))
        with patch("apps.notifications.push.send_to_user"):
            self.send(cid, "@sam can you swap?")
        self.assertEqual(Notification.objects.get(recipient=self.sam).title, "kiran mentioned you in Night crew")
        self.assertFalse(Notification.objects.filter(recipient=self.ram).exists())

    def test_blocking_a_member_stops_you_sending_there(self):
        cid = self.group()
        Block.objects.create(blocker=self.kiran, blocked=self.ram)
        resp = self.send(cid, "hello")
        self.assertEqual(resp.status_code, 400)


class AttachmentTests(ConversationTestCase):
    def send_files(self, cid, token=None, **files):
        return self.api("post", "message_conversation", files, args=[cid], token=token, fmt="multipart")

    def fetch(self, url, **extra):
        parts = urlsplit(url)
        return self.client.get(f"{parts.path}?{parts.query}", **extra)

    def test_photos_are_resized_kept_in_shape_and_lose_their_gps(self):
        cid = self.direct()
        resp = self.send_files(cid, photos=[jpeg(gps=True), jpeg(800, 1200)], quality="standard")
        self.assertEqual(resp.status_code, 201, resp.content)
        first, second = resp.json()["attachments"]
        self.assertEqual((first["width"], first["height"]), (1600, 1067))
        self.assertEqual((second["width"], second["height"]), (800, 1200))  # never enlarged
        stored = Image.open(MessageAttachment.objects.get(pk=first["id"]).file.path)
        self.assertNotIn(0x8825, stored.getexif())
        self.assertNotIn(0x010F, stored.getexif())
        thumb = Image.open(MessageAttachment.objects.get(pk=first["id"]).poster.path)
        self.assertEqual(max(thumb.size), 320)

    def test_hd_keeps_more_detail(self):
        cid = self.direct()
        att = self.send_files(cid, photos=[jpeg(4000, 3000)], quality="hd").json()["attachments"][0]
        self.assertEqual((att["width"], att["quality"]), (2560, "hd"))

    def test_transparent_pictures_stay_transparent(self):
        cid = self.direct()
        att = self.send_files(cid, photos=[png_with_alpha()]).json()["attachments"][0]
        self.assertEqual(att["content_type"], "image/webp")
        self.assertEqual(Image.open(MessageAttachment.objects.get(pk=att["id"]).file.path).mode, "RGBA")

    def test_at_most_ten_photos_and_no_fakes(self):
        cid = self.direct()
        resp = self.send_files(cid, photos=[jpeg(50, 50, name=f"{n}.jpg") for n in range(11)])
        self.assertEqual(resp.status_code, 400)
        fake = SimpleUploadedFile("x.jpg", b"not an image at all", content_type="image/jpeg")
        self.assertEqual(self.send_files(cid, photos=[fake]).status_code, 400)
        self.assertEqual(MessageAttachment.objects.count(), 0)
        self.assertEqual(Message.objects.count(), 0)

    @override_settings(CHAT_MEDIA={"photo_max_bytes": 1000})
    def test_size_limits_come_from_settings(self):
        cid = self.direct()
        resp = self.send_files(cid, photos=[jpeg(200, 200)])
        self.assertEqual(resp.status_code, 400)
        self.assertIn("up to", resp.json()["detail"])

    def test_documents_must_match_their_type(self):
        cid = self.direct()
        pdf = SimpleUploadedFile("Roster.pdf", b"%PDF-1.7\n%...rest", content_type="application/pdf")
        resp = self.send_files(cid, file=pdf)
        self.assertEqual(resp.status_code, 201, resp.content)
        att = resp.json()["attachments"][0]
        self.assertEqual((att["kind"], att["name"]), ("file", "Roster.pdf"))
        disguised = SimpleUploadedFile("invoice.pdf", b"MZ\x90\x00 an executable", content_type="application/pdf")
        self.assertEqual(self.send_files(cid, file=disguised).status_code, 400)
        script = SimpleUploadedFile("run.exe", b"MZ\x90\x00", content_type="application/octet-stream")
        self.assertEqual(self.send_files(cid, file=script).status_code, 400)
        binary_txt = SimpleUploadedFile("notes.txt", b"abc\x00def", content_type="text/plain")
        self.assertEqual(self.send_files(cid, file=binary_txt).status_code, 400)

    def test_files_are_downloads_and_only_for_members(self):
        cid = self.direct()
        pdf = SimpleUploadedFile("../../etc/Roster.pdf", b"%PDF-1.7 data", content_type="application/pdf")
        att = self.send_files(cid, file=pdf).json()["attachments"][0]
        self.assertEqual(att["name"], "Roster.pdf")
        theirs = self.open(cid, token=self.as_("sam")).json()["messages"][0]["attachments"][0]
        resp = self.fetch(theirs["url"])
        self.assertEqual(resp.status_code, 200)
        self.assertIn("attachment", resp["Content-Disposition"])
        self.assertEqual(resp["X-Content-Type-Options"], "nosniff")
        # Another person's signature on the same link, a tampered link, no link.
        path = urlsplit(theirs["url"]).path
        self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.client.get(path + "?access=abc").status_code, 404)
        other = MessageAttachment.objects.create(message=Message.objects.create(sender=self.eve, body="x"), kind="file", content_type="text/plain")
        self.assertEqual(self.fetch(theirs["url"].replace(att["id"], str(other.pk))).status_code, 404)

    def test_a_link_stops_working_when_access_ends(self):
        cid = self.group()
        att = self.send_files(cid, photos=[jpeg(100, 100)]).json()["attachments"][0]
        ram_link = self.open(cid, token=self.as_("ram")).json()["messages"][-1]["attachments"][0]["url"]
        self.assertEqual(self.fetch(ram_link).status_code, 200)
        self.api("delete", "message_member", args=[cid, "ram"])
        self.assertEqual(self.fetch(ram_link).status_code, 404)
        self.assertTrue(att["thumb"])

    def test_ranges_are_answered_for_players(self):
        cid = self.direct()
        att = self.send_files(cid, photos=[jpeg(300, 300)]).json()["attachments"][0]
        resp = self.fetch(att["url"], HTTP_RANGE="bytes=0-9")
        self.assertEqual(resp.status_code, 206)
        self.assertEqual(len(b"".join(resp.streaming_content)), 10)

    def test_unsending_removes_the_files(self):
        cid = self.direct()
        sent = self.send_files(cid, photos=[jpeg(100, 100)]).json()
        path = MessageAttachment.objects.get(pk=sent["attachments"][0]["id"]).file.path
        self.api("delete", "message_detail", args=[sent["id"]])
        self.assertFalse(MessageAttachment.objects.exists())
        import os
        self.assertFalse(os.path.exists(path))
        self.assertEqual(self.fetch(sent["attachments"][0]["url"]).status_code, 404)

    def test_closing_an_account_removes_its_files(self):
        import os
        cid = self.direct()
        with self.captureOnCommitCallbacks(execute=True):
            sent = self.send_files(cid, photos=[jpeg(100, 100)]).json()
        path = MessageAttachment.objects.get(pk=sent["attachments"][0]["id"]).file.path
        self.assertTrue(os.path.exists(path))
        with self.captureOnCommitCallbacks(execute=True):
            self.kiran.delete()
        self.assertFalse(MessageAttachment.objects.exists())
        self.assertFalse(os.path.exists(path))

    def test_a_retry_with_the_same_client_id_keeps_one_copy(self):
        cid = self.direct()
        key = str(uuid.uuid4())
        one = self.send_files(cid, photos=[jpeg(100, 100)], client_id=key)
        two = self.send_files(cid, photos=[jpeg(100, 100)], client_id=key)
        self.assertEqual((one.status_code, two.status_code), (201, 200))
        self.assertEqual(MessageAttachment.objects.count(), 1)

    def test_gallery_lists_shared_photos_and_links(self):
        cid = self.direct()
        self.send_files(cid, photos=[jpeg(100, 100), jpeg(120, 100)])
        self.send(cid, "see https://kaamkorecord.com/help")
        photos = self.api("get", "message_gallery", {"kind": "photo"}, args=[cid]).json()["items"]
        self.assertEqual(len(photos), 2)
        links = self.api("get", "message_gallery", {"kind": "link"}, args=[cid]).json()["items"]
        self.assertEqual(links[0]["url"], "https://kaamkorecord.com/help")
        self.assertEqual(self.api("get", "message_gallery", {"kind": "photo"}, args=[cid], token=self.as_("eve")).status_code, 404)

    def test_forwarding_copies_attachments_privately(self):
        source, target = self.direct("sam"), self.direct("ram")
        sent = self.send_files(source, photos=[jpeg(100, 100)]).json()
        self.api("post", "message_forward", {"conversation_ids": [target]}, args=[sent["id"]])
        copy = self.open(target, token=self.as_("ram")).json()["messages"][0]
        self.assertEqual(len(copy["attachments"]), 1)
        self.assertNotEqual(copy["attachments"][0]["id"], sent["attachments"][0]["id"])
        # ram can open the copy, not the original
        self.assertEqual(self.fetch(copy["attachments"][0]["url"]).status_code, 200)

    def test_notification_says_what_was_sent_not_the_file_name(self):
        cid = self.direct()
        with patch("apps.notifications.push.send_to_user"):
            self.send_files(cid, photos=[jpeg(50, 50), jpeg(60, 60)])
        self.assertEqual(Notification.objects.get(recipient=self.sam).body, "Sent 2 photos")

    @skipUnless(HAS_FFMPEG, "needs ffmpeg")
    def test_a_video_is_transcoded_with_a_poster(self):
        cid = self.direct()
        clip = self._clip("testsrc=size=1920x1080:rate=60", seconds=2)
        resp = self.send_files(cid, video=SimpleUploadedFile("clip.mov", clip, content_type="video/quicktime"))
        self.assertEqual(resp.status_code, 201, resp.content)
        att = resp.json()["attachments"][0]
        self.assertEqual((att["kind"], att["content_type"], att["height"]), ("video", "video/mp4", 720))
        self.assertTrue(att["thumb"])
        info = media.probe(MessageAttachment.objects.get(pk=att["id"]).file.path)
        self.assertEqual(info["video"]["codec"], "h264")

    @skipUnless(HAS_FFMPEG, "needs ffmpeg")
    @override_settings(CHAT_MEDIA={"video_max_seconds": 1})
    def test_a_video_over_the_length_limit_is_refused_not_cut(self):
        cid = self.direct()
        clip = self._clip("testsrc=size=320x240:rate=10", seconds=3)
        resp = self.send_files(cid, video=SimpleUploadedFile("long.mp4", clip, content_type="video/mp4"))
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Trim", resp.json()["detail"])

    def test_something_that_is_not_a_video_is_refused(self):
        cid = self.direct()
        resp = self.send_files(cid, video=SimpleUploadedFile("x.mp4", b"\x00\x00\x00 nope", content_type="video/mp4"))
        self.assertEqual(resp.status_code, 400)

    @skipUnless(HAS_FFMPEG, "needs ffmpeg")
    def test_a_voice_message_becomes_mono_aac_with_its_waveform(self):
        cid = self.direct()
        audio = self._clip("sine=frequency=440:duration=2", seconds=2, audio_only=True)
        resp = self.send_files(cid, audio=SimpleUploadedFile("v.m4a", audio, content_type="audio/mp4"), waveform="[10, 50, 120, -3]")
        self.assertEqual(resp.status_code, 201, resp.content)
        att = resp.json()["attachments"][0]
        self.assertEqual((att["kind"], att["content_type"], att["waveform"]), ("audio", "audio/mp4", [10, 50, 100, 0]))
        self.assertAlmostEqual(att["duration"], 2, delta=0.2)

    @skipUnless(HAS_FFMPEG, "needs ffmpeg")
    def test_a_large_video_can_arrive_in_resumable_pieces(self):
        import base64
        cid = self.direct()
        clip = self._clip("testsrc=size=320x240:rate=10", seconds=1)
        upload_id = uuid.uuid4().hex
        half = len(clip) // 2
        pieces = [clip[:half], clip[half:]]
        for index, piece in enumerate(pieces):
            body = {"upload_id": upload_id, "index": index, "total": 2, "offset": index * half, "data": base64.b64encode(piece).decode()}
            self.assertEqual(self.api("post", "uploads", body).status_code, 200)
        # The answer to the last piece was lost and it is sent again: not appended twice.
        self.assertEqual(self.api("post", "uploads", body).json()["bytes"], len(clip))
        self.assertEqual(self.api("get", "uploads", {"upload_id": upload_id}).json()["bytes"], len(clip))
        resp = self.api("post", "message_conversation", {"upload_id": upload_id, "upload_kind": "video", "upload_name": "clip.mp4"}, args=[cid])
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()["attachments"][0]["kind"], "video")
        self.assertEqual(self.api("get", "uploads", {"upload_id": upload_id}).json()["bytes"], 0)

    def _clip(self, source, seconds, audio_only=False):
        out = tempfile.NamedTemporaryFile(suffix=".m4a" if audio_only else ".mp4", delete=False)
        out.close()
        args = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", source, "-t", str(seconds)]
        if audio_only:
            args += ["-c:a", "aac", out.name]
        else:
            args += ["-pix_fmt", "yuv420p", "-c:v", "libx264", out.name]
        subprocess.run(args, check=True, capture_output=True)
        with open(out.name, "rb") as f:
            data = f.read()
        import os
        os.unlink(out.name)
        return data
