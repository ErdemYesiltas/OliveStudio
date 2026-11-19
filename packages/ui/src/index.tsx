import {useCallback,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {defaultRangeExtractor,useVirtualizer,type Range} from '@tanstack/react-virtual';
/** Editor-only collection UI. Domain objects and serialized state stay with callers. */
export function VirtualList<T>({items,itemKey,render,estimate=36,activeKey,pinnedKeys=[],label,testId,threshold=80,resetKey}:{items:readonly T[];itemKey(item:T):string;render(item:T,index:number):ReactNode;estimate?:number;activeKey?:string|null;pinnedKeys?:readonly string[];label:string;testId:string;threshold?:number;resetKey?:string}){
 const ref=useRef<HTMLDivElement>(null),[focused,setFocused]=useState<string|null>(null);
 const enabled=items.length>threshold;
 const keys=useMemo(()=>items.map(itemKey),[items,itemKey]);
 const keyAt=useCallback((index:number)=>keys[index],[keys]);
 const activeIndex=activeKey?keys.indexOf(activeKey):-1;
 const pin=keys.flatMap((key,index)=>key===focused||pinnedKeys.includes(key)?[index]:[]);
 const rangeExtractor=(range:Range)=>[...new Set([...defaultRangeExtractor(range),...pin])].sort((a,b)=>a-b);
 const virtual=useVirtualizer({count:items.length,getScrollElement:()=>ref.current,estimateSize:()=>estimate,getItemKey:keyAt,overscan:5,enabled,rangeExtractor});
 // Selection from a canvas/Inspector must reveal an off-screen stable ID.
 useLayoutEffect(()=>{if(enabled&&activeIndex>=0)virtual.scrollToIndex(activeIndex,{align:'auto'});},[activeKey,enabled,activeIndex,virtual]);
 useLayoutEffect(()=>{if(resetKey!==undefined){if(enabled){if(activeIndex>=0)virtual.scrollToIndex(activeIndex,{align:'auto'});else virtual.scrollToOffset(0);}else if(ref.current)ref.current.scrollTop=0;}},[resetKey,virtual,enabled,activeIndex]);
 // Filtering/removal can shrink the collection while its old scroll offset is near the end.
 useLayoutEffect(()=>{const element=ref.current;if(element&&element.scrollTop>element.scrollHeight-element.clientHeight)element.scrollTop=Math.max(0,element.scrollHeight-element.clientHeight);},[items.length]);
 const row=(item:T,index:number)=>render(item,index);
 return <div ref={ref} className="collection-scroll" role="region" aria-label={label} data-testid={testId} data-total={items.length} data-virtualized={enabled} onFocusCapture={e=>setFocused((e.target as HTMLElement).closest<HTMLElement>('[data-collection-key]')?.dataset.collectionKey??null)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setFocused(null);}}>
  {enabled?<div style={{height:virtual.getTotalSize(),width:'100%',position:'relative'}}>{virtual.getVirtualItems().map(v=><div key={v.key} data-index={v.index} data-collection-key={keys[v.index]} ref={virtual.measureElement} style={{position:'absolute',top:0,left:0,width:'100%',transform:`translateY(${v.start}px)`}}>{row(items[v.index],v.index)}</div>)}</div>:items.map((item,i)=><div key={keys[i]} data-collection-key={keys[i]}>{row(item,i)}</div>)}
 </div>;
}
