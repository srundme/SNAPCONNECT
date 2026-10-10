import { describe, expect, it } from "vitest";
import {
  askingPrice,
  deterministicIntent,
  requestedTime,
} from "../src/index";

// Wednesday 8 Oct 2026, 2:00 PM IST.
const wednesdayAfternoon = new Date("2026-10-08T08:30:00Z");
const hours = "Tuesday to Sunday, 10 AM to 7 PM, Monday closed";

describe("messages from live testing on 8 Oct", () => {

  it("puts a named weekday on that day, not today", () => {
    const time = requestedTime("Saturday 11 am", wednesdayAfternoon, hours);
    expect(time?.day).toBe("Saturday");
    expect(time?.inside).toBe(true);
    expect(requestedTime("Monday 11 am", wednesdayAfternoon, hours)?.inside).toBe(false);
  });

  it("keeps the earlier fixes", () => {
    expect(askingPrice("how much time will it take for a 4 BHK villa")).toBe(false);
    expect(deterministicIntent("my flat is near the bus stop").optOut).toBe(false);
  });
});

describe("prices are never told to customers", () => {
  it("keeps price lines out of the knowledge base the model sees", async () => {
    const { withoutPrices } = await import("../src/index");
    const kb = "3. STARTING PRICES (published on the website)\n- 3 BHK: starting from ₹35 lakh.\n- Luxury villas: ₹50 lakh and above.\nFounded in 2009.\nExperience centre open Tuesday to Sunday.";
    expect(withoutPrices(kb)).toBe("Founded in 2009.\nExperience centre open Tuesday to Sunday.");
  });
});

describe("the home question needs a BHK count", () => {
  it("is not answered by a home type alone", async () => {
    const { screenLead } = await import("../src/index");
    const questions = [{ id: "kind", kind: "text" as const, label: "What kind of home is it: apartment, villa or independent house, and how many BHK?", required: true, zohoField: null }];
    expect(screenLead({ questions, answers: { kind: "Villa" }, name: "Gopi", phoneE164: "+919999999999" }).ready).toBe(false);
    expect(screenLead({ questions, answers: { kind: "4 BHK Villa" }, name: "Gopi", phoneE164: "+919999999999" }).ready).toBe(true);
    expect(screenLead({ questions, answers: { kind: "5 bedroom villa" }, name: "Gopi", phoneE164: "+919999999999" }).ready).toBe(true);
  });
});

describe("names from the profile", () => {
  it("reads a person's name from a profile name or handle, not a brand", async () => {
    const { profilePersonName } = await import("../src/index");
    expect(profilePersonName(null, "riteesh.shetty_93")).toBe("Riteesh Shetty");
    expect(profilePersonName(null, "gopi.talks")).toBe("Gopi");
    expect(profilePersonName(null, "priya_vlogs")).toBe("Priya");
    expect(profilePersonName("Priya Nair", "pn_1990")).toBe("Priya Nair");
    expect(profilePersonName(null, "karighars_interiors")).toBeNull();
    expect(profilePersonName(null, "xx_99_xx")).toBeNull();
    expect(profilePersonName("Tech World Official", null)).toBeNull();
  });
});

describe("a builder is not a property", () => {
  it("spots a builder named without the property", async () => {
    const { builderOnly } = await import("../src/index");
    expect(builderOnly("Puravankara")).toBe("Puravankara");
    expect(builderOnly("Puravankara at banglore")).toBe("Puravankara");
    expect(builderOnly("it's a Prestige flat")).toBe("Prestige");
    expect(builderOnly("Prestige Lakeside Habitat")).toBeNull();
    expect(builderOnly("Purva Atmosphere, Thanisandra")).toBeNull();
    expect(builderOnly("Sobha, Whitefield")).toBeNull();
    expect(builderOnly("Concorde Manhattans")).toBeNull();
  });
});

