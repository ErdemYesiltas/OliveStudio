import {copyFile, lstat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {ExportTarget} from '@rewrite/sdk';
import type {NativeTargetFactory} from '@rewrite/build/node';
import {multiplayerProblems, serverRules, type ServerRules} from '@rewrite/multiplayer/contracts';

/**
 * "Game server" export: the bundled Colyseus server (`server.mjs`, no npm install), the rules it enforces (room,
 * players, tick, speed, bounds, spawn) and a README. Separate from the HTML export on purpose: deploying the client
 * does not deploy the server, and no credentials or presentation asset files are shipped; selected server components and scripts live in rules.json.
 */
export const serverTarget: NativeTargetFactory = {id: 'server', create(options): ExportTarget {
 let rules: ServerRules | undefined;
 return {
  id: 'server', titleKey: 'build.server',
  async validate(ctx) {
   const project = ctx.profile as Parameters<typeof serverRules>[0];
   const problems = multiplayerProblems(project);
   if (!problems.length && !(project.extensions as Record<string, {enabled?: boolean}>)['multiplayer.settings']?.enabled) problems.push('Enable multiplayer (Settings › Multiplayer) before exporting a game server');
   if (problems.length) return problems.map(message => ({owner: 'multiplayer', severity: 'error' as const, message}));
   rules = serverRules(project); return [];
  },
  async prepare() { if (!rules) throw Error('Run server preflight first'); },
  async build(ctx) {
   if (!rules) throw Error('Missing server rules');
   const bundle = join(options.template, '..', 'server', 'server.mjs'), info = await lstat(bundle).catch(() => null);
   if (!info?.isFile() || info.isSymbolicLink()) throw Error('The game server bundle is missing from this editor build (run pnpm build)');
   ctx.report('Copying the game server…'); await copyFile(bundle, join(options.stage, 'server.mjs'));
   await writeFile(join(options.stage, 'rules.json'), JSON.stringify(rules, null, 2) + '\n');
   await writeFile(join(options.stage, 'package.json'), JSON.stringify({name: 'game-server', private: true, type: 'module', scripts: {start: 'node server.mjs'}, engines: {node: '>=20'}}, null, 2) + '\n');
   await writeFile(join(options.stage, 'README.txt'), `Multiplayer game server (Colyseus ${'0.18'}). Requires Node.js 20 or newer; no npm install.\n\n  node server.mjs                 # ws://0.0.0.0:2567\n  PORT=3000 node server.mjs       # or: node server.mjs --port 3000 --host 127.0.0.1\n\nThe HTML export connects to the endpoint in Settings › Multiplayer, or to the page's host on port 2567.\nUse a reverse proxy for TLS (wss://). This server enforces rules.json: room "${rules.room}", ${rules.maxPlayers} players, ${rules.tickRate} Hz, speed ${rules.speed} px/s.\nPlayers send movement inputs only; positions are computed here. Dropped players keep their seat for ${rules.reconnectSeconds} s.\n`);
  },
  async package() { return ['server.mjs', 'rules.json', 'package.json', 'README.txt']; },
  async cleanup() {},
 };
}};
