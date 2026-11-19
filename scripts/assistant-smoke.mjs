// LM Studio assistant against a fake OpenAI-compatible server (SSE): the model calls editor tools to create a scene and
// a red star, the turn is one undo step, a failing tool call is shown and fed back, the Generate panel's prompt writer
// fills the prompt, and an offline server blocks Send.
import {_electron as electron, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-assistant-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, server;
const requests = [];

try {
 // Fake LM Studio: replies depend on the conversation so far.
 server = createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
   if (req.url === '/api/v0/models') { res.writeHead(200, {'Content-Type': 'application/json'}); return res.end(JSON.stringify({data: [{id: 'fake-qwen', type: 'llm', state: 'loaded', capabilities: ['tool_use']}, {id: 'nomic-embed', type: 'embeddings', state: 'not-loaded'}]})); }
   if (req.url !== '/v1/chat/completions') { res.writeHead(404); return res.end(); }
   const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
   res.writeHead(200, {'Content-Type': 'text/event-stream'});
   const send = v => res.write(`data: ${JSON.stringify(v)}\n\n`), done = () => res.end('data: [DONE]\n\n');
   const text = value => { for (const part of value.match(/.{1,12}/g)) send({choices: [{delta: {content: part}}]}); send({choices: [{delta: {}, finish_reason: 'stop'}]}); done(); };
   const calls = list => { list.forEach((c, i) => send({choices: [{delta: {tool_calls: [{index: i, id: `call_${i}`, function: {name: c.name, arguments: JSON.stringify(c.args)}}]}}]})); send({choices: [{delta: {}, finish_reason: 'tool_calls'}]}); done(); };
   const last = body.messages.at(-1), firstUser = [...body.messages].reverse().find(m => m.role === 'user')?.content ?? '';
   if (!body.tools && body.messages[0].content.startsWith('You write skills')) return text(JSON.stringify({name: 'Watercolour tiles', description: 'Use for soft painted floor and wall tiles.', instructions: '- one tile per image\n- seamless edges', always: false, generate: {kind: 'image', prompt: '{prompt}, watercolour tile, seamless', width: 512, height: 512, loras: [{name: 'invented.safetensors', strength: 1}]}}));
   if (!body.tools) {
    // Gemma 4-like: thinking streams as reasoning_content; without reasoning_effort "none" (or for "budget") the budget runs out.
    for (const part of ['Input is short. ', 'Add style, palette… ']) send({choices: [{delta: {reasoning_content: part}}]});
    if (body.reasoning_effort !== 'none' || body.messages.at(-1).content === 'budget') { send({choices: [{delta: {}, finish_reason: 'length'}]}); return done(); }
    return setTimeout(() => text('cute green slime character, pixel art, game sprite, plain background'), 300);
   }
   if (last.role === 'user' && last.content.startsWith('Use the skill')) return calls([{name: 'use_skill', args: {name: 'level builder'}}]);
   if (last.role === 'user' && /Level 2/.test(last.content)) return calls([{name: 'create_scene', args: {name: 'Level 2'}}, {name: 'add_object', args: {item: 'pixi.star', name: 'Red star', x: 300, y: 200, fields: {'pixi.shape': {color: '#ff2020', width: 90, height: 90}}}}]);
   if (last.role === 'user' && /break/.test(last.content)) return calls([{name: 'open_scene', args: {sceneId: 'Level 2'}}, {name: 'set_fields', args: {objectId: 'Red star', component: 'pixi.shape', values: {colour: '#000000'}}}]);
   if (last.role === 'tool' && /break/.test(firstUser)) return text('<think>the field is called color</think>Sorry, that field does not exist.');
   if (last.role === 'tool') return text('<think>done</think>Created Level 2 with a red star.');
   return text('OK');
  });
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const lmUrl = `http://127.0.0.1:${server.address().port}`, file = join(temp, 'assistant.pixieditor');

 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 await expect(page.getByTestId('pixi-canvas')).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const choose = path => app.evaluate(({dialog}, target) => { dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); }, path);
 const setAddress = async value => {
  await menu('Settings…');
  const field = page.getByTestId('settings-dialog').getByRole('textbox', {name: 'LM Studio address', exact: true});
  await field.fill(value); await field.press('Enter'); await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Editor settings', exact: true})).toBeFocused();
 };
 const save = async () => { await choose(file); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); await expect.poll(() => readFile(file, 'utf8').then(() => true, () => false)).toBe(true); return JSON.parse(await readFile(file, 'utf8')); };
 await setAddress(lmUrl);

 // A turn: create scene + red star through tools; one undo step.
 await page.keyboard.press('Alt+KeyJ');
 const panel = page.getByTestId('assistant-panel'), log = panel.getByRole('log');
 await expect(panel).toHaveAttribute('data-online', 'true');
 await expect(panel.getByRole('combobox', {name: 'Model', exact: true})).toHaveValue('fake-qwen');
 const input = panel.getByRole('textbox', {name: 'Message', exact: true});
 await input.fill('Create a scene called Level 2 with a red star');
 await input.press('Enter');
 await expect(log.locator('[data-kind="assistant"]')).toHaveText(['Created Level 2 with a red star.'], {timeout: 30000});
 await expect(log.locator('[data-kind="step"]')).toHaveText(['✓ create scene · Level 2', '✓ add object · Red star']);
 await expect(log.locator('[data-kind="changes"]')).toHaveCount(1);
 await expect(log.locator('[data-kind="changes"]')).toContainText('Changes: + Red star');
 // Review card: the scene and the star with its components; Discard undoes the whole turn (Redo brings it back).
 const review = log.getByTestId('assistant-review');
 await expect(review).toHaveAttribute('data-review', 'open');
 await expect(review.locator('summary')).toHaveText('Review 2 change(s)');
 await expect(review.locator('[data-scope="scene"][data-change="added"]')).toContainText('Level 2');
 await expect(review.locator('[data-scope="object"][data-change="added"]')).toContainText('Red star');
 await expect(review.locator('[data-scope="object"][data-change="added"]')).toContainText('+ Shape');
 await review.getByRole('button', {name: 'Discard', exact: true}).click();
 await expect(review).toHaveAttribute('data-review', 'discarded');
 expect((await save()).scenes.map(s => s.name)).not.toContain('Level 2');
 await menu('Redo');
 expect(requests[0].tools.map(t => t.function.name)).toEqual(expect.arrayContaining(['get_editor_state', 'add_object', 'create_scene', 'add_rule', 'generate_asset']));
 expect(requests[0].messages[0].role).toBe('system');
 expect(requests[1].messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content).ok)).toEqual([true, true]);
 await page.keyboard.press('Escape');
 let saved = await save();
 const level = saved.scenes.find(s => s.name === 'Level 2'), star = level?.entities.find(e => e.name === 'Red star');
 expect(star.components.find(c => c.type === 'pixi.shape').data).toMatchObject({kind: 'star', color: '#ff2020', width: 90});
 expect(star.components.find(c => c.type === 'scene.transform2d').data).toMatchObject({x: 300, y: 200});
 await menu('Undo');
 saved = await save();
 expect(saved.scenes.map(s => s.name)).not.toContain('Level 2');
 await menu('Redo');
 saved = await save();
 expect(saved.scenes.map(s => s.name)).toContain('Level 2');
 console.log('PASS assistant turn: model tool calls create a scene and a red star; a review card lists the changes and Discard undoes the turn; the whole turn undoes and redoes as one step');

 // A failing tool call is shown and returned to the model, which answers.
 await page.keyboard.press('Alt+KeyJ');
 await input.fill('break it'); await input.press('Enter');
 await expect(log.locator('[data-kind="assistant"]').last()).toHaveText('Sorry, that field does not exist.', {timeout: 30000});
 await expect(log.locator('[data-kind="step"]').last()).toContainText('✗ set fields · Red star — pixi.shape has no field colour');
 expect(JSON.parse(requests.at(-1).messages.at(-1).content)).toMatchObject({ok: false});
 await panel.getByRole('button', {name: 'New chat', exact: true}).click();
 await expect(log.locator('[data-kind]')).toHaveCount(0);
 await page.keyboard.press('Escape');
 console.log('PASS failing tool calls are reported in the log and fed back to the model; New chat clears the conversation');

 // Generate panel: Write prompt fills the prompt from LM Studio (no tools).
 await page.keyboard.press('Alt+KeyA');
 const generate = page.getByTestId('generate-panel'), prompt = generate.getByRole('textbox', {name: 'Prompt', exact: true});
 await prompt.fill('slime');
 await generate.getByRole('button', {name: '✨ Write prompt', exact: true}).click();
 const status = generate.getByTestId('prompt-writer-status');
 await expect(status).toHaveAttribute('data-phase', /waiting|thinking|writing/);
 await expect(prompt).toHaveValue('cute green slime character, pixel art, game sprite, plain background');
 await expect(status).toHaveAttribute('data-phase', 'done');
 await expect(status).toContainText(/Prompt ready in [\d.]+ s · fake-qwen/);
 const writer = requests.at(-1);
 expect(writer.tools).toBeUndefined(); expect(writer.reasoning_effort).toBe('none'); expect(writer.max_tokens).toBe(1500);
 expect(writer.messages[0].content).toContain('text-to-image'); expect(writer.messages[1].content).toBe('slime');
 // A model that ignores the setting and spends its budget thinking: a clear error, prompt unchanged.
 await prompt.fill('budget');
 await generate.getByRole('button', {name: '✨ Write prompt', exact: true}).click();
 await expect(status).toHaveAttribute('data-phase', 'failed');
 await expect(status).toContainText('token budget thinking');
 await expect(prompt).toHaveValue('budget');
 await page.keyboard.press('Escape');
 console.log('PASS Generate panel writes a prompt with thinking off and shows live status (waiting/thinking/writing/ready) and clear errors');

 // Skills and instructions: your and the project's instructions reach the assistant and the prompt writer; skills are
 // listed for use_skill, /skill-name loads one into the message, an always-on project skill is in the instructions.
 await page.keyboard.press('Alt+KeyK');
 const skills = page.getByTestId('skills-panel');
 await skills.getByRole('textbox', {name: 'My instructions (this computer)', exact: true}).fill('Answer in Turkish.');
 await skills.getByRole('textbox', {name: 'Project instructions', exact: true}).fill('A cosy slime platformer.');
 await skills.getByRole('button', {name: 'New skill', exact: true}).click();
 const editor = skills.getByTestId('skill-editor');
 await editor.getByRole('textbox', {name: 'Name', exact: true}).fill('Naming');
 await editor.getByRole('textbox', {name: 'Description', exact: true}).fill('How objects are named');
 await editor.getByRole('checkbox', {name: 'Always on', exact: true}).check();
 await editor.getByRole('textbox', {name: 'Instructions', exact: true}).fill('Object names in Turkish.');
 await editor.getByRole('button', {name: 'Save skill', exact: true}).click();
 await expect(skills.locator('[data-skill="Naming"]')).toHaveAttribute('data-scope', 'project');
 await expect(skills.locator('[data-skill="Level builder"]')).toHaveAttribute('data-scope', 'builtin');
 await page.keyboard.press('Escape');
 await page.keyboard.press('Alt+KeyJ');
 await input.fill('/retro-sound-effect laser shot');
 await input.press('Enter');
 await expect(panel.locator('[data-kind="step"]').filter({hasText: 'use skill'}).last()).toContainText('✓');
 await expect(panel).toHaveAttribute('data-busy', 'false');
 const skillTurn = requests.find(r => r.tools && r.messages.at(-1).role === 'user' && r.messages.at(-1).content.startsWith('Use the skill'));
 expect(skillTurn.messages[0].content).toContain('Answer in Turkish.'); expect(skillTurn.messages[0].content).toContain('A cosy slime platformer.');
 expect(skillTurn.messages[0].content).toContain('Object names in Turkish.'); expect(skillTurn.messages[0].content).toContain('- Level builder: ');
 expect(skillTurn.messages[0].content).not.toContain('- Naming: ');
 expect(skillTurn.messages.at(-1).content).toContain('chiptune'); expect(skillTurn.messages.at(-1).content).toContain('Request: laser shot');
 expect(skillTurn.tools.map(t => t.function.name)).toContain('use_skill');
 expect(requests.at(-1).messages.find(m => m.role === 'tool').content).toContain('Building a level');
 await input.fill('/no-such-skill hi');
 await input.press('Enter');
 await expect(page.getByText(/Unknown skill \/no-such-skill/).first()).toBeVisible();
 await page.keyboard.press('Escape');
 // The prompt writer follows the instructions and the chosen skill.
 await page.keyboard.press('Alt+KeyA');
 await generate.getByRole('combobox', {name: 'Skill', exact: true}).selectOption({label: 'Pixel art sprite'});
 await expect(generate.getByTestId('skill-template')).toContainText('pixel art sprite of {prompt}');
 await prompt.fill('slime');
 await generate.getByRole('button', {name: '✨ Write prompt', exact: true}).click();
 await expect(status).toHaveAttribute('data-phase', 'done');
 const styled = requests.at(-1).messages[0].content;
 expect(styled).toContain('Answer in Turkish.'); expect(styled).toContain('A cosy slime platformer.'); expect(styled).toContain('Pixel-art sprites:');
 await page.keyboard.press('Escape');
 const withSkills = await save();
 expect(withSkills.extensions['ai.skills']).toMatchObject({instructions: 'A cosy slime platformer.', items: [{name: 'Naming', always: true, instructions: 'Object names in Turkish.'}]});
 console.log('PASS skills and instructions: yours and the project\'s reach the assistant and prompt writer, use_skill and /skill-name load a skill, always-on skills are built in, saved with the project');

 // Built-in skills: Edit saves a project copy that replaces it, Delete removes the copy (the built-in returns) or hides
 // a built-in (Show hidden brings it back). The local AI writes a skill for review. The Assistant pins skills for a chat.
 await page.keyboard.press('Alt+KeyK');
 await skills.getByRole('button', {name: 'Edit Game UI icon', exact: true}).click();
 await editor.getByRole('textbox', {name: 'Description', exact: true}).fill('Our flat icons');
 await editor.getByRole('button', {name: 'Save skill', exact: true}).click();
 await expect(skills.locator('[data-skill="Game UI icon"]')).toHaveAttribute('data-scope', 'project');
 await expect(skills.locator('[data-skill="Game UI icon"]')).toContainText('edited built-in');
 await skills.getByRole('button', {name: 'Delete Game UI icon', exact: true}).click();
 await expect(skills.locator('[data-skill="Game UI icon"]')).toHaveAttribute('data-scope', 'builtin');
 await skills.getByRole('button', {name: 'Delete Retro sound effect', exact: true}).click();
 await expect(skills.locator('[data-skill="Retro sound effect"]')).toHaveCount(0);
 await skills.getByRole('button', {name: 'Show hidden built-in skills (1)', exact: true}).click();
 await expect(skills.locator('[data-skill="Retro sound effect"]')).toHaveCount(1);
 await skills.getByRole('button', {name: '✨ New skill with AI', exact: true}).click();
 await editor.getByRole('textbox', {name: 'Ask the AI', exact: true}).fill('watercolour tiles');
 await editor.getByRole('button', {name: '✨ Write with AI', exact: true}).click();
 await expect(skills.getByTestId('skill-writer-status')).toHaveAttribute('data-phase', 'done');
 await expect(editor.getByRole('textbox', {name: 'Name', exact: true})).toHaveValue('Watercolour tiles');
 await expect(editor.getByRole('textbox', {name: 'Instructions', exact: true})).toHaveValue(/seamless edges/);
 await expect(editor.locator('[aria-label^="LoRA "]')).toHaveCount(0);
 await editor.getByRole('button', {name: 'Save skill', exact: true}).click();
 await expect(skills.locator('[data-skill="Watercolour tiles"]')).toHaveAttribute('data-scope', 'project');
 const skillWriter = requests.find(r => !r.tools && r.messages[0].content.startsWith('You write skills'));
 expect(skillWriter.messages[1].content).toBe('Write a skill for: watercolour tiles'); expect(skillWriter.reasoning_effort).toBe('none');
 await page.keyboard.press('Escape');
 await page.keyboard.press('Alt+KeyJ');
 const picker = panel.getByTestId('assistant-skills');
 await picker.getByRole('combobox', {name: 'Use a skill…', exact: true}).selectOption({label: 'Level builder'});
 await expect(picker.locator('[data-skill="Level builder"]')).toBeVisible();
 await input.fill('hello');
 await input.press('Enter');
 await expect(panel).toHaveAttribute('data-busy', 'false');
 const pinnedTurn = requests.filter(r => r.tools).at(-1).messages[0].content;
 expect(pinnedTurn).toContain('Skill "Level builder" (chosen for this chat)'); expect(pinnedTurn).not.toContain('- Level builder: ');
 await picker.getByRole('button', {name: 'Stop using skill Level builder', exact: true}).click();
 await expect(picker.locator('[data-skill]')).toHaveCount(0);
 await page.keyboard.press('Escape');
 const edited = await save();
 expect(edited.extensions['ai.skills'].items.map(k => k.name)).toEqual(['Naming', 'Watercolour tiles']);
 expect(edited.extensions['ai.skills'].hidden).toEqual([]);
 console.log('PASS skills: built-ins can be edited (project copy) and deleted (hidden, restorable); the local AI writes a skill for review; the Assistant pins skills for a chat');

 // Offline.
 await setAddress('http://127.0.0.1:9');
 await page.keyboard.press('Alt+KeyJ');
 await panel.getByRole('button', {name: 'Retry', exact: true}).click();
 await expect(panel).toHaveAttribute('data-online', 'false');
 await input.fill('anything');
 await expect(panel.getByRole('button', {name: 'Send', exact: true})).toBeDisabled();
 expect(errors).toEqual([]);
 await mkdir(join(root, 'outputs'), {recursive: true});
 await page.screenshot({path: join(root, 'outputs/editor-assistant.png')});
 console.log('PASS offline LM Studio is reported and blocks Send');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/assistant-failure.png')}).catch(() => {});
 throw error;
} finally {
 if (server) await new Promise(r => server.close(r));
 if (app) {
  await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {});
  await app.close().catch(() => {});
 }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
