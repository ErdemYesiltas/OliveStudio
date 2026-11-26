import {z} from 'zod';
import {settings,type EditorModule,type RuntimeSystem} from '@rewrite/sdk';
import {interactionTriggers, GlobalNameSchema, type InteractionCatalog, type InteractionEvent,type GlobalStore, type TriggerDefinition} from '@rewrite/interactions';

/** Project input map: named actions bound to keyboard, mouse, touch and gamepad. */
export const inputSection = 'input.map';
const Code = z.string().regex(/^[A-Za-z0-9]{1,24}$/, 'Use a KeyboardEvent.code such as Space or KeyA');
export const BindingSchema = z.discriminatedUnion('type', [
 z.object({type: z.literal('key'), code: Code}).strict(),
 z.object({type: z.literal('mouse'), button: z.number().int().min(0).max(4)}).strict(),
 z.object({type: z.literal('touch')}).strict(),
 z.object({type: z.literal('gamepadButton'), index: z.number().int().min(0).max(31)}).strict(),
 z.object({type: z.literal('keyAxis'), negative: Code, positive: Code}).strict(),
 z.object({type: z.literal('gamepadAxis'), index: z.number().int().min(0).max(7), invert: z.boolean()}).strict(),
]);
export type Binding = z.infer<typeof BindingSchema>;
const buttonBindings = new Set(['key', 'mouse', 'touch', 'gamepadButton']), axisBindings = new Set(['keyAxis', 'gamepadAxis']);
export const InputActionSchema = z.object({
 id: z.string().min(1), name: GlobalNameSchema, kind: z.enum(['button', 'axis']), bindings: z.array(BindingSchema).max(16),
 /** Axis only: the number global that receives the value (−1…1) every frame. */
 globalId: z.string().min(1).optional(),
}).strict().superRefine((a, c) => {
 const allowed = a.kind === 'button' ? buttonBindings : axisBindings;
 if (a.bindings.some(b => !allowed.has(b.type))) c.addIssue({code: 'custom', message: `A ${a.kind} action cannot use that binding`});
 if (a.kind === 'button' && a.globalId) c.addIssue({code: 'custom', message: 'Only axes write a global'});
});
export type InputAction = z.infer<typeof InputActionSchema>;
export const InputMapSchema = z.object({version: z.literal(1), deadzone: z.number().min(0).max(0.9), actions: z.array(InputActionSchema).max(64)}).strict().superRefine((m, c) => {
 if (new Set(m.actions.map(a => a.id)).size !== m.actions.length || new Set(m.actions.map(a => a.name)).size !== m.actions.length) c.addIssue({code: 'custom', message: 'Input action names and IDs must be unique'});
});
export type InputMap = z.infer<typeof InputMapSchema>;
export const defaultInputMap: InputMap = {version: 1, deadzone: 0.2, actions: []};

const actionRefs = (c: InteractionCatalog) => (c.inputActions ?? []).map(a => ({id: a.id, name: a.name}));
export const inputTriggers: TriggerDefinition[] = [
 {type: 'input.pressed', titleKey: 'interaction.inputPressed', projectReference: true, references: actionRefs},
 {type: 'input.released', titleKey: 'interaction.inputReleased', projectReference: true, references: actionRefs},
];
export const inputModule: EditorModule = {
 manifest: {id: 'input', version: '1.0.0', apiVersion: 1, requires: {interactions: '^1'}, entries: {runtime: '@rewrite/input'}},
 activate(c) {
  for (const t of inputTriggers) c.contribute(interactionTriggers, t.type, t);
  c.contribute(settings, 'input.requireCanvasFocus', {titleKey: 'setting.inputFocus', descriptionKey: 'setting.inputFocusHelp', kind: 'boolean', default: true});
 },
};

export interface InputSink {emit(event: InteractionEvent): void; setGlobal?(id: string, value: number): void}
type Pads = () => readonly (Pick<Gamepad, 'buttons' | 'axes'> | null)[];
/**
 * Turns raw input into action state. Button actions emit `input.pressed` / `input.released` on edges; axes combine
 * key pairs and gamepad sticks (deadzone, largest magnitude wins) and optionally write a number global.
 * Raw events are pure method calls so the same core runs in the editor, the player and tests.
 */
