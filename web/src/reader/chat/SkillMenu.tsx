import type { SkillInfo } from "./skillsApi";

interface Props {
  skills: SkillInfo[];
  /** The highlighted row (the composer moves it with the arrows). */
  active: number;
  onPick(name: string): void;
}

/** The skills behind the slash: name, what it is for, and the tools it brings. Read only. */
export function SkillMenu({ skills, active, onPick }: Props) {
  return (
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
          <strong>/{s.name}</strong>
          <span className="skill-desc">{s.description}</span>
          {s.tools.length > 0 && <span className="skill-tools">{s.tools.join(", ")}</span>}
        </div>
      ))}
    </div>
  );
}
