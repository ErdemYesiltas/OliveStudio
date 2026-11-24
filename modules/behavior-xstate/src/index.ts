import type {ScriptExtension, ScriptSession} from '@rewrite/scripts/session';
import {behaviorType, type ActorInfo, type BehaviorControls} from '@rewrite/behavior/contracts';
// The XState UMD bundle runs inside the script sandbox only (outside the package's exports map, so by path). The host
// never imports XState: a project without Behavior components never loads this module.
import xstateSource from '../node_modules/xstate/dist/xstate.umd.min.js?raw';
export {xstateSource};
import {behaviorSandbox} from './sandbox';

export const xstateVersion = '5.33.4';
/** The Behavior provider for script sessions: XState v5 plus the actor glue, evaluated in each sandbox that needs it. */
export const xstateBehaviorExtension: ScriptExtension = {id: 'behavior.xstate', componentType: behaviorType, sources: [{file: 'xstate.js', code: xstateSource}, {file: 'behavior.js', code: behaviorSandbox}]};

/** Rule/MCP access to the behaviors of a running script session. */
export const behaviorControls = (session: () => ScriptSession | null | undefined): BehaviorControls => {
 const live = () => { const s = session(); if (!s) throw Error('Scripts are not running in this scene'); return s; };
 return {
  send: (entityId, event) => live().provider(behaviorType, 'send', {entityId, event}),
  inspect: entityId => live().provider(behaviorType, 'inspect', entityId ? {entityId} : null) as ActorInfo[],
 };
};
