import {copyFile,readFile,writeFile} from 'node:fs/promises';

const source=new URL('./',import.meta.url);
const {name,version,type,description,exports:sourceExports,dependencies,peerDependencies}=
 JSON.parse(await readFile(new URL('package.json',source),'utf8'));
const exports=Object.fromEntries(Object.entries(sourceExports).map(([id,entry])=>{
 const path=entry.replace('./src/','./').replace(/\.ts$/,'');
 return [id,{types:`${path}.d.ts`,import:`${path}.js`}];
}));
const manifest={name,version,type,description,exports,dependencies,peerDependencies};
await writeFile(new URL('dist/package.json',source),JSON.stringify(manifest,null,2)+'\n');
await copyFile(new URL('README.md',source),new URL('dist/README.md',source));
