import AsyncStorage from "@react-native-async-storage/async-storage";
import { timesheet, type ShiftInput } from "@/api";
import { ApiError } from "@/api/client";
import { queueShift, syncShifts, type PendingShift } from "@/offline/shifts";
import { queueClockAction, syncClockActions, type PendingClockAction } from "@/offline/clock";
import { readPrivate } from "@/storage/private";
jest.mock("@/api", () => ({ timesheet: { addShift: jest.fn(), clockIn: jest.fn(), startBreak: jest.fn(), endBreak: jest.fn(), clockOut: jest.fn() } }));
jest.mock("@/auth/session", () => ({ useSession: jest.fn() }));
jest.mock("@/api/server", () => ({ serverUrl: () => "https://test.example" }));
const scope = "test|alice";
const input: ShiftInput = { client_id: "a-test-submission", workplace: 1, clock_in: "2026-01-13T09:00", clock_out: "2026-01-13T17:00", note: "Draft", breaks: [] };
const pending = () => readPrivate<PendingShift[]>(scope, "pending-shifts", []);
const pendingClock = () => readPrivate<PendingClockAction[]>(scope, "pending-clock-actions-v1", []);
beforeEach(async () => { jest.clearAllMocks(); await AsyncStorage.clear(); });
test("a transport failure retains one durable draft and retry sends its original identifier", async () => {
  await Promise.all([queueShift(scope, input), queueShift(scope, input)]);
  expect(await pending()).toHaveLength(1);
  jest.mocked(timesheet.addShift).mockRejectedValueOnce(new ApiError(0, "No connection"));
  await syncShifts(scope, () => true);
  expect(await pending()).toHaveLength(1);
  jest.mocked(timesheet.addShift).mockResolvedValueOnce({ id: 7 } as any);
  await syncShifts(scope, () => true);
  expect(timesheet.addShift).toHaveBeenLastCalledWith(input);
  expect(await pending()).toEqual([]);
});
test("a server conflict remains for review and is never repeatedly submitted", async () => {
  await queueShift(scope, input);
  jest.mocked(timesheet.addShift).mockRejectedValueOnce(new ApiError(409, "Review this shift"));
  await syncShifts(scope, () => true);
  expect((await pending())[0]).toMatchObject({ review: true, error: "Review this shift" });
  await syncShifts(scope, () => true);
  expect(timesheet.addShift).toHaveBeenCalledTimes(1);
});
test("leaving an account prevents the next queued submission", async () => {
  await queueShift(scope, input);
  await queueShift(scope, { ...input, client_id: "second" });
  let active = true;
  jest.mocked(timesheet.addShift).mockImplementationOnce(async () => { active = false; return { id: 1 } as any; });
  await syncShifts(scope, () => active);
  expect(timesheet.addShift).toHaveBeenCalledTimes(1);
  expect((await pending()).map(row => row.id)).toEqual(["second"]);
});

test("a refused clock action stops every dependent action behind it", async () => {
  const now = new Date().toISOString();
  await queueClockAction(scope, { action: "clock_in", workplace: 1, client_id: "clock-in", client_time: now, client_tz: "Australia/Darwin" });
  await queueClockAction(scope, { action: "start_break", client_id: "break", client_time: now, client_tz: "Australia/Darwin" });
  jest.mocked(timesheet.clockIn).mockRejectedValueOnce(new ApiError(409, "Review the clock-in"));

  await syncClockActions(scope, () => true);

  expect(timesheet.clockIn).toHaveBeenCalledTimes(1);
  expect(timesheet.startBreak).not.toHaveBeenCalled();
  const queued = await pendingClock();
  expect(queued[0]).toMatchObject({ client_id: "clock-in", review: true });
  expect(queued[1]).toMatchObject({ client_id: "break" });
  expect(queued[1].review).toBeUndefined();
});

test("an old clock sequence is kept for manual review instead of changing its time", async () => {
  await queueClockAction(scope, { action: "clock_in", workplace: 1, client_id: "old", client_time: "2020-01-01T09:00:00+09:30", client_tz: "Australia/Darwin" });

  await syncClockActions(scope, () => true);

  expect(timesheet.clockIn).not.toHaveBeenCalled();
  expect((await pendingClock())[0]).toMatchObject({ client_id: "old", review: true, error: expect.stringContaining("24 hours") });
});
