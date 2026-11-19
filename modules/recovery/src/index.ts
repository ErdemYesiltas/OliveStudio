import {settings,panels,overlays,type EditorModule} from '@rewrite/sdk';
import {projectToken,type ProjectService} from '@rewrite/project';
import type {RecoveryPort,RecoveryListing} from './contracts';
export type * from './contracts';
export class RecoveryController {
 state={enabled:true,status:'idle' as 'idle'|'saving'|'saved'|'error',createdAt:'',warnings:[] as string[],error:'',listing:{copies:[],recent:null} as RecoveryListing};
 private listeners=new Set<()=>void>();private timer:ReturnType<typeof setTimeout>|undefined;private first=0;private running=false;private disposed=false;private off:()=>void;
 constructor(private project:ProjectService,private options:{port:RecoveryPort;serialize():string;sessionId():string;blocked():boolean;enabled?:boolean;delay?:number;maxDelay?:number},listing:RecoveryListing){this.state={...this.state,enabled:options.enabled!==false,listing};this.off=project.document.subscribe(()=>this.schedule());}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private publish(){this.state={...this.state};for(const fn of this.listeners)fn();}
 setEnabled(value:boolean){this.state.enabled=value;if(!value){clearTimeout(this.timer);this.first=0;}this.publish();if(value)this.schedule();}
 private schedule(){if(this.disposed||!this.state.enabled||!this.project.document.dirty){clearTimeout(this.timer);this.first=0;if(!this.disposed&&!this.project.document.dirty&&this.state.status!=='idle'){this.state.status='idle';this.state.createdAt='';this.state.error='';this.state.warnings=[];this.publish();}return;}const now=Date.now();this.first||=now;clearTimeout(this.timer);this.timer=setTimeout(()=>{void this.checkpoint(false);},Math.max(0,Math.min(this.options.delay??2000,(this.options.maxDelay??30000)-(now-this.first))));}
 async checkpoint(manual=true){clearTimeout(this.timer);if(this.disposed||this.running||!manual&&!this.state.enabled||!this.project.document.dirty)return;if(this.options.blocked()){this.first=0;this.schedule();return;}
  this.running=true;this.first=0;const version=this.project.document.version,generation=this.project.generation,scope=this.options.sessionId();this.state.status='saving';this.publish();let retry=false;
  try{const result=await this.options.port.checkpoint(this.options.serialize(),scope);if(this.disposed||generation!==this.project.generation||scope!==this.options.sessionId())return;if(result.kind==='busy'){retry=true;this.state.status='idle';}else{this.state.status='saved';this.state.createdAt=result.createdAt??'';this.state.warnings=result.warnings??[];this.state.error='';}}
  catch(error){if(!this.disposed&&generation===this.project.generation){this.state.status='error';this.state.error=error instanceof Error?error.message:String(error);}}
  finally{this.running=false;if(!this.disposed){this.publish();if(retry||version!==this.project.document.version)this.schedule();}}
 }
 async refresh(){const listing=await this.options.port.list();if(!this.disposed){this.state.listing=listing;this.publish();}}
 dispose(){this.disposed=true;clearTimeout(this.timer);this.off();this.listeners.clear();}
}
export function recoveryModule(options:{port:RecoveryPort;listing:RecoveryListing;serialize():string;sessionId():string;blocked():boolean;enabled:boolean;views(controller:RecoveryController):{Panel:unknown;Startup:unknown}}):EditorModule{return {manifest:{id:'recovery',version:'1.0.0',apiVersion:1,requires:{project:'^1'}},activate(c){c.contribute(settings,'recovery.enabled',{titleKey:'setting.recovery',descriptionKey:'setting.recoveryHelp',kind:'boolean',default:true});const controller=new RecoveryController(c.get(projectToken),options,options.listing);c.own(()=>controller.dispose());const views=options.views(controller);c.contribute(panels,'recovery.panel',{titleKey:'panel.recovery',icon:'activity',shortcut:'Alt+R',view:views.Panel});c.contribute(overlays,'recovery.startup',{view:views.Startup});}};}
