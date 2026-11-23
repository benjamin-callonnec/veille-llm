import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, IconButton } from "../../components/Icon";
import { MAX_NOTE, MAX_NOTES, type Note, type SessionApi, SessionApiError } from "./sessionApi";

const who = (source: string) => (source === "tutor" ? "Written by the tutor" : "Written by you");

/** What the tutor keeps in mind about this paper: see, edit, delete, add. Shows who wrote each. */
export function MemoryPanel({
  itemId,
  api,
  version = 0,
}: {
  itemId: string;
  api: SessionApi;
  /** Changes when the tutor may have written (a turn ended): the list is read again. */
  version?: number;
}) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [draft, setDraft] = useState("");

  const latest = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` only forces a new read
  const load = useCallback(async () => {
    const mine = ++latest.current; // only the newest read may apply its answer
    try {
      const read = await api.notes(itemId);
      if (mine !== latest.current) return;
      setNotes(read);
      setFailure(null);
    } catch {
      if (mine === latest.current) setFailure("The notes could not be loaded.");
    }
  }, [api, itemId, version]);
  useEffect(() => {
    void load();
  }, [load]);

  async function attempt(fn: () => Promise<void>) {
    setFailure(null);
    try {
      await fn();
    } catch (e) {
      setFailure(
        e instanceof SessionApiError && e.reason === "memory_full"
          ? `The memory is full (${MAX_NOTES} notes): delete one first.`
          : "That did not work. Try again.",
      );
    }
  }

  const add = () =>
    attempt(async () => {
      const made = await api.addNote(itemId, draft.trim());
      setNotes((n) => [...(n ?? []), made]);
      setDraft("");
    });
  const save = () =>
    editing &&
    attempt(async () => {
      const saved = await api.editNote(itemId, editing.id, editing.text.trim());
      setNotes((n) => (n ?? []).map((x) => (x.id === saved.id ? saved : x)));
      setEditing(null);
    });
  const remove = (id: number) =>
    attempt(async () => {
      await api.deleteNote(itemId, id);
      setNotes((n) => (n ?? []).filter((x) => x.id !== id));
    });

  return (
    <section className="chat-panel" aria-label="Session memory">
      <p className="panel-title">
        Notes kept for this paper{notes ? ` (${notes.length}/${MAX_NOTES})` : ""}
      </p>
      {notes?.length === 0 && <p className="muted panel-empty">No notes yet.</p>}
      <ul className="notes">
        {(notes ?? []).map((note) => (
          <li key={note.id} className="note">
            <span className="note-who" title={who(note.source)}>
              <Icon name={note.source === "tutor" ? "sparkle" : "person"} size={14} />
              <span className="sr-only">{who(note.source)}</span>
            </span>
            {editing?.id === note.id ? (
              <>
                <textarea
                  className="note-edit"
                  aria-label="Edit note"
                  ref={(el) => el?.focus()}
                  maxLength={MAX_NOTE}
                  rows={2}
                  value={editing.text}
                  onChange={(e) => setEditing({ id: note.id, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setEditing(null);
                    }
                  }}
                />
                <IconButton
                  icon="check"
                  label="Save note"
                  disabled={!editing.text.trim()}
                  onClick={() => void save()}
                />
                <IconButton icon="close" label="Cancel" onClick={() => setEditing(null)} />
              </>
            ) : (
              <>
                <span className="note-text">{note.text}</span>
                <IconButton
                  icon="edit"
                  label="Edit note"
                  onClick={() => setEditing({ id: note.id, text: note.text })}
                />
                <IconButton icon="trash" label="Delete note" onClick={() => void remove(note.id)} />
              </>
            )}
          </li>
        ))}
      </ul>
      {failure && (
        <p role="alert" className="chat-error panel-note">
          {failure}
        </p>
      )}
      <div className="note-add">
        <input
          className="ask-input"
          type="text"
          aria-label="New note"
          placeholder="Add a note"
          maxLength={MAX_NOTE}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && draft.trim()) {
              e.preventDefault();
              void add();
            }
          }}
        />
        <IconButton
          icon="plus"
          label="Add note"
          disabled={!draft.trim()}
          onClick={() => void add()}
        />
      </div>
    </section>
  );
}
