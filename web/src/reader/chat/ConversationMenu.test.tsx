import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { Conversation } from "./api";
import { ConversationMenu } from "./ConversationMenu";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const conv = (id: number, title: string): Conversation => ({
  id,
  item_id: "a",
  title,
  created_at: "",
  updated_at: "",
});

const setup = (over: Partial<Parameters<typeof ConversationMenu>[0]> = {}) => {
  const h = { onSelect: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onExport: vi.fn() };
  render(
    <ConversationMenu
      conversations={[conv(2, "Second"), conv(1, "<i>First</i>")]}
      currentId={2}
      {...h}
      {...over}
    />,
  );
  return h;
};

const trigger = () => screen.getByRole("button", { name: "Conversations" });

test("the trigger is only an icon, and nothing is listed until it is opened", () => {
  setup();
  expect(trigger().textContent).toBe("");
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("Second")).toBeNull();
});

test("opened, it lists the conversations as text with the current one marked", async () => {
  setup();
  await userEvent.click(trigger());
  expect(screen.getByText("<i>First</i>")).toBeTruthy();
  expect(document.querySelector("i")).toBeNull();
  expect(screen.getByRole("button", { name: "Second" }).getAttribute("aria-current")).toBe("true");
  expect(
    screen.getByRole("button", { name: "<i>First</i>" }).getAttribute("aria-current"),
  ).toBeNull();
});

test("each conversation has icon actions with a name and a tooltip, no text buttons", async () => {
  setup();
  await userEvent.click(trigger());
  for (const label of ["Rename Second", "Export Second", "Delete Second"]) {
    const button = screen.getByRole("button", { name: label });
    expect(button.textContent).toBe("");
    expect(button.getAttribute("title")).toBe(label);
  }
  expect(screen.queryByRole("button", { name: /^New conversation$/ })).toBeNull();
});

test("select, rename, delete (confirmed) and export, each closing the menu", async () => {
  const h = setup();
  await userEvent.click(trigger());
  await userEvent.click(screen.getByRole("button", { name: "<i>First</i>" }));
  expect(h.onSelect).toHaveBeenCalledWith(1);
  expect(screen.queryByText("Second")).toBeNull();

  vi.spyOn(window, "prompt").mockReturnValue("Renamed");
  await userEvent.click(trigger());
  await userEvent.click(screen.getByRole("button", { name: "Rename Second" }));
  expect(h.onRename).toHaveBeenCalledWith(2, "Renamed");

  vi.spyOn(window, "confirm").mockReturnValue(true);
  await userEvent.click(trigger());
  await userEvent.click(screen.getByRole("button", { name: "Delete Second" }));
  expect(h.onDelete).toHaveBeenCalledWith(2);

  await userEvent.click(trigger());
  await userEvent.click(screen.getByRole("button", { name: "Export Second" }));
  expect(h.onExport).toHaveBeenCalledWith(2);
});

test("a cancelled confirmation or an empty rename changes nothing", async () => {
  const h = setup();
  vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.spyOn(window, "prompt").mockReturnValue("   ");
  await userEvent.click(trigger());
  await userEvent.click(screen.getByRole("button", { name: "Delete Second" }));
  await userEvent.click(trigger());
  await userEvent.click(screen.getByRole("button", { name: "Rename Second" }));
  expect(h.onDelete).not.toHaveBeenCalled();
  expect(h.onRename).not.toHaveBeenCalled();
});

test("Escape closes it", async () => {
  setup();
  await userEvent.click(trigger());
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByText("Second")).toBeNull();
});

test("it is disabled while an answer streams, and absent when there is nothing to list", () => {
  setup({ disabled: true });
  expect((trigger() as HTMLButtonElement).disabled).toBe(true);
  cleanup();
  const { container } = render(
    <ConversationMenu
      conversations={[]}
      currentId={null}
      onSelect={() => {}}
      onRename={() => {}}
      onDelete={() => {}}
      onExport={() => {}}
    />,
  );
  expect(container.textContent).toBe("");
  expect(screen.queryByRole("button", { name: "Conversations" })).toBeNull();
});
