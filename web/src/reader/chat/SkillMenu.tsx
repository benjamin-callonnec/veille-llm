import type { SkillInfo } from "./skillsApi";

interface Props {
  skills: SkillInfo[];
  /** What is typed after the slash: its first letters are shown in bold in every name. */
  query?: string;
  /** The highlighted row (the composer moves it with the arrows). */
  active: number;
  onPick(name: string): void;
}

/**
 * The skills behind the slash: a quiet list of names, and next to it a small card with what the
 * highlighted one is for and the tools it brings. Read only.
 */
export function SkillMenu({ skills, query = "", active, onPick }: Props) {
  const current = skills[active];
  return (
    <div className="skill-pop">
      <div className="skill-menu" role="listbox" aria-label="Skills">
        {skills.map((s, i) => (
          <div
            key={s.name}
            role="option"
            tabIndex={-1}
            aria-selected={i === active}
            className={i === active ? "active" : undefined}
            // mousedown, not click: the textarea must keep the focus
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(s.name);
            }}
          >
            <b>{s.name.slice(0, query.length)}</b>
            {s.name.slice(query.length)}
          </div>
        ))}
      </div>
      {current && (
        <aside className="skill-detail" aria-label="About the highlighted skill">
          <p>{current.description}</p>
          {current.tools.length > 0 && <small>{current.tools.join(", ")}</small>}
        </aside>
      )}
    </div>
  );
}
