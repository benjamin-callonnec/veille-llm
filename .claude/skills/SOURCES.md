# Skills tiers

Copies non modifiées, lues en entier avant installation (documentation uniquement, aucun script).
Les fichiers `SKILL.md` ne doivent pas être modifiés : pour mettre à jour, recopier depuis la source.

| Skill | Source | Chemin | Commit | Licence |
|---|---|---|---|---|
| frontend-design | https://github.com/anthropics/skills | `skills/frontend-design` | `e4bb5d960d87126ff3b3a8af1a104b7db67560ba` | Apache-2.0 (`LICENSE.txt` fourni) |
| agentic-actions-auditor | https://github.com/trailofbits/skills | `plugins/agentic-actions-auditor/skills/agentic-actions-auditor` (`SKILL.md` et `references/`) | `149d7b21f4067765b82e67029730b42d228ef4b4` | CC-BY-SA-4.0, © Trail of Bits |

Date de copie : 2026-11-21.

Pourquoi ces deux skills :
- `frontend-design` : guidance de design pour le futur front React (plan 3).
- `agentic-actions-auditor` : audit des workflows GitHub qui appellent un agent IA (injection de
  prompt, `pull_request_target`, listes d'autorisation trop larges), notre principal risque.

Superpowers, `/simplify`, `/security-review` et `/code-review` sont déjà disponibles sans copie.
