// OliveStudio example plugin. The editor API is on globalThis.OliveStudio: React, the contribution slots
// (panels, commands, menus, tools, createItems, components, settings), service tokens (scene, project) and notify.
const {React, slots, tokens, notify} = globalThis.OliveStudio;
const h = React.createElement;

export default {
  manifest: {id: 'user.hello-panel', version: '1.0.0', apiVersion: 1, requires: {scene: '^1'}},
  activate(c) {
    const scene = c.get(tokens.scene);
    function HelloPanel() {
      const [, redraw] = React.useReducer(n => n + 1, 0);
      React.useEffect(() => scene.document.subscribe(redraw), []);
      const objects = scene.document.current.entities;
      return h('div', {className: 'panel-body', 'data-testid': 'hello-panel'},
        h('p', null, `Hello from a plugin! This scene has ${objects.length} objects.`),
        h('ul', null, objects.map(e => h('li', {key: e.id}, e.name))));
    }
    // Contribution IDs start with the module ID.
    c.contribute(slots.panels, 'user.hello-panel.panel', {titleKey: 'Hello', icon: 'box', view: HelloPanel});
    c.contribute(slots.createItems, 'user.hello-panel.star', {titleKey: 'Plugin star', category: 'shapes', name: 'Plugin star', components: [{type: 'pixi.shape', data: {kind: 'star', width: 80, height: 80, color: '#ffd27a'}}]});
    c.contribute(slots.commands, 'user.hello-panel.count', {titleKey: 'Count objects', execute: () => notify(`${scene.document.current.entities.length} objects`)});
  },
};
