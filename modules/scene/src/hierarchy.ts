import type {Entity} from './index';
export interface HierarchyRow {entity:Entity;depth:number;parentIndex:number|null;hasChildren:boolean}
/** Linear adjacency + iterative preorder, preserving document order among siblings. */
export function hierarchyRows(entities:readonly Entity[]):HierarchyRow[]{
 const children=new Map<string|null,Entity[]>();for(const e of entities){const siblings=children.get(e.parentId);if(siblings)siblings.push(e);else children.set(e.parentId,[e]);}
 const output:HierarchyRow[]=[],seen=new Set<string>(),stack=[...(children.get(null)??[])].reverse().map(entity=>({entity,depth:0,parentIndex:null as number|null}));
 while(stack.length){const next=stack.pop()!;if(seen.has(next.entity.id))continue;seen.add(next.entity.id);const descendants=children.get(next.entity.id)??[],index=output.length;output.push({...next,hasChildren:descendants.length>0});for(let i=descendants.length-1;i>=0;i--)stack.push({entity:descendants[i],depth:next.depth+1,parentIndex:index});}
 return output;
}
export function hierarchyTarget(rows:readonly HierarchyRow[],current:number,key:string):number{
 if(!rows.length)return -1;const index=Math.max(0,Math.min(current,rows.length-1));
 if(key==='Home')return 0;if(key==='End')return rows.length-1;if(key==='ArrowDown')return Math.min(index+1,rows.length-1);if(key==='ArrowUp')return Math.max(index-1,0);
 if(key==='ArrowLeft')return rows[index].parentIndex??index;if(key==='ArrowRight'&&rows[index+1]?.depth>rows[index].depth)return index+1;return index;
}

/** Search authoring names/types only; retain ancestors in one reverse pass. */
export function searchHierarchy(rows:readonly HierarchyRow[],query:string):{rows:HierarchyRow[];matches:number;matchedIds:ReadonlySet<string>}{
 const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 if(!terms.length)return{rows:[...rows],matches:rows.length,matchedIds:new Set(rows.map(r=>r.entity.id))};
 const matchedIds=new Set<string>(),keep=rows.map(row=>{const text=[row.entity.name,...row.entity.components.map(c=>c.type)].join(' ').toLocaleLowerCase(),match=terms.every(term=>text.includes(term));if(match)matchedIds.add(row.entity.id);return match;});
 for(let i=rows.length-1;i>=0;i--)if(keep[i]&&rows[i].parentIndex!==null)keep[rows[i].parentIndex!]=true;
 const indices=new Map<number,number>(),output:HierarchyRow[]=[];
 rows.forEach((row,i)=>{if(!keep[i])return;indices.set(i,output.length);output.push({...row,parentIndex:row.parentIndex===null?null:indices.get(row.parentIndex)??null,hasChildren:false});});
 for(let i=0;i<output.length;i++)output[i].hasChildren=Boolean(output[i+1]&&output[i+1].depth>output[i].depth);
 return{rows:output,matches:matchedIds.size,matchedIds};
}

/** Hide folded descendants, rebuilding visible parent indices for navigation. */
export function visibleHierarchy(rows:readonly HierarchyRow[],collapsed:ReadonlySet<string>):HierarchyRow[]{
 const output:HierarchyRow[]=[],indices=new Map<number,number>();let hiddenBelow:number|null=null;
 rows.forEach((row,index)=>{if(hiddenBelow!==null&&row.depth>hiddenBelow)return;hiddenBelow=null;indices.set(index,output.length);output.push({...row,parentIndex:row.parentIndex===null?null:indices.get(row.parentIndex)??null});if(collapsed.has(row.entity.id))hiddenBelow=row.depth;});return output;
}
export function hierarchyAncestors(rows:readonly HierarchyRow[],id:string|null):string[]{
 const output:string[]=[];let index=rows.findIndex(r=>r.entity.id===id);while(index>=0&&rows[index].parentIndex!==null){index=rows[index].parentIndex!;output.push(rows[index].entity.id);}return output;
}
