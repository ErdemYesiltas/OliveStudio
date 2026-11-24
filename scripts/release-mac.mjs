// Developer ID release for macOS: preflight (identity + notarization credentials), signed and notarized DMG/ZIP via
// electron-builder, then independent verification (codesign, Gatekeeper, stapled ticket) and SHA-256 checksums.
// Usage: node scripts/release-mac.mjs --check     (readiness only, builds nothing)
//        node scripts/release-mac.mjs (one app in /Applications, artifacts in release/)
// Credentials come from the environment (never from files in the repo):
//   identity      CSC_NAME="Developer ID Application: Name (TEAMID)" or CSC_LINK + CSC_KEY_PASSWORD, else the keychain
//   notarization  APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER   (App Store Connect API key, preferred)
//              or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
//              or APPLE_KEYCHAIN_PROFILE (notarytool profile stored with `xcrun notarytool store-credentials`)
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {appPath,artifacts} from './mac-app.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args=process.argv.slice(2),check=args.includes('--check'),out=artifacts;
if(args.some(a=>a!=='--check'))throw Error('Custom release folders are disabled; the app is always '+appPath);
const env = process.env, problems = [], notes = [];
const run = (cmd, argv, options = {}) => spawnSync(cmd, argv, {encoding: 'utf8', ...options});

if (process.platform !== 'darwin') problems.push('macOS is required for signing and notarization.');
const identities = process.platform === 'darwin' ? run('security', ['find-identity', '-v', '-p', 'codesigning']).stdout ?? '' : '';
const developerIds = identities.split('\n').filter(line => line.includes('Developer ID Application'));
if (env.CSC_LINK) notes.push('Identity: certificate from CSC_LINK.');
else if (env.CSC_NAME) { if (!developerIds.some(l => l.includes(env.CSC_NAME))) problems.push(`CSC_NAME "${env.CSC_NAME}" is not a valid identity in the keychain.`); else notes.push(`Identity: ${env.CSC_NAME}.`); }
else if (developerIds.length === 1) notes.push(`Identity: ${developerIds[0].replace(/^\s*\d+\)\s*[0-9A-F]+\s*/, '')}.`);
else if (developerIds.length > 1) problems.push('Several Developer ID Application identities found; set CSC_NAME to choose one.');
else problems.push('No "Developer ID Application" certificate in the keychain (and no CSC_LINK). Create one in your Apple Developer account and install it.');
const api = env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER, appleId = env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID, profile = env.APPLE_KEYCHAIN_PROFILE;
if (api) { if (!existsSync(env.APPLE_API_KEY)) problems.push(`APPLE_API_KEY file not found: ${env.APPLE_API_KEY}`); else notes.push('Notarization: App Store Connect API key.'); }
else if (appleId) notes.push('Notarization: Apple ID with an app-specific password.');
else if (profile) notes.push(`Notarization: notarytool keychain profile "${profile}".`);
else problems.push('No notarization credentials: set APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER, APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID or APPLE_KEYCHAIN_PROFILE.');
if (process.platform === 'darwin' && run('xcrun', ['--find', 'notarytool']).status !== 0) problems.push('xcrun notarytool is unavailable (install Xcode or its command line tools).');

for (const n of notes) console.log(`ok   ${n}`);
for (const p of problems) console.log(`todo ${p}`);
if (check || problems.length) { console.log(problems.length ? `\nNot ready: ${problems.length} item(s).` : '\nReady to sign and notarize.'); process.exit(check && !problems.length ? 0 : problems.length ? 1 : 0); }

const step = (label, cmd, argv, options = {}) => { console.log(`\n▶ ${label}`); const r = run(cmd, argv, {stdio: 'inherit', cwd: root, ...options}); if (r.status !== 0) { console.error(`✗ ${label} failed`); process.exit(1); } };
step('Package, sign and notarize', 'pnpm', ['--filter', '@rewrite/desktop', 'package:mac:release']);
const app=existsSync(appPath)?appPath:null;
if (!app) { console.error('✗ Packaged app not found'); process.exit(1); }
step('codesign verification', 'codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
step('Gatekeeper assessment', 'spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
for (const file of readdirSync(out).filter(f => /\.(dmg|zip)$/.test(f))) {
 if (file.endsWith('.dmg')) step(`Stapled ticket on ${file}`, 'xcrun', ['stapler', 'validate', join(out, file)]);
 console.log(`sha256 ${createHash('sha256').update(readFileSync(join(out, file))).digest('hex')}  ${file}`);
}
console.log(`\n✓ Signed, notarized and verified: ${out}`);
console.log(execFileSync('codesign', ['-dv', '--verbose=2', app], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).toString() || '');
