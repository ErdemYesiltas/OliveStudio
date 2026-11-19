export interface RecoveryCopy {id:string;name:string;createdAt:string;warnings:string[]}
export interface RecoveryListing {copies:RecoveryCopy[];recent:{name:string}|null}
export interface PreparedRecovery {ticket:string;text:string;warnings:string[]}
export interface RecoveryPort {
 bootstrap():Promise<RecoveryListing>;
 list():Promise<RecoveryListing>;
 checkpoint(text:string,sessionId:string):Promise<{kind:'saved'|'busy';createdAt?:string;warnings?:string[]}>;
 prepare(id:string):Promise<PreparedRecovery|null>;
 accept(ticket:string):Promise<{sessionId:string;warnings:string[]}>;
 reject(ticket:string):Promise<void>;
 remove(id:string):Promise<void>;
 reopenLast():Promise<{text:string;path:string;warnings:string[]}|null>;
}