export class InputSession {
 private keyListeners=new Set<(code:string,down:boolean)=>void>();
 subscribeKeys(listener:(code:string,down:boolean)=>void){this.keyListeners.add(listener);return()=>{this.keyListeners.delete(listener);};}
 private keys = new Set<string>(); private mouse = new Set<number>(); private touches = new Set<number>(); private padButtons = new Set<number>(); private padAxes: number[] = [];
 private pressed = new Map<string, boolean>(); private values = new Map<string, number>();
 paused = false;
 constructor(private map: InputMap, private sink: InputSink, private gamepads: Pads = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [])) {
  this.map = InputMapSchema.parse(map);
 }
 /** Codes bound by any action, so the host can stop page scrolling only for keys the game uses. */
 get boundKeys(): ReadonlySet<string> { return new Set(this.map.actions.flatMap(a => a.bindings.flatMap(b => b.type === 'key' ? [b.code] : b.type === 'keyAxis' ? [b.negative, b.positive] : []))); }
 key(code: string, down: boolean) { const changed=this.keys.has(code)!==down;if(changed)for(const listener of this.keyListeners)listener(code,down);if (down) this.keys.add(code); else this.keys.delete(code); this.evaluate(); }
 pointer(id: number, kind: 'mouse' | 'touch', button: number, down: boolean) {
  if (kind === 'touch') { if (down) this.touches.add(id); else this.touches.delete(id); } else if (down) this.mouse.add(button); else this.mouse.delete(button);
  this.evaluate();
 }
 /** Once per frame: polls gamepads and refreshes axes. */
 update() {
  const pad = [...this.gamepads()].find(p => p);
  this.padButtons = new Set(pad ? pad.buttons.flatMap((b, i) => b.pressed ? [i] : []) : []);
  this.padAxes = pad ? [...pad.axes] : [];
  this.evaluate();
 }
 /** Focus loss, hidden page or Stop: nothing stays held. */
 releaseAll() { for(const code of [...this.keys])this.key(code,false);this.keys.clear(); this.mouse.clear(); this.touches.clear(); this.padButtons.clear(); this.padAxes = []; this.evaluate(); }
 isPressed(id: string) { return this.pressed.get(id) ?? false; }
 axis(id: string) { return this.values.get(id) ?? 0; }
 snapshot() { return Object.fromEntries(this.map.actions.map(a => [a.name, a.kind === 'button' ? this.isPressed(a.id) : this.axis(a.id)])); }
 private active(b: Binding): boolean {
  switch (b.type) {
   case 'key': return this.keys.has(b.code);
   case 'mouse': return this.mouse.has(b.button);
   case 'touch': return this.touches.size > 0;
   case 'gamepadButton': return this.padButtons.has(b.index);
   default: return false;
  }
 }
 private axisValue(b: Binding): number {
  if (b.type === 'keyAxis') return (this.keys.has(b.positive) ? 1 : 0) - (this.keys.has(b.negative) ? 1 : 0);
  if (b.type !== 'gamepadAxis') return 0;
  const raw = this.padAxes[b.index] ?? 0, value = Math.abs(raw) < this.map.deadzone ? 0 : raw;
  return b.invert ? -value : value;
 }
 private evaluate() {
  for (const action of this.map.actions) {
   if (action.kind === 'button') {
    const now = !this.paused && action.bindings.some(b => this.active(b)), before = this.pressed.get(action.id) ?? false;
    if (now === before) continue;
    this.pressed.set(action.id, now);
    this.sink.emit({type: now ? 'input.pressed' : 'input.released', sourceId: action.id, silent: false});
   } else {
    const value = this.paused ? 0 : Math.round(Math.max(-1, Math.min(1, action.bindings.map(b => this.axisValue(b)).reduce((best, v) => Math.abs(v) > Math.abs(best) ? v : best, 0))) * 1000) / 1000;
    if (value === (this.values.get(action.id) ?? 0) && this.values.has(action.id)) continue;
    this.values.set(action.id, value);
    if (action.globalId) this.sink.setGlobal?.(action.globalId, value);
   }
  }
 }
 /**
  * Browser wiring. Keys are read from the window only while `keyboard()` allows it (the editor requires canvas
  * focus); pointers from `target`. Bound keys do not scroll the page. Returns the disposer.
  */
 attach(target: HTMLElement, keyboard: () => boolean = () => true): () => void {
  const bound = this.boundKeys;
  const down = (e: KeyboardEvent) => { if (e.repeat || !keyboard()) return; if (bound.has(e.code)) e.preventDefault(); this.key(e.code, true); };
  const up = (e: KeyboardEvent) => { if (this.keys.has(e.code)) this.key(e.code, false); };
  const pointerDown = (e: PointerEvent) => this.pointer(e.pointerId, e.pointerType === 'touch' ? 'touch' : 'mouse', e.button, true);
  const pointerUp = (e: PointerEvent) => this.pointer(e.pointerId, e.pointerType === 'touch' ? 'touch' : 'mouse', e.button, false);
  const release = () => this.releaseAll(), visibility = () => { if (document.visibilityState === 'hidden') this.releaseAll(); };
  window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', release);
  target.addEventListener('pointerdown', pointerDown); window.addEventListener('pointerup', pointerUp); window.addEventListener('pointercancel', pointerUp);
  document.addEventListener('visibilitychange', visibility);
  return () => {
   window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', release);
   target.removeEventListener('pointerdown', pointerDown); window.removeEventListener('pointerup', pointerUp); window.removeEventListener('pointercancel', pointerUp);
   document.removeEventListener('visibilitychange', visibility);
   this.releaseAll();
  };
 }
}
/** The input connection lasts for a play session; its polling system joins each active scene. */
export function connectGameInput(map:InputMap,ports:{
 target:HTMLElement;keyboard?:()=>boolean;globals:()=>GlobalStore|undefined;
 emit(event:InteractionEvent):void;report(error:unknown):void;
}){
 const session=new InputSession(map,{
  emit:ports.emit,
  setGlobal:(id,value)=>{try{ports.globals()?.set(id,value);}catch(error){ports.report(error);}},
 });
 const detach=session.attach(ports.target,ports.keyboard);
 const system:RuntimeSystem={
  id:'input',
  start:context=>{session.paused=context?.paused??false;},
  pause:()=>{session.paused=true;},
  resume:()=>{session.paused=false;},
  update:()=>{if(!session.paused)session.update();},
  dispose(){},
 };
 return {session,system,detach};
}
/** Readable binding label for the editor UI. */
export function bindingLabel(b: Binding): string {
 const key = (code: string) => code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, 'Arrow ');
 switch (b.type) {
  case 'key': return key(b.code);
  case 'mouse': return ['Left click', 'Middle click', 'Right click', 'Mouse 4', 'Mouse 5'][b.button];
  case 'touch': return 'Touch';
  case 'gamepadButton': return `Gamepad button ${b.index}`;
  case 'keyAxis': return `${key(b.negative)} / ${key(b.positive)}`;
  case 'gamepadAxis': return `Gamepad axis ${b.index}${b.invert ? ' (inverted)' : ''}`;
 }
}
