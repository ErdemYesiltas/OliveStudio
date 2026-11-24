import {behaviorActions} from '@rewrite/behavior/contracts';
import {behaviorControls, xstateBehaviorExtension} from '@rewrite/behavior-xstate';
import type {ScriptExtension, ScriptSession} from '@rewrite/scripts/session';
import type {PlayerPlugin} from '../plugin';
/**
 * Behaviors (state machines) for exported games: hands XState to the scripts plugin's sandboxes and offers the
 * "Send event" rule action. Only games with Behavior components include this runtime and XState.
 */
export default {id: 'behavior', create(c) {
 c.services.set('scripts.extensions', [...(c.services.get('scripts.extensions') as ScriptExtension[] | undefined ?? []), xstateBehaviorExtension]);
 const session = () => (c.services.get('scripts.session') as (() => ScriptSession | undefined) | undefined)?.();
 return {
  actions: behaviorActions(() => session() ? behaviorControls(session) : undefined),
  dispose() { c.services.delete('scripts.extensions'); },
 };
}} satisfies PlayerPlugin;
