import { scriptConsole, type ScriptConsoleLine } from '@rewrite/scripts/console';
import { scriptDebugger, type DebugController, type DebugSettings } from '@rewrite/scripts/debug';

export type DebugSnapshot = {
  active: boolean;
  paused: boolean;
  hit: typeof scriptDebugger.hit;
  valid: Record<string, number[]>;
  instances: ReturnType<DebugController['instances']>;
  watches: string[];
  lines: readonly ScriptConsoleLine[];
};

export type DebugAction = { settings: DebugSettings } | 'resume' | 'step' | 'clearConsole';

export function connectScriptDebug(host: NonNullable<Window['oliveHost']>) {
  let last = '';
  let subscribed = false;
  const publish = () => {
    const controller = scriptDebugger.controller;
    let instances: DebugSnapshot['instances'] = [];
    let watches: string[] = [];
    if (controller && subscribed) {
      try {
        instances = controller.instances();
        watches = controller.watch(scriptDebugger.watches);
      } catch { /* The preview may be tearing down. */ }
    }
    const state: DebugSnapshot = {
      active: !!controller,
      paused: controller?.paused() ?? false,
      hit: scriptDebugger.hit,
      valid: Object.fromEntries(scriptDebugger.valid),
      instances,
      watches,
      lines: scriptConsole.lines(),
    };
    const serialized = JSON.stringify(state);
    if (serialized === last) return;
    last = serialized;
    void host.publishDebugState(state).catch(console.warn);
  };
  const offAction = host.onDebugAction(action => {
    if (action === 'clearConsole') scriptConsole.clear();
    else if (action === 'step' || action === 'resume') scriptDebugger.controller?.[action]();
    else scriptDebugger.setSettings(action.settings);
  });
  const offPanels = host.onPanels(ids => {
    subscribed = ids.includes('scripts') || ids.includes('diagnostics');
    if (subscribed) publish();
  });
  void host.panels().then(ids => {
    subscribed = ids.includes('scripts') || ids.includes('diagnostics');
    if (subscribed) publish();
  }).catch(console.warn);
  const offDebug = scriptDebugger.subscribe(publish);
  let consoleUpdate: ReturnType<typeof setTimeout> | undefined;
  const offConsole = scriptConsole.subscribe(() => {
    consoleUpdate ??= setTimeout(() => { consoleUpdate = undefined; publish(); }, 100);
  });
  const timer = setInterval(() => {
    if (subscribed && scriptDebugger.controller) publish();
  }, 300);
  return () => { clearInterval(timer); clearTimeout(consoleUpdate); offAction(); offPanels(); offDebug(); offConsole(); };
}
