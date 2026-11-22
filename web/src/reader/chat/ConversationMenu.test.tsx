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
  const h = {
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onExport: vi.fn(),
  };
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

test("shows the current title and lists conversations as text when opened", async () => {
  setup();
  expect(screen.queryByText("<i>First</i>")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /Second/ }));
  expect(screen.getByText("<i>First</i>")).toBeTruthy();
  expect(document.querySelector("i")).toBeNull();
});

test("select, new, rename, delete (confirmed) and export", async () => {
  const h = setup();
  await userEvent.click(screen.getByRole("button", { name: /Second/ }));
  await userEvent.click(screen.getByRole("button", { name: "<i>First</i>" }));
  expect(h.onSelect).toHaveBeenCalledWith(1);

  await userEvent.click(screen.getByRole("button", { name: /Second/ }));
  await userEvent.click(screen.getByRole("button", { name: "New conversation" }));
  expect(h.onCreate).toHaveBeenCalled();

  vi.spyOn(window, "prompt").mockReturnValue("Renamed");
  await userEvent.click(screen.getByRole("button", { name: /Second/ }));
  await userEvent.click(screen.getByRole("button", { name: "Rename Second" }));
  expect(h.onRename).toHaveBeenCalledWith(2, "Renamed");

  vi.spyOn(window, "confirm").mockReturnValue(true);
  await userEvent.click(screen.getByRole("button", { name: /Second/ }));
  await userEvent.click(screen.getByRole("button", { name: "Delete Second" }));
  expect(h.onDelete).toHaveBeenCalledWith(2);

  await userEvent.click(screen.getByRole("button", { name: /Second/ }));
  await userEvent.click(screen.getByRole("button", { name: "Export Second" }));
  expect(h.onExport).toHaveBeenCalledWith(2);
});

test("a cancelled confirmation or an empty rename changes nothing", async () => {
  const h = setup();
  vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.spyOn(window, "prompt").mockReturnValue("   ");
  await userEvent.click(screen.getByRole("button", { name: /Second/ }));
  await userEvent.click(screen.getByRole("button", { name: "Delete Second" }));
  await userEvent.click(screen.getByRole("button", { name: /Second/ }));
  await userEvent.click(screen.getByRole("button", { name: "Rename Second" }));
  expect(h.onDelete).not.toHaveBeenCalled();
  expect(h.onRename).not.toHaveBeenCalled();
});

test("with no conversation yet it offers a new one", async () => {
  const h = setup({ conversations: [], currentId: null });
  await userEvent.click(screen.getByRole("button", { name: /New conversation/ }));
  expect(h.onCreate).toHaveBeenCalled();
});
