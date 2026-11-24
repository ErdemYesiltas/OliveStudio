import type {WorkspacePreset} from './workspace-presets';
/** Shell-owned presentation adapter. Never uses synthetic input or DOM scripting. */
export const layoutControl:{current?:{preset(value:WorkspacePreset):void;panel(id:string,mode:'open'|'close'|'pin'|'unpin'):void;state():unknown}}={};
