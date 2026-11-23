import { afterEach, expect, test, vi } from "vitest";
import { fetchSkills, slashQuery, splitSkill } from "./skillsApi";

afterEach(() => vi.unstubAllGlobals());

const skills = [
  { name: "present", description: "Make slides.", tools: ["write_report"] },
  { name: "quiz-me", description: "Quiz.", tools: [] },
];

test("fetchSkills gives the list, and nothing when the server fails or answers badly", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => skills }));
  expect(await fetchSkills()).toEqual(skills);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  expect(await fetchSkills()).toEqual([]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  expect(await fetchSkills()).toEqual([]);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
  expect(await fetchSkills()).toEqual([]);
});

test("slashQuery is the word being typed after a leading slash, nothing otherwise", () => {
  expect(slashQuery("/")).toBe("");
  expect(slashQuery("/pre")).toBe("pre");
  expect(slashQuery("/present ")).toBeNull();
  expect(slashQuery("hello /pre")).toBeNull();
  expect(slashQuery("")).toBeNull();
});

test("splitSkill separates a known /name from the rest, and ignores unknown ones", () => {
  expect(splitSkill("/present about the model", skills)).toEqual({
    skill: "present",
    text: "about the model",
  });
  expect(splitSkill("/present", skills)).toEqual({ skill: "present", text: "/present" });
  expect(splitSkill("/nope text", skills)).toBeNull();
  expect(splitSkill("hello /present", skills)).toBeNull();
  expect(splitSkill("/present\nmulti\nline", skills)?.text).toBe("multi\nline");
});
