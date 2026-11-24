// Sequential acceptance run: one candidate, every native suite in order, one JSON record.
// Usage: node scripts/acceptance.mjs [--executable PATH] [--only a,b] [--bail] [--skip-extra] [--retries N]
// A failed suite runs again up to N times (default 1); one that then passes is recorded as `flaky` with its first
// failure kept (`firstFailure`, `<name>.log`; the retry logs are `<name>.retryK.log`) and counted apart in the summary.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, readdir, stat, writeFile} from 'node:fs/promises';
import {arch, cpus, release, totalmem} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const NATIVE = ['desktop', 'assets', 'transform', 'audio', 'tween', 'animation', 'physics', 'spine', 'interactions', 'prefabs', 'recovery', 'collections', 'accessibility', 'scenes', 'drafts', 'order', 'camera', 'authoring', 'content', 'input', 'create', 'layout', 'visuals', 'productivity', 'logic', 'comfy', 'assistant', 'scripts', 'timeline', 'mix', 'render', 'localization', 'context', 'library', 'mcp', 'automation', 'automation-specialists', 'automation-backlog', 'behavior', 'multiplayer', 'physics-world', 'game-camera', 'ux', 'hub', 'spawn', 'text', 'hud', 'timer', 'debugger', 'graph', 'soundlab', 'overlay', 'mobile', 'flip', 'canvas', 'layers', 'flow', 'live', 'tools', 'ship', 'nest', 'additive', 'onion', 'globals', 'rtl', 'concave', 'fx', 'webapp', 'profiler', 'shader', 'navigation', 'lighting', 'dialogue', 'cutscene', 'live-edit', 'git', 'plugins', 'achievements', 'localhub'];
const EXTRA = [
  {name: 'example', command: ['node', 'scripts/example-smoke.mjs'], studio: true},
  {name: 'export-contributions', command: ['node', 'scripts/export-contributions-smoke.mjs'], studio: false},
  {name: 'empty', command: ['pnpm', 'test:empty'], studio: false},
  {name: 'compatibility', command: ['pnpm', 'test:compatibility'], studio: false},
];
// Product source, tests and the acceptance example; docs/README edits do not change the candidate.
const FINGERPRINT_ROOTS = ['apps', 'modules', 'packages', 'scripts', 'examples', 'third-party', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'eslint.config.mjs', 'vitest.config.ts'];
const GENERATED = new Set(['node_modules', 'out', 'dist', 'coverage', '.DS_Store']);

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const executable = option('--executable') ? resolve(option('--executable')) : process.env.REWRITE_EXECUTABLE;
const only = option('--only')?.split(',');
const retries = Math.max(0, Math.min(3, Number(option('--retries') ?? 1) || 0));
const suites = [
  ...NATIVE.filter(name => !only || only.includes(name)).map(name => ({name, command: ['node', `scripts/${name}-smoke.mjs`], studio: true})),
  ...(flag('--skip-extra') ? [] : EXTRA.filter(s => !only || only.includes(s.name))),
];

