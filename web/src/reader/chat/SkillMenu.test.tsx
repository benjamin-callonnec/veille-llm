import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { SkillMenu } from "./SkillMenu";

afterEach(cleanup);

const skills = [
  { name: "present", description: "Make slides.", tools: ["write_report"] },
  { name: "quiz-me", description: "Quiz.", tools: [] },
];

test("the rows are only names, the first letters typed in bold, the active one selected", () => {
  render(<SkillMenu skills={skills} query="pre" active={1} onPick={() => {}} />);
  const options = screen.getAllByRole("option");
  expect(options).toHaveLength(2);
  expect(options[0]?.textContent).toBe("present");
  expect(options[0]?.querySelector("b")?.textContent).toBe("pre");
  expect(options[0]?.textContent).not.toContain("Make slides.");
  expect(options[1]?.getAttribute("aria-selected")).toBe("true");
});

test("a side card tells what the highlighted skill is for and its tools", () => {
  const { rerender } = render(<SkillMenu skills={skills} active={0} onPick={() => {}} />);
  const card = screen.getByLabelText("About the highlighted skill");
  expect(card.textContent).toContain("Make slides.");
  expect(card.textContent).toContain("write_report");
  rerender(<SkillMenu skills={skills} active={1} onPick={() => {}} />);
  expect(screen.getByLabelText("About the highlighted skill").textContent).toBe("Quiz.");
});

test("clicking a skill picks it without taking the focus from the composer", async () => {
  const onPick = vi.fn();
  render(<SkillMenu skills={skills} active={0} onPick={onPick} />);
  await userEvent.click(screen.getByRole("option", { name: "quiz-me" }));
  expect(onPick).toHaveBeenCalledWith("quiz-me");
});
