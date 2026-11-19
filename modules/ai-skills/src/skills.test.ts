import {expect, it} from 'vitest';
import {assistantGuidance, builtInSkills, emptySkills, expandSkillMention, findSkill, listSkills, skillDetails, skillSlug, SkillsSchema, writerGuidance, type Skills} from './index';
import {systemPrompt, promptWriterMessages} from '@rewrite/ai-lm/agent';

const project: Skills = SkillsSchema.parse({version: 1, instructions: 'Sprites are cute slimes.', items: [
 {id: 'p1', name: 'Pixel art sprite', description: 'Our pixel style', instructions: 'Use 3 colours.', generate: {prompt: 'tiny pixel {prompt}', loras: [{name: 'px.safetensors', strength: 0.7}]}},
 {id: 'p2', name: 'Naming', description: 'How we name objects', instructions: 'Names in Turkish.', always: true},
]});
const machine: Skills = {...emptySkills(), instructions: 'Answer in Turkish.'};

it('lists project skills first and lets them replace built-ins with the same name', () => {
 const all = listSkills(project, machine);
 expect(all.filter(k => k.name === 'Pixel art sprite')).toEqual([expect.objectContaining({id: 'p1', scope: 'project'})]);
 expect(all.filter(k => k.scope === 'builtin')).toHaveLength(builtInSkills.length - 1);
 expect(findSkill(all, '/game-ui-icon')?.id).toBe('builtin.ui-icon');
 expect(findSkill(all, 'pixel art sprite')?.id).toBe('p1');
 expect(skillSlug('Retro sound effect')).toBe('retro-sound-effect');
});
it('gives the assistant instructions, always-on skills and a catalogue of the rest', () => {
 const g = assistantGuidance(project, machine);
 expect(g.instructions[0]).toContain('Answer in Turkish.'); expect(g.instructions[1]).toContain('cute slimes');
 expect(g.instructions[2]).toContain('Names in Turkish.');
 expect(g.skills.map(k => k.name)).toContain('Pixel art sprite'); expect(g.skills.map(k => k.name)).not.toContain('Naming');
 const prompt = systemPrompt({stage: {width: 960, height: 540}, project: 'P', ...g});
 expect(prompt).toContain('Instructions:'); expect(prompt).toContain('- Pixel art sprite: Our pixel style'); expect(prompt).toContain('use_skill');
 expect(skillDetails(findSkill(listSkills(project, machine), 'Pixel art sprite')!)).toContain('px.safetensors (0.7)');
});
it('expands /skill mentions and refuses unknown ones', () => {
 const all = listSkills(project, machine), out = expandSkillMention('/pixel-art-sprite a blue slime', all);
 expect(out.skill?.id).toBe('p1'); expect(out.text).toContain('Use 3 colours.'); expect(out.text).toContain('Request: a blue slime');
 expect(expandSkillMention('hello /x', all).text).toBe('hello /x');
 expect(() => expandSkillMention('/nope do it', all)).toThrow('Unknown skill /nope');
});
it('passes instructions and the skill to the prompt writer', () => {
 const guidance = writerGuidance(project, machine, {instructions: 'Use 3 colours.'});
 expect(guidance.split('\n')).toEqual(['Answer in Turkish.', 'Sprites are cute slimes.', 'Use 3 colours.']);
 expect(promptWriterMessages('slime', 'image', guidance)[0].content).toContain('Follow these instructions (style, project, skill):\nAnswer in Turkish.');
});

it('deleting a built-in hides it; pinned skills join the always-on instructions', async () => {
 const {hiddenBuiltIns, parseSkillReply, skillWriterMessages} = await import('./index');
 const project = {...emptySkills(), hidden: ['builtin.ui-icon']};
 expect(listSkills(project, emptySkills()).some(k => k.id === 'builtin.ui-icon')).toBe(false);
 expect([...hiddenBuiltIns(project, {...emptySkills(), hidden: ['builtin.retro-sfx']})]).toEqual(['builtin.ui-icon', 'builtin.retro-sfx']);
 const pinned = assistantGuidance(emptySkills(), emptySkills(), ['builtin.level-builder']);
 expect(pinned.instructions.some(i => i.startsWith('Skill "Level builder" (chosen for this chat)'))).toBe(true);
 expect(pinned.skills.some(k => k.name === 'Level builder')).toBe(false);
 const messages = skillWriterMessages('watercolour tiles', undefined, {loras: ['soft.safetensors'], workflows: ['Text to image'], skills: ['Game UI icon']});
 expect(messages[0].content).toContain('soft.safetensors'); expect(messages[1].content).toBe('Write a skill for: watercolour tiles');
 const reply = 'Sure!\n```json\n{"name":"Watercolour tiles","description":"Use for soft painted tiles.","instructions":"- one tile\\n- seamless","always":"yes","generate":{"kind":"image","prompt":"{prompt}, watercolour","width":500,"height":500,"loras":[{"name":"soft.safetensors","strength":0.7},{"name":"made-up.safetensors","strength":1}],"workflow":"Imaginary","steps":999}}\n```';
 expect(parseSkillReply(reply, {loras: ['soft.safetensors'], workflows: ['Text to image']}, 'id-1')).toEqual({id: 'id-1', name: 'Watercolour tiles', description: 'Use for soft painted tiles.', instructions: '- one tile\n- seamless', always: false, generate: {kind: 'image', prompt: '{prompt}, watercolour', loras: [{name: 'soft.safetensors', strength: 0.7}], width: 504, height: 504, steps: 150}});
 expect(() => parseSkillReply('no json here', {loras: [], workflows: []})).toThrow('no JSON');
});