describe("email checks", () => {
  it("spots fake, throwaway, mistyped and keyboard-mashed emails", async () => {
    const { emailProblem } = await import("../src/index");
    expect(emailProblem("hfjdfnjknjk@gmail.com")).toEqual({ kind: "gibberish" });
    expect(emailProblem("Adc@abc.com")).toEqual({ kind: "placeholder" });
    expect(emailProblem("test@gmail.com")).toEqual({ kind: "placeholder" });
    expect(emailProblem("ravi@mailinator.com")).toEqual({ kind: "disposable" });
    expect(emailProblem("karthik@gmial.com")).toEqual({ kind: "typo", suggestion: "karthik@gmail.com" });
    expect(emailProblem("karthik at gmail")).toEqual({ kind: "format" });
    expect(emailProblem("gopinwrk@gmail.com")).toBeNull();
    expect(emailProblem("karthikeyan@theaitel.com")).toBeNull();
    expect(emailProblem("srundme@gmail.com")).toBeNull();
    expect(emailProblem("priya.nair92@yahoo.com")).toBeNull();
  });
});

describe("proof from completed homes", () => {
  it("matches only the same property", async () => {
    const { parseCompletedProjects, completedInProperty } = await import("../src/index");
    const done = parseCompletedProjects("Adarsh Palm Retreat | Bellandur | 4 BHK villa | https://www.thekarighars.com/apr\nPrestige Lakeside Habitat | Varthur | 3 BHK apartment |");
    expect(completedInProperty("Adarsh Palm Retreat, Bellandur, Bengaluru", done)?.link).toBe("https://www.thekarighars.com/apr");
    expect(completedInProperty("prestige lakeside habitat", done)?.home).toBe("3 BHK apartment");
    expect(completedInProperty("Prestige Shantiniketan", done)).toBeNull();
    expect(completedInProperty("Bellandur", done)).toBeNull();
  });
});

describe("ready for Zoho", () => {
  it("sends once name, property, home, possession and phone are in, without waiting for email", async () => {
    const { zohoReady } = await import("../src/index");
    const questions = [
      { id: "name", kind: "name" as const, label: "May I know your name?", required: true, zohoField: null },
      { id: "where", kind: "text" as const, label: "Where is the home: which area, and what is the property name?", required: true, zohoField: null },
      { id: "home", kind: "text" as const, label: "What kind of home is it: apartment, villa or independent house, and how many BHK?", required: true, zohoField: null },
      { id: "when", kind: "text" as const, label: "When do you get possession, or is the home already ready?", required: true, zohoField: null },
      { id: "phone", kind: "phone" as const, label: "Which number should the team call you on?", required: true, zohoField: "Phone" },
      { id: "email", kind: "text" as const, label: "Email for the team to share the details?", required: true, zohoField: "Email" },
    ];
    const answers = { where: "Concorde Manhattans, Electronic City", home: "4 BHK Apartment", when: "I have the keys now" };
    expect(zohoReady({ questions, answers, name: "Gopi N", phoneE164: null })).toBe(false);
    expect(zohoReady({ questions, answers, name: "Gopi N", phoneE164: "+919845011111" })).toBe(true);
  });
});

describe("an area is not a property", () => {
  it("spots an area without a property, and a builder misspelt", async () => {
    const { areaOnly, builderOnly } = await import("../src/index");
    expect(areaOnly("My apartment is in Electronic City Banglore")).toBe("Electronic City");
    expect(areaOnly("HSR Layout")).toBe("HSR Layout");
    expect(areaOnly("Whitefield")).toBe("Whitefield");
    expect(areaOnly("Sobha City")).toBeNull();
    expect(areaOnly("Prestige Falcon City")).toBeNull();
    expect(areaOnly("Concorde Manhattans")).toBeNull();
    expect(builderOnly("Concord project")).toBe("Concorde");
  });
});

describe("Gopi 9 Oct fixes", () => {
  it("reads pushing for a number as a question, not 'not now'", async () => {
    const { notNow } = await import("../src/situations");
    expect(notNow("Okay give a number based on the I will decide what to do")).toBe(false);
    expect(notNow("just looking for now")).toBe(true);
  });
  it("never rates a 3 BHK full home as junk on a typed area", async () => {
    const { rateLead } = await import("../src/rating");
    const questions = [
      { id: "home", kind: "text" as const, label: "What kind of home is it: apartment, villa or independent house, and how many BHK?", required: true, zohoField: null },
      { id: "area", kind: "text" as const, label: "Approximate carpet area in sq ft?", required: false, zohoField: null },
    ];
    expect(rateLead({ questions, answers: { home: "3 BHK Apartment", area: "1000 sq ft" }, hotBudgetLakhs: 30 }).rating).not.toBe("JUNK");
  });
});
