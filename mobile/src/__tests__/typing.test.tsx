import React from "react";
import { act, render } from "@testing-library/react-native";
import { Text } from "react-native";

import { TypingBubble, TYPING_FOR_MS, useTyping } from "@/chat/Typing";

let mockEmit: (event: any) => void = () => {};
jest.mock("@/chat/realtime", () => ({
  onChatEvent: (listener: (event: any) => void) => { mockEmit = listener; return () => {}; },
}));
jest.mock("@/ui", () => ({ Avatar: () => null }));

function Probe() {
  const typing = useTyping();
  return <Text testID="probe">{JSON.stringify(typing)}</Text>;
}
const shown = (screen: any) => JSON.parse(screen.getByTestId("probe").props.children);

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("a typing event shows who is typing in that conversation", async () => {
  const screen = await render(<Probe />);
  await act(async () => mockEmit({ type: "typing", conversation_id: "c1", username: "noah", name: "Noah Patel" }));
  expect(shown(screen)).toEqual({ c1: [{ username: "noah", name: "Noah Patel" }] });
});

test("the dots go when their message lands", async () => {
  const screen = await render(<Probe />);
  await act(async () => mockEmit({ type: "typing", conversation_id: "c1", username: "noah", name: "Noah" }));
  await act(async () => mockEmit({ type: "message.created", conversation_id: "c1", message_id: 9 }));
  expect(shown(screen)).toEqual({});
});

test("the dots go a few seconds after they stop typing", async () => {
  const screen = await render(<Probe />);
  await act(async () => mockEmit({ type: "typing", conversation_id: "c1", username: "noah", name: "Noah" }));
  await act(async () => { jest.advanceTimersByTime(TYPING_FOR_MS - 1000); });
  expect(shown(screen).c1).toHaveLength(1);
  await act(async () => { jest.advanceTimersByTime(1500); });
  expect(shown(screen)).toEqual({});
});

test("the bubble names who is typing for screen readers", async () => {
  const one = await render(<TypingBubble names={["Noah"]} people={[{ initial: "N", hue: 1, photo: null, is_live: false }]} />);
  expect(one.getByLabelText("Noah is typing…")).toBeTruthy();
  const two = await render(<TypingBubble names={["Noah", "Sofia"]} people={[]} />);
  expect(two.getByLabelText("2 people are typing…")).toBeTruthy();
});
