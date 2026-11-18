import { chat } from "@/api";
import { api } from "@/api/client";

jest.mock("@/api/client", () => ({
  api: jest.fn(),
  apiUrl: jest.fn(),
  formWith: jest.fn((fields: unknown) => fields),
}));

beforeEach(() => { jest.clearAllMocks(); });

test("message retry identity and replies reach the direct-message endpoint", async () => {
  jest.mocked(api).mockResolvedValue({ id: 1 } as never);
  await chat.send("sam", "Cover Saturday?", "132f62cd-5e34-4dd0-9152-8ac2811853cc", 7);
  expect(api).toHaveBeenCalledWith("messages/sam/", {
    method: "POST",
    body: { body: "Cover Saturday?", client_id: "132f62cd-5e34-4dd0-9152-8ac2811853cc", reply_to: 7 },
  });
});

test("inbox settings use a stable conversation id", async () => {
  jest.mocked(api).mockResolvedValue({} as never);
  await chat.settings("466892ea-2178-4fe3-94b8-e5d0b689ced0", { muted: true, pinned: true });
  expect(api).toHaveBeenCalledWith(
    "messages/conversations/466892ea-2178-4fe3-94b8-e5d0b689ced0/settings/",
    { method: "PATCH", body: { muted: true, pinned: true } },
  );
});
