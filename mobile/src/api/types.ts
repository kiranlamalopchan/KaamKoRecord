/** The shapes apps/api/serialize.py writes, as the app reads them. */

export type Person = {
  username: string;
  name: string;
  initial: string;
  hue: number;
  photo: string | null;
  is_live: boolean;
  is_me: boolean;
  /** One of the people who run the board — wears a mark beside the name. */
  is_admin: boolean;
  /** A moderator an admin chose (admins are is_admin instead): the outlined badge. */
  is_moderator?: boolean;
  /** Brought 10, 25 or 50 people into the app: the Champion medal beside the name. */
  champion?: ChampionLevel | null;
};

export type ChampionLevel = "bronze" | "silver" | "gold";

/** Profile → Invite friends (GET me/invites/). */
export type Invites = {
  code: string;
  link: string;
  /** People they invited who use the app — what counts. */
  joined: number;
  /** Signed up with their code, not using the app yet. */
  waiting: number;
  level: ChampionLevel | null;
  next_level: ChampionLevel | null;
  next_at: number | null;
  levels: { level: ChampionLevel; at: number }[];
  /** Who invited this person, once said. */
  invited_by: string | null;
  /** In their first fortnight and not said yet: the "Who invited you?" box. */
  can_say_invited_by: boolean;
};

export type Me = Person & {
  display_name: string;
  email: string;
  phone: string;
  address: string;
  is_staff: boolean;
  /** Admins and the moderators they chose: the Reports screen is theirs. */
  is_moderator?: boolean;
  has_password?: boolean;
  social_providers?: ("google" | "apple")[];
  /** Granted by the server only to authorised festival administrators. */
  can_manage_festival?: boolean;
  holiday_state: string;
  /** Which KaamKoRecord the phone is talking to — see the line under the profile. */
  server_version?: string;
  since: string;
};

export type Emoji = { value: string; label: string };

export type ReactionTally = {
  reactions: { emoji: string; count: number }[];
  total_reactions: number;
  my_emoji: string;
  who_reacted: string;
};

/** Who a notice or a comment reaches — see apps/noticeboard/models.py:Visibility. */
export type Visibility = "public" | "friends" | "private";

export type Comment = ReactionTally & {
  id: number;
  author: Person;
  body: string;
  visibility: Visibility;
  created: string;
  ago: string;
  mine: boolean;
  parent: number | null;
  replies: Comment[];
  older_replies: number;
};

export type Notice = ReactionTally & {
  id: number;
  author: Person;
  body: string;
  visibility: Visibility;
  created: string;
  ago: string;
  edited: boolean;
  is_new: boolean;
  mine: boolean;
  /** Held at the top of the board by an admin. Absent from an older server. */
  pinned?: boolean;
  /** Whether this viewer is offered Pin / Unpin — the server decides who. */
  can_pin?: boolean;
  comment_total: number;
  comments: Comment[];
  older_comments: number;
};

export type Page<T> = { results: T[]; page: number; pages: number; count: number; next: number | null };

export type Reactors = {
  total: number;
  my_emoji: string;
  groups: { emoji: string; people: Person[] }[];
};

export type PersonPage = {
  /** Their id on the server — what a report of the person names. */
  id: number;
  person: Person;
  /** Whether you have blocked them — their notices are then hidden. */
  blocked: boolean;
  /** Friends, with no block either way — whether the Message button belongs here. */
  can_message?: boolean;
  is_moderator?: boolean;
  /** You're an admin and they aren't: the Make moderator button. */
  can_make_moderator?: boolean;
  since: string;
  notice_count: number;
  comment_count: number;
  received: number;
  given: number;
  notices: Notice[];
  /** Where the two of you stand — which button the head of the page shows. */
  friendship?: "me" | "friends" | "sent" | "received" | "none";
  /** The pending request either way (sent or received), to cancel or accept. */
  friend_request?: number | null;
  friends_count?: number;
  /** Friends you share: how many, and the first few faces. */
  mutual_count?: number;
  mutual?: Person[];
  /** A story you may watch: the ring around their face. */
  story?: "unseen" | "seen" | null;
};

export type FriendRequest = { id: number; person: Person };

