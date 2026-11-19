import {z} from 'zod';
import {GeneratePresetSchema, type SkillChoice} from '@rewrite/ai-comfy/contracts';

/**
 * Skills and instructions for the local AI (LM Studio assistant, prompt writer, ComfyUI Generate panel).
 *
 * - **Instructions** are always given to the assistant and the prompt writer: the project's (saved in the project)
 *   and yours (this computer).
 * - A **skill** is a named piece of know-how: instructions in plain words plus an optional generation preset (prompt
 *   template, negative prompt, LoRAs, size, sampler values). The assistant sees each skill's name and description and
 *   loads the instructions when a request needs them (`use_skill`), or always when the skill is *always on*; the
 *   Generate panel applies a skill's preset and gives its instructions to the prompt writer.
 */
export const SkillSchema = z.object({
 id: z.string().min(1).max(100), name: z.string().trim().min(1).max(60), description: z.string().max(400).default(''),
 instructions: z.string().max(20000).default(''),
 /** Always in the assistant's instructions (otherwise loaded on demand by name and description). */
 always: z.boolean().default(false),
 generate: GeneratePresetSchema.optional(),
}).strict();
export type Skill = z.infer<typeof SkillSchema>;
export const SkillsSchema = z.object({version: z.literal(1), instructions: z.string().max(20000).default(''), items: z.array(SkillSchema).max(200).default([]),
 /** Built-in skills deleted here (by ID); they come back with “Show hidden built-in skills”. */
 hidden: z.array(z.string().max(100)).max(100).default([])}).strict();
export type Skills = z.infer<typeof SkillsSchema>;
/** Project section with the project's instructions and skills (saved with the project, undoable). */
export const skillsSection = 'ai.skills';
export const emptySkills = (): Skills => ({version: 1, instructions: '', items: [], hidden: []});
export type SkillScope = 'project' | 'machine' | 'builtin';
export type ScopedSkill = Skill & {scope: SkillScope};

/** Ready-made skills: editing one saves a project skill with the same name (which replaces it); deleting one hides it. */
export const builtInSkills: readonly Skill[] = [
 {id: 'builtin.pixel-art', name: 'Pixel art sprite', description: 'Retro pixel-art game sprites: limited palette, crisp outlines, one subject on a plain background.', always: false,
  instructions: 'Pixel-art sprites: describe one subject, its pose and two to four key colours. Avoid photographic and lighting terms. In the editor, turn on Settings → Game → Pixel art and scale sprites by whole numbers.',
  generate: {kind: 'image', prompt: 'pixel art sprite of {prompt}, 16-bit retro game style, limited palette, crisp clean outlines, centered, single object, plain flat background', negative: 'blurry, smooth gradients, photo, realistic, 3d render, text, watermark, noise', loras: [], width: 512, height: 512}},
 {id: 'builtin.ui-icon', name: 'Game UI icon', description: 'Flat, bold game interface icons (buttons, inventory items, currencies).', always: false,
  instructions: 'UI icons: one object, readable at 64 px, bold silhouette, no text. Place icons at 64–128 px and keep a consistent size across a set.',
  generate: {kind: 'image', prompt: 'game UI icon of {prompt}, flat vector style, bold silhouette, thick dark outline, vibrant colours, centered, simple plain background, no text', negative: 'text, letters, photo, cluttered background, blurry, tiny details', loras: [], width: 512, height: 512}},
 {id: 'builtin.retro-sfx', name: 'Retro sound effect', description: 'Short 8-bit video game sound effects (jump, coin, hit, power-up).', always: false,
  instructions: 'Sound effects: name the action (jump, coin pickup, hit, explosion, power-up), 0.5–2 seconds, no music. Add them with a Sound object and play them from a rule or script.',
  generate: {kind: 'audio', prompt: '{prompt}, short retro 8-bit video game sound effect, chiptune, clean, no music', loras: []}},
 {id: 'builtin.translation', name: 'Game translation', description: 'How texts are translated in the Localization panel (tone, terms, glossary).', always: false,
  instructions: [
   'Game translation:',
   '- Short, natural interface language players expect on their platform (Play, Settings, Pause, Continue).',
   '- Keep the tone of the source (playful stays playful); address the player the way games in the target language usually do.',
   '- Keep names of characters, places and the game itself unless the glossary below says otherwise.',
   '- Glossary (copy this skill to the project and add lines such as "Coin → Altın"):',
  ].join('\n')},
 {id: 'builtin.level-builder', name: 'Level builder', description: 'Laying out a 2D level: ground, platforms, collectibles and clear object names.', always: false,
  instructions: [
   'Building a level:',
   '- Call get_editor_state first; use the stage size for every position.',
   '- Ground along the bottom (about 8% of the stage height), platforms in steps a character can jump between (vertical gaps under 20% of the stage height).',
   '- Name every object by role and number (Ground, Platform 1, Coin 3) and put related objects under one parent (set_parent) so they move together.',
   '- Collectibles sit a little above platforms; keep 40 px from the stage edges.',
  ].join('\n')},
];

