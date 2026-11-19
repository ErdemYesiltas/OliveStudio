import type { Draft } from 'immer';
export interface DocumentPort<T extends object> {
 readonly current:T; readonly version:number; readonly dirty:boolean; readonly canUndo:boolean; readonly canRedo:boolean;
 subscribe(listener:()=>void):()=>void;
 transact(label:string,edit:(draft:Draft<T>)=>void):void;
 undo():void; redo():void; replace(input:unknown):void;
}