export type Friends = {
  friends: Person[];
  received: FriendRequest[];
  sent: FriendRequest[];
  /** Only the first few of everyone else; the search reaches the rest. */
  others: Person[];
  /** How many there are in all, for the count and the "showing 5 of 40" line. */
  others_total: number;
  /** Sent when a screenful was asked for (?limit=); the rest comes from friends/page/. */
  friends_total?: number;
};

export type TrayRow = Person & {
  latest: { id: number; kind: "photo" | "video"; image: string | null };
  count: number;
  unseen: boolean;
  mine: boolean;
};

export type Story = {
  id: number;
  kind: "photo" | "video";
  image: string | null;
  video: string | null;
  duration: number | null;
  caption: string;
  visibility: Visibility;
  ago: string;
  created: string;
  mine: boolean;
  my_emoji: string;
  reactions: { emoji: string; count: number }[];
  seen_count?: number;
  viewers?: { name: string; ago: string }[];
};

export type StoryPerson = {
  person: Person;
  name: string;
  start: number;
  emoji: Emoji[];
  max_seconds: number;
  stories: Story[];
};

export type Notification = {
  id: number;
  kind: "notice" | "comment" | "reply" | "reaction" | "timesheet" | "story" | "friend_request" | "friend_accepted" | "roster" | "message";
  icon: string;
  title: string;
  body: string;
  emoji: string;
  url: string;
  actor: Person | null;
  hue: number;
  created: string;
  ago: string;
  read: boolean;
};

export type HolidayCard = {
  name: string;
  date: string;
  month_short: string;
  day: string;
  weekday: string;
  days_remaining: number;
  countdown: string;
  scope: string;
  is_national: boolean;
};

/** The hub's small pleasures (mywork/daily.py): new at midnight, the same for everyone. */
export type Daily = { quote: { text: string; who: string }; joke: { setup: string; punchline: string } };
export type Festival = { id: string; name: string; greeting: string; description: string; motion: string; image_url: string };
/** The friend circles above the board: the newest few faces, how many in all, and a line naming them. */
export type HomeFriends = { total: number; more: number; summary: string; people: Person[] };
export type Home = {
  festival?: Festival | null;
  holiday: { state: string; holiday: HolidayCard | null };
  stories: TrayRow[];
  notices: Notice[];
  notice_total: number;
  friends: HomeFriends;
  unread: number;
  emoji: Emoji[];
  /** "Monday, 21 September" — for the wide hub's header. */
  today: string;
  daily: Daily;
  setup?: { workplace_count: number; shift_count: number };
  /** What working a public holiday pays at your default job, when more than 1×. */
  holiday_rate?: number | null;
};

export type PluItem = { plu_no: number; description: string };
/** One line of a photographed picking list, named. */
export type PhotoRow = { line: string; item: PluItem; score: number; sureness: "sure" | "likely" | "unsure" | "picked"; by_code: boolean; alternatives: PluItem[] };
export type PhotoRead = { rows: PhotoRow[]; skipped: number };
/** Whether this account may replace the PLU list, and what the file needs. */
export type PluImportable = { allowed: boolean; headers: string[]; total: number };
export type PluImported = { created: number; updated: number; skipped: number; total: number; message: string };

// ---- TimeSheet -----------------------------------------------------------------

