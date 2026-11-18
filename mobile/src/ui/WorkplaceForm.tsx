/**
 * One workplace (templates/timeclock/workplace_form.html), simple first.
 *
 * Up front only what nearly everybody sets: the name, its colour, the
 * hourly rate and whether it pays into the bank or in cash. Everything else
 * — pay cycle and tax, weekend and overtime rates, an hours limit, when the
 * week and month start, the address — folds away into rows that each say
 * in one line what they are set to, so the form reads as a summary and is
 * only as long as what you choose to change.
 *
 * Nothing filled or refused is ever hidden: a row the payslip filled, or
 * one the server refused, opens by itself and counts what to check.
 */
import React, { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ApiError, timesheet, type TaxScale, type Workplace, type WorkplaceInput, type WorkplacesPage } from "@/api";
import { unreachable, type FilePart } from "@/api/client";

import { Button, Card, Field, Input, SectionLabel, Segments } from "./index";
import { Disclosure } from "./Disclosure";
import { native } from "./native";
import { notify } from "./confirm";
import { alpha, radius, sp, useTheme } from "./theme";
import { cssColour, Switch } from "./timesheet";
import { Select } from "./Select";
import { usePrivateState } from "@/storage/private";
import { fail, success } from "./haptics";
import { useT } from "@/i18n";

type Choices = WorkplacesPage["choices"];

/**
 * What the file picker will let you choose. Android's Drive and Files treat
 * a wildcard as matching nothing, so the types are spelled out there.
 */
const PAYSLIP_TYPES = Platform.OS === "android"
  ? ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
  : ["application/pdf", "image/*"];

type Section = "pay" | "rates" | "limit" | "cycles" | "address";

/** Which folded row each server field lives in, so a refusal or a payslip fill can open it. */
const SECTION_OF: Record<string, Section> = {
  pay_cycle: "pay", tax_scale: "pay", tax_rate: "pay", study_loan: "pay",
  saturday_multiplier: "rates", sunday_multiplier: "rates", public_holiday_multiplier: "rates",
  overtime_after_hours: "rates", overtime_multiplier: "rates",
  hours_limit: "limit", limit_period: "limit",
  week_starts_on: "cycles", fortnight_starts_on: "cycles", fortnight_phase: "cycles", month_starts_on: "cycles",
  address: "address",
};

const times = (value: string) => {
  const n = Number(value);
  return Number.isFinite(n) ? `${n}×` : `${value}×`;
};

