import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { SkillMenu } from "./SkillMenu";

afterEach(cleanup);

const skills = [
  { name: "present", description: "Make slides.", tools: ["write_report"] },
  { name: "quiz-me", description: "Quiz.", tools: [] },
];

test("lists every skill with its description and tools, the active one selected", () => {
  render(<SkillMenu skills={skills} active={1} onPick={() => {}} />);
  const options = screen.getAllByRole("option");
  expect(options).toHaveLength(2);
  expect(options[0]?.textContent).toContain("/present");
  expect(options[0]?.textContent).toContain("Make slides.");
  expect(options[0]?.textContent).toContain("write_report");
  expect(options[1]?.getAttribute("aria-selected")).toBe("true");
});

test("clicking a skill picks it without taking the focus from the composer", async () => {
  const onPick = vi.fn();
  render(<SkillMenu skills={skills} active={0} onPick={onPick} />);
  await userEvent.click(screen.getByRole("option", { name: /quiz-me/ }));
  expect(onPick).toHaveBeenCalledWith("quiz-me");
});
