/** A skill the tutor can load, as the server lists it (the prompt stays on the server). */
export interface SkillInfo {
  name: string;
  description: string;
  tools: string[];
}

/** The skills; none when the server cannot say (the chat then works without them). */
export async function fetchSkills(): Promise<SkillInfo[]> {
  try {
    const r = await fetch("/api/skills");
    if (!r.ok) return [];
    const body = (await r.json()) as unknown;
    return Array.isArray(body) ? (body as SkillInfo[]) : [];
  } catch {
    return [];
  }
}

/** The word being typed after a leading slash ("/pre" gives "pre"), null when it is not one. */
export function slashQuery(text: string): string | null {
  const m = /^\/([a-z0-9-]*)$/.exec(text);
  return m ? (m[1] ?? "") : null;
}

/** `/name rest` for a known skill gives the skill and the text to send; anything else, null. */
export function splitSkill(
  text: string,
  skills: SkillInfo[],
): { skill: string; text: string } | null {
  const m = /^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/.exec(text);
  const name = m?.[1];
  if (!name || !skills.some((s) => s.name === name)) return null;
  const rest = (m?.[2] ?? "").trim();
  return { skill: name, text: rest || `/${name}` };
}
