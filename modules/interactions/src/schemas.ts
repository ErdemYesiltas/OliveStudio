import {z} from 'zod';
import {GlobalValueSchema, sameGlobal, type GlobalType, type GlobalValue} from './globals';
/** Shared rule pieces (also used by state machines). */
export const conditionOperators=['==','!=','<','<=','>','>=','contains','has']as const;
export type ConditionOperator=typeof conditionOperators[number];
/** Operators that make sense for a global's type. */
export const operatorsFor=(type:GlobalType):readonly ConditionOperator[]=>type==='number'?['==','!=','<','<=','>','>=']:type==='boolean'?['==','!=']:type==='list'?['contains','==','!=','<','<=','>','>=']:type==='object'?['has','==','!=']:['==','!=','contains'];
/** The kind of value a condition compares with: a list's item or count, an object's field name, or a value of the global's type. */
export const conditionValueKind=(type:GlobalType,op:ConditionOperator):'item'|'count'|'field'|GlobalType=>type==='list'&&op==='contains'?'item':type==='list'&&['<','<=','>','>='].includes(op)?'count':type==='object'&&op==='has'?'field':type;
export const ConditionSchema=z.object({globalId:z.string().min(1),op:z.enum(conditionOperators),value:GlobalValueSchema}).strict();
export type Condition=z.infer<typeof ConditionSchema>;
/** `to`: the value `global.set` writes; `amount`: numbers for adds, fades and shakes; `value`: on/off for objects. */
export const ActionSchema=z.object({id:z.string().min(1),type:z.string().min(1),targetId:z.string(),value:z.boolean().default(true),amount:z.number().finite().optional(),to:GlobalValueSchema.optional(),
 /** Object globals: the field `object.set` / `object.remove` change. */
 key:z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]{0,39}$/).optional(),
 /** Vectors for physics actions (px/s, px/s², world px). */
 x:z.number().finite().min(-1e6).max(1e6).optional(),y:z.number().finite().min(-1e6).max(1e6).optional()}).strict();
export type Action=z.infer<typeof ActionSchema>;
/** Whether a condition holds for a value: ordering for numbers and list counts, `contains` for text and list items, `has` for object fields. */
export function compareGlobal(v:GlobalValue,op:ConditionOperator,x:GlobalValue):boolean{
 if(op==='==')return sameGlobal(v,x);
 if(op==='!=')return !sameGlobal(v,x);
 if(op==='contains')return Array.isArray(v)?v.some(item=>sameGlobal(item,x)):typeof v==='string'&&typeof x==='string'&&v.includes(x);
 if(op==='has')return typeof v==='object'&&!Array.isArray(v)&&typeof x==='string'&&Object.prototype.hasOwnProperty.call(v,x);
 if(Array.isArray(v))v=v.length;
 if(typeof v!=='number'||typeof x!=='number')return false;
 return op==='<'?v<x:op==='<='?v<=x:op==='>'?v>x:v>=x;
}
