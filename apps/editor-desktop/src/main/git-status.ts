/** Git porcelain -z uses literal paths (including spaces, non-ASCII, tabs and newlines). Renames have a second path. */
export function parseGitStatus(output:string):{status:string;file:string;from?:string}[]{
 const records=output.split('\0'),changes:{status:string;file:string;from?:string}[]=[];
 for(let i=0;i<records.length;i++){const row=records[i];if(!row)continue;if(row.length<4||row[2]!==' ')throw Error('Invalid Git status');
  const status=row.slice(0,2).trim()||'?',file=row.slice(3),rename=/[RC]/.test(row.slice(0,2));
  if(rename){const from=records[++i];if(!from)throw Error('Invalid Git rename status');changes.push({status,file,from});}else changes.push({status,file});
 }return changes;
}
