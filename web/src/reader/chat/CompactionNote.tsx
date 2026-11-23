import { useState } from "react";
import { Icon } from "../../components/Icon";

/** "Earlier messages were summarised": click to read the summary the tutor works from. */
export function CompactionNote({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="compaction">
      <button
        type="button"
        className="compaction-note compaction-toggle"
        aria-expanded={open}
        title="Show the summary"
        onClick={() => setOpen(!open)}
      >
        Earlier messages were summarised to keep the conversation light.
        <span className="chevron">
          <Icon name="chevron" size={12} />
        </span>
      </button>
      {open && <p className="compaction-summary">{summary || "No summary was kept."}</p>}
    </div>
  );
}
