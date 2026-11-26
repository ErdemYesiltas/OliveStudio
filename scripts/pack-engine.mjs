import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const dist=fileURLToPath(new URL('../modules/engine/dist/',import.meta.url));
const destination=fileURLToPath(new URL('../outputs/engine/',import.meta.url));
mkdirSync(destination,{recursive:true});
const result=spawnSync('pnpm',['pack','--pack-destination',destination],{cwd:dist,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
