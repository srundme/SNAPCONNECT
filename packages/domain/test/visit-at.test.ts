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

describe("number abroad", () => {
  it("names the country and the time there, and nothing for an Indian number", async () => {
    const { numberAbroad } = await import("../src/parse");
    const now = new Date("2026-10-10T05:30:00Z");
    expect(numberAbroad("+447400123456", now)).toEqual({ country: "United Kingdom", localTime: expect.stringMatching(/6:30 am/i) });
    expect(numberAbroad("+12125551234", now)?.country).toBe("United States");
    expect(numberAbroad("+12125551234", now)?.localTime).toBeNull();
    expect(numberAbroad("+919845012345", now)).toBeNull();
  });
});

describe("dates and 24-hour times", () => {
  // Saturday 10 October 2026, 4:22 PM in India.
  const now = new Date("2026-10-10T10:52:00Z");
  const hours = "Tuesday to Sunday, 10 AM to 7 PM";
  it("reads an exact date with a 24-hour time", () => {
    expect(requestedTime("Yes on 16 oct 2026 @13:00", now, hours)?.at).toBe("2026-10-16T13:00:00+05:30");
    expect(requestedTime("Oct 18 at 3:30", now, hours)?.at).toBe("2026-10-18T15:30:00+05:30");
    expect(requestedTime("16/10 11 am", now, hours)?.at).toBe("2026-10-16T11:00:00+05:30");
  });
  it("leaves a date that has passed for the reply to point out", () => {
    expect(requestedTime("Yes on 6 oct 2026 @13:00", now, hours)).toBeNull();
  });
});