async function files(path) {
  const info = await stat(path);
  if (!info.isDirectory()) return [path];
  const result = [];
  for (const entry of (await readdir(path)).sort()) {
    if (GENERATED.has(entry) || entry.startsWith('out-')) continue;
    result.push(...await files(join(path, entry)));
  }
  return result;
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function sourceFingerprint() {
  const list = (await Promise.all(FINGERPRINT_ROOTS.map(p => files(join(root, p))))).flat().sort();
  const hash = createHash('sha256');
  for (const file of list) hash.update(`${relative(root, file)}\0${await sha256(file)}\n`);
  return {sha256: hash.digest('hex'), files: list.length, roots: FINGERPRINT_ROOTS};
}

function output(command, stream = 'stdout') {
  return new Promise(done => {
    const child = spawn(command[0], command.slice(1), {cwd: root});
    let text = '';
    child[stream].on('data', d => (text += d));
    child.on('error', () => done(null));
    child.on('close', () => done(text.trim() || null));
  });
}

function run(suite, logFile, env) {
  return new Promise(done => {
    const started = Date.now();
    const child = spawn(suite.command[0], suite.command.slice(1), {cwd: root, env});
    let log = '';
    const append = chunk => {
      log += chunk;
      process.stdout.write(`  ${chunk}`.replaceAll('\n', '\n  ').replace(/ {2}$/, ''));
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('close', async (code, signal) => {
      await writeFile(logFile, log);
      const passes = log.split('\n').filter(line => line.startsWith('PASS')).map(line => line.slice(0, 300));
      done({code, signal, seconds: Math.round((Date.now() - started) / 100) / 10, passes, tail: code === 0 ? undefined : log.slice(-3000)});
    });
  });
}

const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d+Z$/, 'Z');
const dir = join(root, 'outputs', 'acceptance', stamp);
await mkdir(dir, {recursive: true});
const asar = executable ? join(dirname(dirname(executable)), 'Resources', 'app.asar') : undefined;
const record = {
  startedAt: new Date().toISOString(),
  source: await sourceFingerprint(),
  candidate: executable
    ? {kind: 'package', executable: relative(root, executable), appAsarSha256: await sha256(asar).catch(() => null), signature: (await output(['codesign', '-dv', dirname(dirname(dirname(executable)))], 'stderr'))?.match(/^Signature=.*$/m)?.[0] ?? 'unsigned'}
    : {kind: 'source-build', main: 'apps/editor-desktop/out/main/index.js'},
  host: {
    platform: process.platform,
    os: release(),
    productVersion: await output(['sw_vers', '-productVersion']),
    arch: arch(),
    cpu: cpus()[0]?.model,
    memoryGiB: Math.round(totalmem() / 2 ** 30),
    node: process.version,
    pnpm: await output(['pnpm', '-v']),
    chrome: await output(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--version']),
    swap: await output(['sysctl', '-n', 'vm.swapusage']),
  },
  suites: [],
};
const save = () => writeFile(join(dir, 'acceptance.json'), JSON.stringify(record, null, 2) + '\n');

for (const suite of suites) {
  const env = {...process.env};
  if (suite.studio && executable) env.REWRITE_EXECUTABLE = executable;
  else delete env.REWRITE_EXECUTABLE;
  console.log(`\n▶ ${suite.name}`);
  const first = await run(suite, join(dir, `${suite.name}.log`), env);
  let result = first, attempts = 1;
  while (result.code !== 0 && attempts <= retries) { console.log(`↻ ${suite.name} failed (${result.seconds}s), retry ${attempts}`); result = await run(suite, join(dir, `${suite.name}.retry${attempts}.log`), env); attempts++; }
  const verdict = result.code === 0 ? attempts > 1 ? 'flaky' : 'pass' : 'fail';
  record.suites.push({name: suite.name, target: suite.studio && executable ? 'package' : 'source', command: suite.command.join(' '), result: verdict, attempts, ...result, ...(verdict === 'flaky' ? {firstFailure: first.tail} : {})});
  await save();
  console.log(`${verdict === 'fail' ? '✗' : verdict === 'flaky' ? '≈' : '✓'} ${suite.name} (${result.seconds}s${verdict === 'flaky' ? ', passed on retry' : ''})`);
  if (result.code !== 0 && flag('--bail')) break;
}
record.finishedAt = new Date().toISOString();
await save();
const failed = record.suites.filter(s => s.result === 'fail'), flaky = record.suites.filter(s => s.result === 'flaky');
console.log(`\n${record.suites.length - failed.length}/${record.suites.length} passed${flaky.length ? ` (${flaky.length} flaky: ${flaky.map(s => s.name).join(', ')})` : ''} → ${relative(root, join(dir, 'acceptance.json'))}`);
process.exit(failed.length ? 1 : 0);
