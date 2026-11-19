import { spawnSync } from 'node:child_process';
const result=spawnSync(process.platform==='win32'?'pnpm.cmd':'pnpm',['--filter','@rewrite/desktop','build'],{stdio:'inherit',env:{...process.env,REWRITE_PROFILE:'empty'}});process.exitCode=result.status??1;
