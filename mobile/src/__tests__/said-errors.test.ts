import { ApiError } from "@/api/client";
import { describeError, Said } from "@/api/errors";
import { TooBig } from "@/chat/pick";

describe("what people are shown when something fails", () => {
  it("shows the app's own sentences as written, and counts them as expected", () => {
    const shown = describeError(new Said("Allow photo access in Settings to send videos."));
    expect(shown.message).toBe("Allow photo access in Settings to send videos.");
    expect(shown.report.kind).toBe("validation");
    expect(describeError(new TooBig("Photos can be up to 10 MB.")).message).toBe("Photos can be up to 10 MB.");
  });

  it("never shows codes, addresses or native text", () => {
    expect(describeError(new ApiError(500, "The server hit an error (HTTP 500).")).message).toBe("Something went wrong on our side. Please try again.");
    expect(describeError(new ApiError(0, "Couldn't reach https://kaamkorecord.com (timed out).")).message).toBe("We couldn't connect. Check your internet and try again.");
    expect(describeError(new Error("FetchRequestCanceledException (at ExpoURLSessionTask.swift:56)")).message).toBe("Something went wrong. Please try again.");
  });

  it("passes the server's written refusal through", () => {
    expect(describeError(new ApiError(400, "That period was already paid.")).message).toBe("That period was already paid.");
  });
});
