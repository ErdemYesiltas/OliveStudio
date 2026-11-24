import {expect,it} from 'vitest';
import {parseGitStatus} from './git-status';
it('preserves literal unicode/space/newline paths and both rename names',()=>{
 expect(parseGitStatus('?? Türkçe scene.pixieditor\0 M a\tb\nc.png\0R  Yeni ad.png\0Eski ad.png\0')).toEqual([{status:'??',file:'Türkçe scene.pixieditor'},{status:'M',file:'a\tb\nc.png'},{status:'R',file:'Yeni ad.png',from:'Eski ad.png'}]);
 expect(parseGitStatus('')).toEqual([]);expect(()=>parseGitStatus('R  new\0')).toThrow('rename');
});