/** A stretch of time as the site prints it: seconds, and its words. */
export type Duration = { seconds: number; hm: string; hms: string; minutes: string; decimal: string };
export type Money = { gross: number; tax: number; net: number };
export type WorkplaceBrief = { id: number; name: string; hue: number; css: string; is_default: boolean };
export type Workplace = WorkplaceBrief & {
  address: string; hourly_rate: number | null; tax_rate: number | null; in_cash: boolean; withholds: boolean;
  saturday_multiplier?: number; sunday_multiplier?: number; public_holiday_multiplier?: number; overtime_after_hours?: number | null; overtime_multiplier?: number;
  /** A second step of overtime: double time from this many hours into a shift. */
  double_time_after_hours?: number | null; double_time_multiplier?: number;
  // Optional: a server from before the ATO scales sends neither.
  tax_scale?: TaxScale; study_loan?: boolean; tax_label?: string;
  paid_in: "BANK" | "CASH"; pay_cycle: "IRREGULAR" | "WEEK" | "FORTNIGHT" | "MONTH"; pay_cycle_label: string;
  hours_limit: number | null; limit_period: "WEEK" | "FORTNIGHT" | "MONTH"; limit_label: string | null;
  week_starts_on: number; fortnight_starts_on: number; fortnight_phase: "this" | "last"; fortnight_hint: string; month_starts_on: number;
  sub: string;
};
export type ShiftStatus = "WORKING" | "ON_BREAK" | "COMPLETED";
export type ShiftRow = {
  id: number; workplace: WorkplaceBrief | null; status: ShiftStatus; status_label: string; is_open: boolean;
  clock_in: string; clock_out: string | null; in_at: string; out_at: string | null; date: string;
  worked: Duration; total_break: Duration; seq: number | null; gap_before: Duration | null;
};
export type Break = { id: number; break_start: string; break_end: string | null; start_at: string; end_at: string | null; is_running: boolean; duration: Duration };
export type ShiftDetail = ShiftRow & {
  date_label: string; total: Duration; pay: Money | null; in_cash: boolean; withholds: boolean; note: string; breaks: Break[];
};
export type LimitCard = {
  workplace: WorkplaceBrief; cap: Duration; used: Duration; remaining: Duration; over: Duration; percent: number;
  settled: Duration; settled_percent: number; since: Duration; since_percent: number; paid_at: string | null;
  period_label: string; period: string; resets_on: string; state: "ok" | "close" | "over";
};
export type PeriodPay = { pay: Money; withheld: boolean; cash: boolean } | null;
export type Summary = {
  cards: { key: string; label: string; sub: string; total: Duration; net: number | null }[];
  period: { key: string; title: string; dates: string; total: Duration; pay: PeriodPay };
  limits: LimitCard[];
};
export type TimesheetDay = { date: string; label: string; total: Duration; is_run: boolean; shifts: ShiftRow[] };
/** A week behind the one being read: shut, and saying what is inside it. */
export type TimesheetWeek = { start: string; first_label: string; last_label: string; total: Duration; shifts: number; days: TimesheetDay[] };
export type TimesheetPage = Page<never> & { days: TimesheetDay[]; weeks: TimesheetWeek[]; workplaces: WorkplaceBrief[]; workplace: number | null; summary: Summary };
/** The chart: a span cut into days, weeks or months, laid over the span before it. */
export type TrendRange = "week" | "fortnight" | "month" | "months";
export type TrendFigure = { hours: number; worked: Duration; gross: number | null };
export type TrendPoint = TrendFigure & { start: string; label: string; long_label: string; upcoming: boolean; current: boolean };
export type Trend = {
  range: TrendRange; title: string; compare_title: string; ranges: { value: TrendRange; label: string }[];
  /** False when no job in view has a rate: the chart counts hours instead of money. */
  priced: boolean;
  points: TrendPoint[]; previous: TrendFigure[]; total: TrendFigure; previous_total: TrendFigure;
};
export type CalendarCell = { date: string; day: number; in_month: boolean; is_today: boolean; total: Duration | null; track: { css: string; left: number; width: number }[]; lead: string | null };
export type CalendarPage = {
  year: number; month: number; label: string; weekday_labels: string[]; weeks: CalendarCell[][];
  legend: { name: string; css: string; worked: Duration }[]; month_total: Duration; worked_days: number;
  prev: { year: number; month: number }; next: { year: number; month: number };
  selected: string | null; selected_label: string | null; selected_shifts: ShiftRow[]; selected_total: Duration;
};
export type ClockState = {
  server_now: string; today: string; workplaces: WorkplaceBrief[]; selected: number | null;
  shift: {
    id: number; status: ShiftStatus; status_label: string; workplace: WorkplaceBrief | null; clock_in: string; in_at: string;
    worked: Duration; total_break: Duration; banked_break_seconds: number;
    running_break: { start: string; start_at: string; duration: Duration } | null;
  } | null;
  target_hours: number; long_shift: boolean; limit: LimitCard | null;
  /** Every workplace's hours since the week began, as of server_now (newer servers). */
  week?: { worked: Duration } | null;
  /** A cash job with no cap: the hours owed for, where the cap bar would be. */
  tally: CashTally | null;
  message?: string; finished?: number; replayed?: boolean;
};
export type ClockActionMeta = { client_id: string; client_time: string; client_tz: string };
export type CashTally = { workplace: WorkplaceBrief; label: string; sub: string; total: Duration; pay: Money | null };
export type NewShift = { supports_offline_drafts?: boolean; workplaces: WorkplaceBrief[]; workplace: number | null; clock_in: string; clock_out: string };
export type ShiftInput = { client_id?: string; workplace: number | ""; clock_in: string; clock_out: string; note: string; breaks: { id?: number; break_start: string; break_end: string; delete?: boolean }[] };
export type Choice<T = string | number> = { value: T; label: string; css?: string };
export type Cycles = { week_starts_on: number; week_label: string; fortnight_starts_on: number; fortnight_phase: "this" | "last"; fortnight_hint: string; month_starts_on: number };
export type TaxScale = "" | "TFT" | "NO_TFT" | "FOREIGN" | "WHM" | "NO_TFN" | "CUSTOM";
export type WorkplacesPage = {
  workplaces: Workplace[]; cycles: Cycles;
  choices: {
    weekdays: Choice<number>[]; phases: Choice[]; colors: Choice<number>[]; pay_cycles: Choice[]; paid_in: Choice[]; limit_periods: Choice[]; max_month_start: number;
    tax_scales?: Choice[]; loan_scales?: string[];
  };
  new_tax_scale?: TaxScale;
};
export type WorkplaceInput = {
  name: string; address: string; color: number | ""; pay_cycle: string; paid_in: string; hourly_rate: string; tax_rate: string;
  saturday_multiplier?: string; sunday_multiplier?: string; public_holiday_multiplier?: string; overtime_after_hours?: string; overtime_multiplier?: string;
  double_time_after_hours?: string; double_time_multiplier?: string;
  tax_scale?: string; study_loan?: boolean;
  hours_limit: string; limit_period: string; week_starts_on: number; fortnight_starts_on: number; fortnight_phase: string; month_starts_on: number | string; is_default: boolean;
};
export type PayRun = { start: string | null; end: string | null; dates: string | null; payday: string | null; hours: number; worked: Duration; shifts: number; pay: Money | null; closed: boolean; payable: boolean };
export type PayRow = {
  workplace: WorkplaceBrief; cycle_label: string; period_label: string; scheduled: boolean; worked: Duration; shifts: number;
  owed_pay: Money | null; since: string | null; earliest: string | null; current: PayRun | null; due: PayRun[];
  covers: Choice[]; last_payment: { covers_through: string; hours: number; amount: number | null } | null;
};
export type PayForecast = { days: number; rows: { workplace: WorkplaceBrief; shifts: number; hours: number; gross: number; tax: number; net: number }[]; gross: number; net: number };
export type PayPage = { owing: PayRow[]; owed_total: Duration; today: string; forecast?: PayForecast; message?: string };
export type MorePage = { workplace_count: number; unpaid_total: Duration };
export type Activity = {
  week_hours: number; shift_count: number; workplace_count: number; friend_count: number; notice_count: number; comment_count: number; reactions_received: number;
  statement: { this_month: [string, string]; last_month: [string, string]; today: string; workplaces: { id: number; name: string }[] };
};
export type PayslipRead = { fields: Record<string, string | number | boolean>; read: { label: string; value: string; how: string }[]; notes: string[] };
export type Going = { shifts: number; breaks: number; payments: number; worked: Duration; span: string | null };

