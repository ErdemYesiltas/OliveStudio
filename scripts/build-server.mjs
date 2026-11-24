import {build} from 'vite';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
/**
 * Bundles the exported multiplayer server (Colyseus core, ws transport, schema and the shared netcode) into one
 * ES module that runs with plain Node.js (`node server.mjs`, no npm install). The editor copies it into server exports.
 */
export async function buildServer({outDir=resolve('apps/editor-desktop/out/server')}={}){
 await build({configFile:false,logLevel:'warn',root:resolve('.'),build:{ssr:resolve('modules/multiplayer-colyseus/src/server-main.node.ts'),outDir,emptyOutDir:true,target:'node20',minify:false,sourcemap:false,
  // Optional integrations Colyseus loads only when configured (Redis, auth, monitor, native speed-ups): never used here.
  rollupOptions:{external:id=>/^(bufferutil|utf-8-validate|msgpackr-extract|@pm2\/io|@colyseus\/(redis-|auth|monitor|playground|tools|database|cloud|loadtest|uwebsockets|h3|bun|drizzle))/.test(id),output:{format:'es',entryFileNames:'server.mjs',inlineDynamicImports:true}}},
  resolve:{alias:{express:resolve('scripts/stubs/express.mjs')}},
  ssr:{noExternal:true,target:'node'}});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await buildServer();
