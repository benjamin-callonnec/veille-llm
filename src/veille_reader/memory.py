"""The session memory of the tutor: short notes per paper, visible and editable by the user."""

from veille_reader.storage import ReaderStore
from veille_reader.tools import ToolError

MAX_NOTES = 30


class StoreMemory:
    """The `Memory` of one paper, backed by the reader database (what the tutor's tool uses)."""

    def __init__(self, store: ReaderStore, item_id: str) -> None:
        self.store = store
        self.item_id = item_id

    def read(self) -> list[dict]:
        return self.store.memory_notes(self.item_id)

    def write(self, text: str) -> dict:
        if len(self.store.memory_notes(self.item_id)) >= MAX_NOTES:
            raise ToolError(f"The memory is full ({MAX_NOTES} notes): delete a note first.")
        return self.store.add_memory_note(self.item_id, text)

    def delete(self, note_id: int) -> bool:
        return self.store.delete_memory_note(self.item_id, note_id)
