import {z} from 'zod';
import type {Slot} from './index';

export type AutomationEffect = 'read' | 'edit' | 'session' | 'job';
export interface AutomationContext {signal:AbortSignal; generation:number; revision:number;report?(progress:{completed:number;total:number;message:string}):void}
/** Trusted module contributions; the scope is resource ownership, not a security sandbox. */
export interface AutomationToolDefinition {
 description:string;
 inputSchema:Record<string,unknown>;
 parse(input:unknown):unknown;
 effect:AutomationEffect;
 approval?:boolean;
 cancellable?:boolean;
 allowDuringPreview?:boolean;
 /** True for inputs that must run ahead of queued work, e.g. cancelling a pending Preview startup. */
 preempts?(input:unknown):boolean;
 /** A job which only observes resources; allowed while the editor is busy. */
 readOnly?:boolean;
 changesProject?:boolean;
 undoable?:boolean;
 outputSchema?:Record<string,unknown>;
 parseOutput?(output:unknown):unknown;
 execute(input:unknown,context:AutomationContext):unknown;
}
export const automationTools:Slot<AutomationToolDefinition>=Object.freeze({id:'editor.automation'});
export function automationTool<T>(schema:z.ZodType<T>,definition:Omit<AutomationToolDefinition,'inputSchema'|'parse'|'execute'> & {output?:z.ZodType;execute(input:T,context:AutomationContext):unknown}):AutomationToolDefinition {
 if(definition.effect==='edit'&&definition.execute.constructor.name==='AsyncFunction')throw Error('Automation document edits must be synchronous');
 const {output,...rest}=definition;
 return {...rest,...(output?{outputSchema:z.toJSONSchema(output) as Record<string,unknown>,parseOutput:(value:unknown)=>output.parse(value)}:{}),inputSchema:z.toJSONSchema(schema,{io:'input'}) as Record<string,unknown>,parse:input=>schema.parse(input),execute:(input,context)=>definition.execute(input as T,context)};
}

export {z as automationSchema} from 'zod';