/** Built-in skills deleted in the project or on this computer. */
export const hiddenBuiltIns = (project: Skills, machine: Skills) => new Set([...(project.hidden ?? []), ...(machine.hidden ?? [])]);
/** Every skill a request can use, project first (a project skill hides a computer or built-in skill with the same name). */
export function listSkills(project: Skills, machine: Skills): ScopedSkill[] {
 const out: ScopedSkill[] = [], names = new Set<string>(), hidden = hiddenBuiltIns(project, machine);
 for (const [scope, list] of [['project', project.items], ['machine', machine.items], ['builtin', builtInSkills.filter(k => !hidden.has(k.id))]] as const) {
  for (const skill of list) { const key = skill.name.trim().toLowerCase(); if (names.has(key)) continue; names.add(key); out.push({...skill, scope}); }
 }
 return out;
}
/** `Pixel art sprite` → `pixel-art-sprite` (for `/pixel-art-sprite` in the assistant). */
export const skillSlug = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
export function findSkill(skills: readonly ScopedSkill[], ref: string) {
 const r = ref.trim().replace(/^\//, '').toLowerCase();
 return skills.find(k => k.id === ref) ?? skills.find(k => k.name.toLowerCase() === r) ?? skills.find(k => skillSlug(k.name) === skillSlug(r));
}
export const toChoice = (skill: Skill): SkillChoice => ({id: skill.id, name: skill.name, instructions: skill.instructions, ...(skill.generate ? {preset: skill.generate} : {})});
/** What a loaded skill tells the assistant: its instructions and, if it has one, how its preset generates. */
export function skillDetails(skill: Skill) {
 const g = skill.generate, lines = [skill.instructions.trim() || skill.description];
 if (g) {
  lines.push('', `Generation preset (generate_asset with skill="${skill.name}"${g.kind ? `, ${g.kind}` : ''}):`);
  if (g.prompt) lines.push(`- prompt template: ${g.prompt}`);
  if (g.negative) lines.push(`- negative: ${g.negative}`);
  if (g.loras.length) lines.push(`- LoRAs: ${g.loras.map(l => `${l.name} (${l.strength})`).join(', ')}`);
  if (g.width && g.height) lines.push(`- size: ${g.width}×${g.height}`);
  lines.push('Pass only the subject as prompt; the template adds the style.');
 }
 return lines.join('\n');
}
/** Instructions the assistant always follows and the catalogue of skills it can load; `pinned` skills (picked in the Assistant panel) count as always on. */
export function assistantGuidance(project: Skills, machine: Skills, pinned: readonly string[] = []) {
 const skills = listSkills(project, machine), on = (k: ScopedSkill) => k.always || pinned.includes(k.id), instructions: string[] = [];
 if (machine.instructions.trim()) instructions.push(`From the user (always follow):\n${machine.instructions.trim()}`);
 if (project.instructions.trim()) instructions.push(`For this project (always follow):\n${project.instructions.trim()}`);
 for (const skill of skills.filter(on)) instructions.push(`Skill "${skill.name}"${skill.always ? '' : ' (chosen for this chat)'}:\n${skillDetails(skill)}`);
 return {instructions, skills: skills.filter(k => !on(k)).map(k => ({name: k.name, description: k.description || k.instructions.slice(0, 160)}))};
}
/** The prompt writer's extra guidance: your and the project's instructions, then the chosen skill's. */
export function writerGuidance(project: Skills, machine: Skills, skill?: {instructions: string}) {
 return [machine.instructions, project.instructions, skill?.instructions ?? ''].map(s => s.trim()).filter(Boolean).join('\n');
}
/** `/skill-name rest of the message`: the skill's instructions go with the message. */
export function expandSkillMention(message: string, skills: readonly ScopedSkill[]): {text: string; skill?: ScopedSkill} {
 const match = /^\/([\p{L}\p{N}][\p{L}\p{N}-]*)\s*([\s\S]*)$/u.exec(message.trim());
 if (!match) return {text: message};
 const skill = findSkill(skills, match[1]);
 if (!skill) throw Error(`Unknown skill /${match[1]}. Skills: ${skills.map(k => `/${skillSlug(k.name)}`).join(', ')}`);
 return {skill, text: `Use the skill "${skill.name}":\n${skillDetails(skill)}\n\nRequest: ${match[2].trim() || skill.description}`};
}

/** What the skill writer knows besides the request: the LoRAs and workflows on this computer and other skills' names. */
export interface SkillWriterContext {loras: readonly string[]; workflows: readonly string[]; skills: readonly string[]; projectInstructions?: string}
/**
 * Messages for the local model that writes a skill as JSON: from a short request, or by revising `current` (the
 * editor's draft). The reply is checked by `parseSkillReply`; nothing is saved until the user presses Save.
 */
export function skillWriterMessages(request: string, current: Skill | undefined, context: SkillWriterContext): {role: 'system' | 'user'; content: string}[] {
 const system = [
  'You write skills for a 2D game editor\'s AI assistant. A skill is know-how in plain words that the assistant loads by name when a request needs it, plus an optional ComfyUI generation preset for images or sounds.',
  'Reply with ONE JSON object and nothing else, with these fields:',
  '{"name": short title (max 60 chars), "description": one sentence saying WHEN to use it (the assistant picks skills by this), "instructions": concrete steps and rules as short lines starting with "- " (max 1500 chars), "always": false unless it must apply to every request, "generate": optional {"kind": "image" or "audio", "prompt": template containing {prompt} where the subject goes, "negative": optional, "width"/"height": optional multiples of 8, "steps"/"cfg": optional, "loras": optional [{"name": one of the LoRA files listed, "strength": 0.4-1}], "workflow": optional, one of the workflows listed}}',
  'Only add "generate" when the skill is about making images or sounds. Never invent LoRA or workflow names. Write in English unless the request is in another language.',
  context.loras.length ? `LoRA files: ${context.loras.slice(0, 40).join(', ')}` : 'No LoRA files are installed.',
  context.workflows.length ? `Workflows: ${context.workflows.slice(0, 40).join(', ')}` : '',
  context.skills.length ? `Existing skills (pick a different name): ${context.skills.slice(0, 60).join(', ')}` : '',
  context.projectInstructions?.trim() ? `Project instructions (stay consistent):\n${context.projectInstructions.trim()}` : '',
 ].filter(Boolean).join('\n');
 const user = current && (current.name || current.instructions) ? `Revise this skill as asked.\nRequest: ${request.trim() || 'Improve it.'}\nCurrent skill: ${JSON.stringify(current)}` : `Write a skill for: ${request.trim()}`;
 return [{role: 'system', content: system}, {role: 'user', content: user}];
}
/** The writer's reply as a valid skill: the first JSON object in the text, LoRA/workflow names it made up dropped. */
export function parseSkillReply(text: string, context: Pick<SkillWriterContext, 'loras' | 'workflows'>, id: string = crypto.randomUUID()): Skill {
 const start = text.indexOf('{'), end = text.lastIndexOf('}');
 if (start < 0 || end <= start) throw Error('The model did not return a skill (no JSON object in its reply)');
 let raw: Record<string, unknown>;
 try { raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>; } catch { throw Error('The model returned malformed JSON for the skill'); }
 const g = raw.generate && typeof raw.generate === 'object' ? raw.generate as Record<string, unknown> : undefined, num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
 const size = (v: unknown) => { const n = num(v); return n === undefined ? undefined : Math.min(4096, Math.max(64, Math.round(n / 8) * 8)); };
 const generate = g ? {
  ...(g.kind === 'image' || g.kind === 'audio' ? {kind: g.kind} : {}), prompt: typeof g.prompt === 'string' ? g.prompt.slice(0, 2000) : '',
  ...(typeof g.negative === 'string' && g.negative.trim() ? {negative: g.negative.slice(0, 4000)} : {}),
  loras: (Array.isArray(g.loras) ? g.loras : []).flatMap(l => { const x = l as {name?: unknown; strength?: unknown}; return typeof x.name === 'string' && context.loras.includes(x.name) ? [{name: x.name, strength: Math.min(4, Math.max(-4, num(x.strength) ?? 1))}] : []; }).slice(0, 8),
  ...(typeof g.workflow === 'string' && context.workflows.includes(g.workflow) ? {workflow: g.workflow} : {}),
  ...(size(g.width) && size(g.height) ? {width: size(g.width), height: size(g.height)} : {}),
  ...(num(g.steps) ? {steps: Math.min(150, Math.max(1, Math.round(num(g.steps)!)))} : {}), ...(num(g.cfg) !== undefined ? {cfg: Math.min(30, Math.max(0, num(g.cfg)!))} : {}),
 } : undefined;
 const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
 return SkillSchema.parse({id, name: str(raw.name, 60) || 'New skill', description: str(raw.description, 400), instructions: str(raw.instructions, 20000), always: raw.always === true, ...(generate ? {generate} : {})});
}
