// ── Evolving Skills Extension ─────────────────────────────────
// Ported from Go: github.com/aspectrr/beluga-ext-skills
//
// File-based knowledge persistence. Agents save learned patterns into
// .beluga/skills/ as markdown and search them later. Skills survive
// across sessions. Humans can browse/edit markdown directly.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";
import type {
	Extension,
	ExtensionContext,
	Tool,
	ToolDef,
	ToolContext,
} from "@beluga/sdk";

// ── Types ──────────────────────────────────────────────────────

interface SkillResult {
	name: string;
	description: string;
	content: string;
	has_prompt: boolean;
}

interface SkillCreateArgs {
	name: string;
	description: string;
	content: string;
}

interface SkillSearchArgs {
	query: string;
}

// ── Helpers ────────────────────────────────────────────────────

function sanitizeName(name: string): string {
	return name
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

function extractDescription(content: string): string {
	const lines = content.split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed && !trimmed.startsWith("#")) return trimmed;
		if (trimmed.startsWith("#")) return trimmed.replace(/^#+\s*/, "");
	}
	return "";
}

// ── SkillSearchTool ────────────────────────────────────────────

class SkillSearchTool implements Tool {
	private skillsDir: string;

	constructor(skillsDir: string) {
		this.skillsDir = skillsDir;
	}

	definition(): ToolDef {
		return {
			name: "skill_search",
			description:
				"Search skills by keyword. Skills are learned patterns from past sessions that help you solve problems.",
			parameters: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "Keywords to find relevant skills",
					},
				},
				required: ["query"],
			},
		};
	}

	async execute(
		args: Record<string, unknown>,
		_ctx: ToolContext,
	): Promise<Record<string, unknown>> {
		if (process.env.BELUGA_DRY_RUN === "true") {
			return {
				results: [
					{
						name: "example-skill",
						description: "An example skill",
						content: "# Example\n\nThis is an example.",
						has_prompt: false,
					},
				],
			};
		}

		const { query } = args as unknown as SkillSearchArgs;
		if (!query) throw new Error("query is required");

		const results: SkillResult[] = [];
		const seen = new Set<string>();

		try {
			const output = execSync(
				`grep -r -l -i ${JSON.stringify(query)} ${JSON.stringify(this.skillsDir)}`,
				{ encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
			);

			const matches = output.trim().split("\n").filter(Boolean);
			for (const match of matches) {
				// Extract skill name from path: skillsDir/<name>/SKILL.md
				const rel = match.slice(this.skillsDir.length + 1);
				const name = rel.split("/")[0];
				if (seen.has(name)) continue;
				seen.add(name);

				const skillMd = join(this.skillsDir, name, "SKILL.md");
				if (!existsSync(skillMd)) continue;

				const content = readFileSync(skillMd, "utf-8");
				const description = extractDescription(content);
				const hasPrompt = existsSync(join(this.skillsDir, name, "prompt.md"));

				results.push({ name, description, content, has_prompt: hasPrompt });
			}
		} catch {
			// grep exits 1 when no matches — return empty array
		}

		return { results };
	}
}

// ── SkillCreateTool ────────────────────────────────────────────

class SkillCreateTool implements Tool {
	private skillsDir: string;

	constructor(skillsDir: string) {
		this.skillsDir = skillsDir;
	}

	definition(): ToolDef {
		return {
			name: "skill_create",
			description:
				"Create a new skill from learned knowledge. The skill will be available for future sessions.",
			parameters: {
				type: "object",
				properties: {
					name: {
						type: "string",
						description: "Kebab-case skill name",
					},
					description: {
						type: "string",
						description: "Brief description of when to use this skill",
					},
					content: {
						type: "string",
						description: "Full markdown knowledge content",
					},
				},
				required: ["name", "description", "content"],
			},
		};
	}

	async execute(
		args: Record<string, unknown>,
		_ctx: ToolContext,
	): Promise<Record<string, unknown>> {
		if (process.env.BELUGA_DRY_RUN === "true") {
			return { status: "created", path: ".beluga/skills/example" };
		}

		const { name, description, content } = args as unknown as SkillCreateArgs;
		if (!name) throw new Error("name is required");
		if (!content) throw new Error("content is required");

		const sanitized = sanitizeName(name);
		const skillDir = join(this.skillsDir, sanitized);
		const skillMd = join(skillDir, "SKILL.md");

		if (existsSync(skillMd)) {
			throw new Error(`skill already exists: ${sanitized}`);
		}

		mkdirSync(skillDir, { recursive: true });
		writeFileSync(skillMd, `# ${description}\n\n${content}\n`);

		// Write optional prompt.md (non-fatal if fails)
		try {
			const promptMd = join(skillDir, "prompt.md");
			if (!existsSync(promptMd)) {
				writeFileSync(
					promptMd,
					`When dealing with ${description}, refer to the ${sanitized} skill for guidance.\n`,
				);
			}
		} catch {
			// non-fatal
		}

		return { status: "created", path: skillDir };
	}
}

// ── Extension ──────────────────────────────────────────────────

class SkillsExtension implements Extension {
	name = "evolving_skills";
	private skillsDir!: string;
	private promptDir!: string;

	async init(ctx: ExtensionContext): Promise<void> {
		this.skillsDir = join(dirname(ctx.promptDir), "skills");
		this.promptDir = ctx.promptDir;

		// Ensure skills directory exists
		mkdirSync(this.skillsDir, { recursive: true });

		// Write prompt template (only if not exists)
		const promptFile = join(this.promptDir, "evolving_skills.md");
		if (!existsSync(promptFile)) {
			writeFileSync(
				promptFile,
				`When you encounter an unfamiliar problem, search your skills using skill_search ` +
					`before attempting a solution. At the end of each session, if you learned something ` +
					`new or solved a non-trivial problem, create a skill using skill_create so future ` +
					`sessions can benefit from your experience.\n`,
			);
		}

		// Register tools
		ctx.registry.register(new SkillSearchTool(this.skillsDir));
		ctx.registry.register(new SkillCreateTool(this.skillsDir));

		ctx.logger.info("skills extension initialized");
	}

	async start(_signal: AbortSignal): Promise<void> {
		// Tools only — no background work
	}

	async stop(): Promise<void> {
		// No-op
	}
}

export default new SkillsExtension();