export function WorkplaceForm({ choices, workplace, cycles, newTaxScale, onSave, onCancel }: {
  choices: Choices; workplace?: Workplace; cycles: WorkplacesPage["cycles"]; newTaxScale?: TaxScale;
  onSave: (input: WorkplaceInput) => Promise<void>; onCancel: () => void;
}) {
  const t = useTheme(), tr = useT();
  const w = workplace;
  const initialDraft = {
    name: w?.name || "", address: w?.address || "", color: w?.hue ?? "" as number | "",
    payCycle: w?.pay_cycle || "IRREGULAR", paidIn: w?.paid_in || "BANK",
    rate: w?.hourly_rate != null ? String(w.hourly_rate) : "", tax: w?.tax_rate != null ? String(w.tax_rate) : "",
    sat: String(w?.saturday_multiplier ?? 1), sun: String(w?.sunday_multiplier ?? 1), holiday: String(w?.public_holiday_multiplier ?? 1),
    overtimeAfter: w?.overtime_after_hours != null ? String(w.overtime_after_hours) : "", overtimeMult: String(w?.overtime_multiplier ?? 1.5),
    scale: (w ? (w.tax_scale ?? (w.tax_rate != null ? "CUSTOM" : "")) : (newTaxScale ?? "")) as string,
    loan: !!w?.study_loan, limit: w?.hours_limit != null ? String(w.hours_limit) : "",
    limitPeriod: w?.limit_period || "FORTNIGHT", week: w?.week_starts_on ?? cycles.week_starts_on,
    fortnight: w?.fortnight_starts_on ?? cycles.fortnight_starts_on, phase: (w?.fortnight_phase || cycles.fortnight_phase) as string,
    month: String(w?.month_starts_on ?? cycles.month_starts_on), isDefault: w?.is_default || false,
  };
  type Draft = typeof initialDraft;
  // Kept on the phone (privately) as it is typed, so leaving half-way loses nothing.
  const [saved, setSaved, restored] = usePrivateState<Draft | null>(`workplace-draft:${w?.id || "new"}`, null);
  const d = saved || initialDraft;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setSaved(previous => ({ ...(previous || initialDraft), [key]: value }));

  const scales = choices.tax_scales;
  const loanApplies = (choices.loan_scales || []).includes(d.scale);
  const byPercentage = !scales || d.scale === "CUSTOM";
  const cash = d.paidIn === "CASH";

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Section | null>(null);
  const [read, setRead] = useState<{ label: string; value: string; how: string }[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  // Boxes the payslip filled, marked until edited.
  const [filled, setFilled] = useState<Record<string, boolean>>({});
  const mine = (key: string) => setFilled((was) => (was[key] ? { ...was, [key]: false } : was));
  const toggle = (section: Section) => setOpen(was => (was === section ? null : section));
  /** How many boxes in a row the payslip filled or the server refused: shown on the closed row. */
  const flagged = (section: Section) =>
    Object.keys(SECTION_OF).filter(key => SECTION_OF[key] === section && (filled[key] || errors[key])).length;

  const fillFromPayslip = async () => {
    setReading(true);
    try {
      const DocumentPicker = native<typeof import("expo-document-picker")>(() => require("expo-document-picker"));
      const picked = await DocumentPicker.getDocumentAsync({ type: PAYSLIP_TYPES, copyToCacheDirectory: true });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const file: FilePart = { uri: asset.uri, name: asset.name, type: asset.mimeType || "application/octet-stream" };
      const slip = await timesheet.readPayslip(file);
      const f = slip.fields;
      const got: Record<string, boolean> = {};
      const next: Partial<Draft> = {};
      if (f.name && !d.name) { next.name = String(f.name); got.name = true; }
      if (f.hourly_rate != null) { next.rate = String(f.hourly_rate); got.hourly_rate = true; }
      if (f.tax_rate != null) { next.tax = String(f.tax_rate); got.tax_rate = true; }
      // The tax situation, when the slip's tax matched exactly one of the ATO's;
      // otherwise the slip's own percentage is the way to work it out.
      if (scales && f.tax_scale && scales.some(c => String(c.value) === String(f.tax_scale))) {
        next.scale = String(f.tax_scale); got.tax_scale = true;
        if (typeof f.study_loan === "boolean") { next.loan = f.study_loan; got.study_loan = true; }
      } else if (f.tax_rate != null && scales && !d.scale) next.scale = "CUSTOM";
      // Weekend, holiday and overtime rates, as the slip paid them.
      const rates = { saturday_multiplier: "sat", sunday_multiplier: "sun", public_holiday_multiplier: "holiday", overtime_multiplier: "overtimeMult" } as const;
      for (const [field, key] of Object.entries(rates)) {
        if (f[field] != null) { next[key] = String(f[field]); got[field] = true; }
      }
      if (f.pay_cycle) { next.payCycle = String(f.pay_cycle) as Workplace["pay_cycle"]; got.pay_cycle = true; }
      if (f.limit_period) { next.limitPeriod = String(f.limit_period) as Workplace["limit_period"]; got.limit_period = true; }
      if (f.week_starts_on != null) { next.week = Number(f.week_starts_on); got.week_starts_on = true; }
      if (f.fortnight_starts_on != null) { next.fortnight = Number(f.fortnight_starts_on); got.fortnight_starts_on = true; }
      if (f.fortnight_phase) { next.phase = String(f.fortnight_phase); got.fortnight_phase = true; }
      if (f.month_starts_on != null) { next.month = String(f.month_starts_on); got.month_starts_on = true; }
      setSaved(previous => ({ ...(previous || initialDraft), ...next }));
      setFilled(got);
      // Open the first folded row the slip filled, so its values are seen and checked.
      const first = Object.keys(got).map(key => SECTION_OF[key]).find(Boolean);
      if (first) setOpen(first);
      setRead(slip.read);
      setNotes(slip.notes);
      success();
    } catch (e: any) {
      notify("Couldn't read that payslip", unreachable(e)
        ? e.offline
          ? "You're offline. Turn Wi-Fi or mobile data back on and try again."
          : "Couldn't reach KaamKoRecord. Check your connection, or try again in a moment."
        : e?.message || "That file couldn't be read.");
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    setErrors({}); setDetail(""); setBusy(true);
    try {
      await onSave({
        name: d.name, address: d.address, color: d.color, pay_cycle: d.payCycle, paid_in: d.paidIn, hourly_rate: d.rate,
        saturday_multiplier: d.sat, sunday_multiplier: d.sun, public_holiday_multiplier: d.holiday,
        overtime_after_hours: d.overtimeAfter, overtime_multiplier: d.overtimeMult,
        tax_rate: cash || !byPercentage ? "" : d.tax,
        ...(scales ? { tax_scale: d.scale, study_loan: loanApplies && d.loan } : {}),
        hours_limit: d.limit, limit_period: d.limitPeriod, week_starts_on: d.week, fortnight_starts_on: d.fortnight, fortnight_phase: d.phase,
        month_starts_on: d.month, is_default: d.isDefault,
      });
      setSaved(null);
      success();
    } catch (e: any) {
      fail();
      if (e instanceof ApiError) {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(e.fields)) flat[k] = Array.isArray(v) ? String(v[0]) : String(v);
        setErrors(flat);
        // A refused box in a folded row: open that row, so the message is where the box is.
        const first = Object.keys(flat).map(key => SECTION_OF[key]).find(Boolean);
        if (first) setOpen(first);
        if (!Object.keys(flat).length) setDetail(e.message);
      } else setDetail(e?.message || "That couldn't be saved.");
    } finally {
      setBusy(false);
    }
  };

  // ---- one-line summaries for the folded rows ----
  const label = (list: { value: string | number; label: string }[], value: string | number) =>
    list.find(item => String(item.value) === String(value))?.label ?? "";
  const day = (value: number) => label(choices.weekdays, value).slice(0, 3);
  const taxSummary = cash ? tr("Cash, no tax")
    : scales && d.scale && d.scale !== "CUSTOM" ? label(scales, d.scale)
      : d.tax.trim() ? tr("{n}% tax", { n: d.tax.trim() }) : tr("Pay before tax");
  const paySummary = `${label(choices.pay_cycles, d.payCycle)} · ${taxSummary}`;
  const extras = [
    Number(d.sat) !== 1 ? `${tr("Sat")} ${times(d.sat)}` : "",
    Number(d.sun) !== 1 ? `${tr("Sun")} ${times(d.sun)}` : "",
    Number(d.holiday) !== 1 ? `${tr("Holiday")} ${times(d.holiday)}` : "",
    d.overtimeAfter.trim() ? tr("Overtime after {n} h", { n: d.overtimeAfter.trim() }) : "",
  ].filter(Boolean);
  const ratesSummary = extras.length ? extras.join(" · ") : tr("Same rate every day");
  const limitSummary = d.limit.trim() ? `${d.limit.trim()} h ${label(choices.limit_periods, d.limitPeriod).toLowerCase()}` : tr("No limit");
  const cyclesSummary = tr("Week from {day} · Month from day {n}", { day: day(d.week), n: d.month });

  return (
    <>
      {detail ? <Text accessibilityRole="alert" style={{ color: t.danger, fontSize: 14 }}>{detail}</Text> : null}

      {/* The payslip reader: one quiet row, not a panel. What it read shows under it. */}
      <Pressable onPress={fillFromPayslip} disabled={reading} accessibilityRole="button" accessibilityState={{ busy: reading, disabled: reading }} accessibilityHint={tr("Reads your rates, tax situation and pay cycle off a payslip for you to check")} testID="wp-payslip"
        style={({ pressed }) => [styles.payslip, { backgroundColor: pressed ? alpha(t.violet, 0.14) : alpha(t.violet, 0.08) }]}>
        <Ionicons name="document-text-outline" size={20} color={t.violet} />
        <Text style={{ color: t.text, fontWeight: "600", fontSize: 15, flex: 1 }}>{reading ? tr("Reading payslip…") : tr("Fill from a payslip")}</Text>
        {reading ? <ActivityIndicator size="small" color={t.violet} testID="wp-payslip-reading" /> : <Ionicons name="chevron-forward" size={18} color={t.muted} />}
      </Pressable>
      {read ? (
        <View style={[styles.read, { backgroundColor: alpha(t.violet, 0.06), borderColor: alpha(t.violet, 0.25) }]} accessibilityLiveRegion="polite">
          <Text style={{ color: t.violet, fontWeight: "700", fontSize: 13.5 }}>
            {Object.keys(filled).length === 0 ? tr("Nothing on the slip matched these settings.") : tr("Filled from your payslip — check the marked boxes before saving.")}
          </Text>
          {read.map((r) => <Text key={r.label} style={{ color: t.text2, fontSize: 13 }}><Text style={{ fontWeight: "700", color: t.text }}>{r.label}:</Text> {r.value}</Text>)}
          {notes.map((n) => <Text key={n} style={{ color: t.warn, fontSize: 13 }}>{n}</Text>)}
        </View>
      ) : null}

      {/* What nearly everybody sets. */}
      <Card style={{ gap: sp[4] }}>
        <Field label="Name" error={errors.name} filled={filled.name}>
          <Input value={d.name} onChangeText={(v) => { set("name", v); mine("name"); }} placeholder="e.g. Courtlands Aged Care" testID="wp-name" />
        </Field>
        <Field label="Colour" error={errors.color}>
          <View style={styles.swatches}>
            {choices.colors.map((c) => {
              const on = c.value === d.color;
              return (
                <Pressable key={c.value} onPress={() => set("color", c.value)} hitSlop={4} accessibilityRole="radio" accessibilityLabel={c.label} accessibilityState={{ checked: on }} style={[styles.swatchRing, { borderColor: on ? cssColour(c.css) : "transparent" }]}>
                  <View style={[styles.swatch, { backgroundColor: cssColour(c.css) }]}>
                    {on ? <Ionicons name="checkmark" size={17} color="#fff" /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Field>
        <Field label="Hourly rate" help="Optional — used to estimate your pay." error={errors.hourly_rate} filled={filled.hourly_rate}>
          <View style={styles.money}>
            <Text style={{ color: t.text2, fontSize: 17, fontWeight: "600" }}>$</Text>
            <Input value={d.rate} onChangeText={(v) => { set("rate", v); mine("hourly_rate"); }} keyboardType="decimal-pad" placeholder="28.50" style={{ width: 120 }} testID="wp-rate" accessibilityLabel={tr("Hourly rate in dollars")} />
            <Text style={{ color: t.muted, fontSize: 15 }}>{tr("an hour")}</Text>
          </View>
        </Field>
        <Field label="Paid by" error={errors.paid_in}>
          <Segments<string>
            value={d.paidIn}
            onChange={(v) => set("paidIn", v as Workplace["paid_in"])}
            label={tr("Paid by")}
            options={[{ value: "BANK", label: tr("Bank"), icon: "card-outline" }, { value: "CASH", label: tr("Cash"), icon: "cash-outline" }]}
          />
        </Field>
        <Switch value={d.isDefault} onChange={(v) => set("isDefault", v)} label="My main workplace" />
      </Card>

      {/* Everything else: closed, each row saying what it is set to. One open at a time. */}
      <SectionLabel>More settings</SectionLabel>
      <Card pad={false}>
        <Disclosure icon="receipt-outline" title={tr("Pay & tax")} hint={paySummary} open={open === "pay"} onToggle={() => toggle("pay")} badge={flagged("pay")} testID="wp-section-pay">
          <View style={styles.body}>
            <Field label="Paid" error={errors.pay_cycle} filled={filled.pay_cycle}>
              <Select label="Paid" value={d.payCycle} onChange={(v) => { set("payCycle", v as Workplace["pay_cycle"]); mine("pay_cycle"); }} options={choices.pay_cycles.map((c) => ({ value: String(c.value), label: c.label }))} />
            </Field>
            {cash ? (
              <Text style={{ color: t.muted, fontSize: 13.5 }}>{tr("Cash in hand has no tax taken out, so your pay is shown as earned.")}</Text>
            ) : (
              <>
                {scales ? (
                  <Field label="Tax" help="As on this job's TFN declaration. Claim the tax-free threshold from one job only." error={errors.tax_scale} filled={filled.tax_scale}>
                    <Select label="Tax" value={d.scale} onChange={(v) => { set("scale", v); mine("tax_scale"); }} testID="tax-scale"
                      options={[{ value: "", label: "Not set — show pay before tax" }, ...scales.map((c) => ({ value: String(c.value), label: c.label }))]} />
                  </Field>
                ) : null}
                {scales && loanApplies ? <Switch value={d.loan} onChange={(v) => { set("loan", v); mine("study_loan"); }} label={filled.study_loan ? "I have a HELP or study loan (from payslip)" : "I have a HELP or study loan"} /> : null}
                {byPercentage ? (
                  <Field label="Tax taken out" help="Tax ÷ gross × 100, from a payslip." error={errors.tax_rate} filled={filled.tax_rate}>
                    <View style={styles.money}>
                      <Input value={d.tax} onChangeText={(v) => { set("tax", v); mine("tax_rate"); }} keyboardType="decimal-pad" placeholder="10.8" style={{ width: 100 }} accessibilityLabel={tr("Tax taken out, percent")} />
                      <Text style={{ color: t.text2, fontSize: 17, fontWeight: "600" }}>%</Text>
                    </View>
                  </Field>
                ) : null}
              </>
            )}
          </View>
        </Disclosure>

        <Disclosure icon="trending-up-outline" title={tr("Weekend & overtime")} hint={ratesSummary} open={open === "rates"} onToggle={() => toggle("rates")} badge={flagged("rates")} testID="wp-section-rates">
          <View style={styles.body}>
            <Text style={{ color: t.muted, fontSize: 13.5 }}>{tr("1 = normal rate · 1.5 = time and a half · 2 = double")}</Text>
            <View style={styles.grid}>
              <Multiplier label="Saturday" value={d.sat} onChange={(v) => { set("sat", v); mine("saturday_multiplier"); }} error={errors.saturday_multiplier} filled={filled.saturday_multiplier} />
              <Multiplier label="Sunday" value={d.sun} onChange={(v) => { set("sun", v); mine("sunday_multiplier"); }} error={errors.sunday_multiplier} filled={filled.sunday_multiplier} />
              <Multiplier label="Public holiday" value={d.holiday} onChange={(v) => { set("holiday", v); mine("public_holiday_multiplier"); }} error={errors.public_holiday_multiplier} filled={filled.public_holiday_multiplier} />
            </View>
            <View style={styles.grid}>
              <Field label="Overtime after" error={errors.overtime_after_hours}>
                <View style={styles.money}>
                  <Input value={d.overtimeAfter} onChangeText={(v) => set("overtimeAfter", v)} keyboardType="decimal-pad" placeholder="8" style={{ width: 72 }} accessibilityLabel={tr("Overtime after, hours in a shift")} />
                  <Text style={{ color: t.muted, fontSize: 15 }}>{tr("h a shift")}</Text>
                </View>
              </Field>
              <Multiplier label="Overtime rate" value={d.overtimeMult} onChange={(v) => { set("overtimeMult", v); mine("overtime_multiplier"); }} error={errors.overtime_multiplier} filled={filled.overtime_multiplier} />
            </View>
            {!d.rate.trim() ? <Text style={{ color: t.muted, fontSize: 13 }}>{tr("These need an hourly rate to change your pay estimate.")}</Text> : null}
          </View>
        </Disclosure>

        <Disclosure icon="hourglass-outline" title={tr("Hours limit")} hint={limitSummary} open={open === "limit"} onToggle={() => toggle("limit")} badge={flagged("limit")} testID="wp-section-limit">
          <View style={styles.body}>
            <Field label="Limit" help="For this workplace only. Leave blank for no limit." error={errors.hours_limit}>
              <View style={styles.money}>
                <Input value={d.limit} onChangeText={(v) => set("limit", v)} keyboardType="decimal-pad" placeholder="48" style={{ width: 90 }} accessibilityLabel={tr("Hours limit")} />
                <Text style={{ color: t.muted, fontSize: 15 }}>{tr("hours")}</Text>
              </View>
            </Field>
            {d.limit.trim() ? (
              <Segments<string>
                value={d.limitPeriod}
                onChange={(v) => { set("limitPeriod", v as Workplace["limit_period"]); mine("limit_period"); }}
                label={tr("Limit applies")}
                options={choices.limit_periods.map((c) => ({ value: String(c.value), label: c.label.replace(/^Per /, "") }))}
              />
            ) : null}
          </View>
        </Disclosure>

        <Disclosure icon="calendar-outline" title={tr("Week & month start")} hint={cyclesSummary} open={open === "cycles"} onToggle={() => toggle("cycles")} badge={flagged("cycles")} testID="wp-section-cycles">
          <View style={styles.body}>
            <Field label="Week starts on" error={errors.week_starts_on} filled={filled.week_starts_on}>
              <Select label="Week starts on" value={String(d.week)} onChange={(v) => { set("week", Number(v)); mine("week_starts_on"); }} options={choices.weekdays.map((x) => ({ value: String(x.value), label: x.label }))} />
            </Field>
            <Field label="Fortnight starts on" error={errors.fortnight_starts_on} filled={filled.fortnight_starts_on}>
              <Select label="Fortnight starts on" value={String(d.fortnight)} onChange={(v) => { set("fortnight", Number(v)); mine("fortnight_starts_on"); }} options={choices.weekdays.map((x) => ({ value: String(x.value), label: x.label }))} />
            </Field>
            <Field label="This fortnight began" help={w?.fortnight_hint || cycles.fortnight_hint} error={errors.fortnight_phase} filled={filled.fortnight_phase}>
              <Select label="This fortnight began" value={d.phase} onChange={(v) => { set("phase", v); mine("fortnight_phase"); }} options={choices.phases.map((p) => ({ value: String(p.value), label: p.label }))} />
            </Field>
            <Field label="Month starts on day" help={tr("The day your pay month opens (1–{max}).", { max: choices.max_month_start })} error={errors.month_starts_on} filled={filled.month_starts_on}>
              <Input value={d.month} onChangeText={(v) => { set("month", v); mine("month_starts_on"); }} keyboardType="number-pad" style={{ width: 80 }} />
            </Field>
          </View>
        </Disclosure>

        <Disclosure icon="location-outline" title={tr("Address")} hint={d.address.trim() || tr("Not added")} open={open === "address"} onToggle={() => toggle("address")} badge={flagged("address")} last testID="wp-section-address">
          <View style={styles.body}>
            <Field label="Address" error={errors.address}>
              <Input value={d.address} onChangeText={(v) => set("address", v)} placeholder="Street, suburb" textContentType="fullStreetAddress" />
            </Field>
          </View>
        </Disclosure>
      </Card>

      <View style={{ gap: sp[3] }}>
        <Button title={w ? "Save changes" : "Add workplace"} onPress={save} busy={busy} disabled={!restored} testID="save-workplace" />
        <Button title="Cancel" kind="plain" onPress={onCancel} />
      </View>
    </>
  );
}

/** A rate multiplier: the number with its × after it. */
function Multiplier({ label, value, onChange, error, filled }: { label: string; value: string; onChange: (value: string) => void; error?: string; filled?: boolean }) {
  const t = useTheme(), tr = useT();
  return (
    <Field label={label} error={error} filled={filled}>
      <View style={styles.money}>
        <Input value={value} onChangeText={onChange} keyboardType="decimal-pad" style={{ width: 72 }} accessibilityLabel={tr("{label}, times the normal rate", { label: tr(label) })} />
        <Text style={{ color: t.text2, fontSize: 17, fontWeight: "600" }}>×</Text>
      </View>
    </Field>
  );
}

const styles = StyleSheet.create({
  payslip: { minHeight: 52, borderRadius: radius.lg, paddingHorizontal: sp[4], flexDirection: "row", alignItems: "center", gap: sp[3] },
  read: { padding: sp[3], borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  swatchRing: { padding: 2.5, borderRadius: 21, borderWidth: 2 },
  swatch: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  money: { flexDirection: "row", alignItems: "center", gap: 8 },
  body: { gap: sp[4] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: sp[4] },
});