// ---- Safety: blocking people and reporting posts -----------------------------

export type ReportKind = "notice" | "comment" | "story" | "user";
export type ReportReason = { value: string; label: string };
export type BlockedPerson = { person: Person; since: string };

// ---- the roster ---------------------------------------------------------------

/** A shift you are due to work, or one a friend needs covered. */
export type Planned = {
  id: number;
  /** ISO instants, for the phone's own alarms. */
  starts: string;
  ends: string;
  /** "Sat 14 Nov", "9:00 am – 5:00 pm", "8h" — as the server words them. */
  day: string;
  date: string;
  time: string;
  length: string;
  place: string;
  workplace: WorkplaceBrief | null;
  note: string;
  /** Up for a friend to take. */
  offered: boolean;
  mine: boolean;
  /** Whose it is, on a friend's offer. */
  owner: Person | null;
  /** Who it came from, on one you took. */
  given_by: Person | null;
};
export type RosterPage = { mine: Planned[]; offers: Planned[]; workplaces: WorkplaceBrief[]; detail?: string };
export type PlannedInput = { workplace: number | ""; starts: string; ends: string; note: string };

// ---- messages -----------------------------------------------------------------

export type ChatMessage = {
  id: number; client_id?: string | null; body: string; mine: boolean; at: string; day: string; time: string;
  read: boolean; status?: "sent" | "delivered" | "read"; edited?: boolean; unsent?: boolean;
  photo?: string | null; reactions?: { emoji: string; count: number }[]; my_reaction?: string | null;
  reply?: { id: number; body: string; mine: boolean; photo: boolean; unsent: boolean } | null;
};
export type ChatAttachment = {
  id: string; kind: "photo" | "video" | "audio" | "file"; url: string; thumb: string | null; download: string;
  name: string; content_type: string; size: number; duration: number | null; width: number | null; height: number | null;
  quality: string; waveform: number[];
};
export type ChatStatus = "pending" | "sending" | "sent" | "delivered" | "read" | "failed";
/** A message in a conversation (direct or group) from the conversation endpoints. */
export type ConvoMessage = Omit<ChatMessage, "status" | "reply"> & {
  conversation_id: string; sender: Person; attachments: ChatAttachment[]; forwarded: boolean;
  event: string | null; pinned: boolean; status?: ChatStatus;
  reply?: { id: number; body: string; mine: boolean; photo: boolean; unsent: boolean; sender?: string; attachment?: string | null } | null;
};
export type ConvoSummary = {
  id: string; kind: "direct" | "group"; title: string; person: Person | null; photo: string | null; initial: string; hue: number;
  pinned: boolean; muted: boolean; archived: boolean; role: "admin" | "member"; member_count?: number; unread?: number;
  /** In the chat list: a ring round their photo while they have a story up. */
  story?: "unseen" | "seen" | null;
  last?: {
    id: number; body: string; mine: boolean; sender: string; at: string; time: string; day: string;
    unsent: boolean; event: string | null; attachment: string | null; status: "sent" | "delivered" | "read" | null;
  };
};
export type ChatLimits = {
  photo_max_bytes: number; photo_batch: number; video_max_bytes: number; video_max_seconds: number;
  audio_max_seconds: number; audio_max_bytes: number; file_max_bytes: number; file_types: string[];
};
export type ConvoPage = {
  conversation: ConvoSummary; messages: ConvoMessage[]; more: boolean | null; more_newer: boolean; first_unread: number | null;
  can_send: boolean; why_not: string; max_length: number; limits: ChatLimits; typing: string[];
};
export type Inbox = { conversations: ConvoSummary[]; next: number | null; unread: number; /** First page only: how many chats are archived. */ archived?: number };
export type ChatMember = Person & { role: "admin" | "member" };
export type GalleryItem = ChatAttachment & { message_id: number; at: string };
export type LinkItem = { url: string; message_id: number; at: string };
export type ChatThreadRow = { conversation_id: string; person: Person; last: ChatMessage; unread: number; pinned: boolean; muted: boolean; archived: boolean };
export type ChatThreads = { threads: ChatThreadRow[]; unread: number };
export type ChatThread = { conversation_id: string; person: Person; can_send: boolean; max_length: number; messages: ChatMessage[]; more: boolean; typing?: boolean };

