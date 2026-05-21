# beluga-ext-skills

File-based evolving skills for Beluga. Skills are learned patterns from past sessions stored in `.beluga/skills/` as markdown files. Humans can browse and edit them directly.

## Tools

- **skill_search** — Search skills by keyword using grep
- **skill_create** — Create a new skill from learned knowledge

## Install

```bash
beluga extend install github.com/aspectrr/beluga-ext-skills
```

## Config

```yaml
extensions:
  evolving_skills:
    enabled: true
```

## How It Works

1. On init, creates `.beluga/skills/` directory and a prompt template
2. `skill_search` greps across `SKILL.md` files for keyword matches
3. `skill_create` writes a new skill folder with `SKILL.md` + `prompt.md`
4. The prompt template instructs the agent to search skills before solving unfamiliar problems and create skills at session end

## Development

Uses a `replace` directive in `go.mod` pointing to the local Beluga repo:

```
replace github.com/aspectrr/beluga => ../beluga
```
