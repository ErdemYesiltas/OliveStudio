import {readFile,stat} from 'node:fs/promises';
import {has3DContent,ProjectSchema} from '@rewrite/project';

export function projectMetadata(text:string){
 const parsed=ProjectSchema.safeParse(JSON.parse(text));
 if(parsed.success)return {name:parsed.data.name,scenes:parsed.data.scenes.length,visible:!has3DContent(parsed.data)};
 return {name:'',scenes:0,visible:true};
}

export async function recentProjectMetadata(path:string){
 const info=await stat(path).catch(()=>null);
 const base={modifiedAt:info?.mtimeMs??null,exists:Boolean(info),name:'',scenes:0,visible:true};
 try{
  if(info?.isFile()&&info.size<=10*1024*1024)return {...base,...projectMetadata(await readFile(path,'utf8'))};
 }catch{/* Existing recents can still be removed when the project is missing or unreadable. */}
 return base;
}