// ---- a payslip, checked ---------------------------------------------------------

export type PayslipCheck = {
  verdict: "match" | "short" | "over";
  headline: string;
  lines: string[];
  workplace: WorkplaceBrief;
  period: { start: string; end: string; label: string };
  slip: { hours: number | null; gross: number | null; tax: number | null; net: number | null; hours_worked_out: boolean };
  logged: { hours: number; hm: string; gross: number | null; shifts: number };
  difference: { hours: number; gross: number | null };
  shifts: { id: number; day: string; hm: string }[];
  read: { label: string; value: string; how: string }[];
  notes: string[];
};

/** The next screenful of one Friends list; `next` is the offset after it, or null at the end. */
export type PeoplePage = { people: Person[]; total: number; next: number | null };

/** One reported thing in the moderators' queue (apps/api/views/moderation.py `report_row`). */
export type ModerationReport = {
  id: number;
  kind: "notice" | "comment" | "story" | "user" | "message";
  kind_label: string;
  reason: string;
  reason_label: string;
  note: string;
  excerpt: string;
  reporter: Person;
  accused: Person | null;
  /** How many open reports there are of this same thing. */
  reports: number;
  /** Whether it can still be seen. */
  up: boolean;
  can_take_down: boolean;
  created: string;
  handled: string | null;
};
