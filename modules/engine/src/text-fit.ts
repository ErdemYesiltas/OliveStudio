/** Fits to a local width. Measurement includes the host's actual font, wrapping and stroke. */
export const textFitModes=['none','shrink','ellipsis'] as const;
export type TextFitMode=typeof textFitModes[number];

const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});

export function fitText(text:string,width:number,mode:TextFitMode,measure:(value:string)=>number){
 if(mode==='none'||!text)return {text,scale:1};
 const natural=measure(text);
 if(natural<=width)return {text,scale:1};
 if(mode==='shrink')return {text,scale:width/natural};
 const suffix='…';
 if(measure(suffix)>width)return {text:'',scale:1};
 const ends=Array.from(graphemes.segment(text),part=>part.index+part.segment.length);
 let low=0,high=ends.length-1;
 while(low<high){
  const count=Math.ceil((low+high)/2);
  if(measure(text.slice(0,ends[count-1]).trimEnd()+suffix)<=width)low=count;
  else high=count-1;
 }
 return {text:(low?text.slice(0,ends[low-1]).trimEnd():'')+suffix,scale:1};
}
