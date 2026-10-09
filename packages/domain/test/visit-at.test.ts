import { describe, expect, it } from "vitest";
import { requestedTime } from "../src/situations";

describe("requested visit time", () => {
  it("gives the full India date and time for Zoho", () => {
    // Saturday 10 October 2026, 12:43 AM in India.
    const now = new Date("2026-10-09T19:13:00Z");
    expect(requestedTime("Tuesday 4 pm", now, "Tuesday to Sunday, 10 AM to 7 PM")?.at).toBe("2026-10-13T16:00:00+05:30");
    expect(requestedTime("tomorrow 11 am", now, "Tuesday to Sunday, 10 AM to 7 PM")?.at).toBe("2026-10-11T11:00:00+05:30");
  });
});
