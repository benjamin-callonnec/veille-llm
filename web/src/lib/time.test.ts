import { describe, expect, test } from "vitest";
import { formatDay, formatModel, timeAgo } from "./time";

const NOW = Date.parse("2026-11-22T12:00:00Z");

describe("formatDay", () => {
  test("short month and day", () => {
    expect(formatDay("2026-11-11T09:30:00Z")).toBe("Nov 11");
  });
  test("nothing for a missing or invalid date", () => {
    expect(formatDay("")).toBe("");
    expect(formatDay("not a date")).toBe("");
  });
});

describe("timeAgo", () => {
  test.each([
    ["2026-11-22T11:59:40Z", "now"],
    ["2026-11-22T11:55:00Z", "5 minutes ago"],
    ["2026-11-22T09:00:00Z", "3 hours ago"],
    ["2026-11-21T11:00:00Z", "yesterday"],
    ["2026-11-08T12:00:00Z", "2 weeks ago"],
    ["2026-08-22T12:00:00Z", "3 months ago"],
  ])("%s reads %s", (iso, expected) => {
    expect(timeAgo(iso, NOW)).toBe(expected);
  });
  test("nothing for a missing or invalid date, and a future date reads now", () => {
    expect(timeAgo("", NOW)).toBe("");
    expect(timeAgo("nope", NOW)).toBe("");
    expect(timeAgo("2026-11-23T12:00:00Z", NOW)).toBe("now");
  });
});

describe("formatModel", () => {
  test.each([
    ["claude-sonnet-5-5", "Sonnet 5.5"],
    ["claude-haiku-5-5", "Haiku 5.5"],
    ["claude-opus-4-1", "Opus 4.1"],
  ])("%s reads %s", (id, label) => {
    expect(formatModel(id)).toBe(label);
  });
  test("an unknown id is shown as it is, nothing for none", () => {
    expect(formatModel("some-model")).toBe("some-model");
    expect(formatModel(undefined)).toBe("");
  });
});
