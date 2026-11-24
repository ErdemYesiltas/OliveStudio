import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,symlink,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AutomationFileScope} from './automation-files';
it('confines read and new output paths to canonical granted or current-project folders',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'automation-scope-')));try{
  const allowed=join(root,'project'),outside=join(root,'outside');await mkdir(allowed);await mkdir(outside);await writeFile(join(outside,'secret.txt'),'secret');await symlink(outside,join(allowed,'escape'));
  let project:string|null=null;const scope=new AutomationFileScope(()=>project);
  await expect(scope.resolve(join(allowed,'new.pixieditor'),true)).rejects.toThrow('not granted');await scope.grant(allowed);
  expect((await scope.list(allowed)).items).toEqual([{name:'escape',path:join(allowed,'escape'),kind:'symlink'}]);await expect(scope.list(outside)).rejects.toThrow('not granted');await expect(scope.list(allowed,0,201)).rejects.toThrow('Invalid directory page');
  expect(await scope.resolve(join(allowed,'new.pixieditor'),true)).toBe(join(allowed,'new.pixieditor'));
  await expect(scope.resolve(join(allowed,'escape','secret.txt'))).rejects.toThrow('not granted');await expect(scope.resolve(join(allowed,'escape','new.pixieditor'),true)).rejects.toThrow('not granted');await expect(scope.resolve(join(allowed,'..','outside','secret.txt'))).rejects.toThrow('not granted');await expect(scope.resolve('relative.pixieditor',true)).rejects.toThrow('absolute');
  scope.revoke(scope.roots[0]);await expect(scope.resolve(join(allowed,'new.pixieditor'),true)).rejects.toThrow('not granted');
  project=join(outside,'current.pixieditor');expect(await scope.resolve(join(outside,'secret.txt'))).toBe(join(outside,'secret.txt'));
 }finally{await rm(root,{recursive:true,force:true});}
});
