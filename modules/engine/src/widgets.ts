import { ButtonContainer, CheckBox, List, ProgressBar, RadioGroup, ScrollBox, Slider } from '@pixi/ui';
import { Container, Graphics, Text, Ticker, type DestroyOptions } from 'pixi.js';
import { z } from 'zod';

export const widgetKinds = ['button', 'slider', 'progress', 'list', 'scrollBox', 'radio', 'checkbox', 'switch'] as const;
export const widgetSchema = z.strictObject({
  kind: z.enum(widgetKinds).default('button'),
  width: z.number().min(24).max(2000).default(180),
  height: z.number().min(16).max(2000).default(42),
  text: z.string().max(120).default('Button'),
  items: z.array(z.string().max(120)).max(50).default(['Item 1', 'Item 2', 'Item 3']),
  value: z.number().min(0).max(100).default(50),
  checked: z.boolean().default(false),
  background: z.string().regex(/^#[0-9a-f]{6}$/i).default('#27343e'),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i).default('#a7d88b'),
  textColor: z.string().regex(/^#[0-9a-f]{6}$/i).default('#ffffff'),
  globalId: z.string().default(''),
}).prefault({});

export type WidgetData = z.output<typeof widgetSchema>;
export type WidgetValue = number | boolean;

export function widgetGlobalType(kind: WidgetData['kind']): 'number' | 'boolean' | undefined {
  if (kind === 'button' || kind === 'checkbox' || kind === 'switch') return 'boolean';
  if (kind === 'slider' || kind === 'progress' || kind === 'radio') return 'number';
}

class WidgetScrollBox extends ScrollBox {
  constructor(options: NonNullable<ConstructorParameters<typeof ScrollBox>[0]>, ticker: Ticker) {
    super(options);
    // ScrollBox registers an update on Pixi's shared ticker by default.
    this.ticker.remove(this.update, this);
    this.ticker = ticker;
    ticker.add(this.update, this);
  }

  destroy(options?: DestroyOptions) {
    if (options === true || (typeof options === 'object' && options.children)) {
      for (const item of [...this.items]) item.destroy(options);
    }
    super.destroy(options);
  }
}

export function createWidget(data: WidgetData, options: { ticker?: Ticker; change?: (value: WidgetValue) => void } = {}) {
  const { width, height, background, accent, textColor } = data;
  const view = new Container();
  const labelStyle = { fontFamily: 'system-ui', fontSize: Math.min(18, height * 0.46), fill: textColor };
  const plate = (w: number, h: number, color: string) => new Graphics().roundRect(0, 0, w, h, Math.min(6, h / 2)).fill(color);
  const label = (text: string) => new Text({ text, style: labelStyle });
  const row = (text: string, rowHeight: number) => {
    const item = new Container();
    const title = label(text);
    title.position.set(8, (rowHeight - title.height) / 2);
    item.addChild(plate(width, rowHeight, background), title);
    return item;
  };
  const mark = (checked: boolean, toggle: boolean) => {
    const size = Math.min(height, 40), w = toggle ? size * 1.65 : size;
    const g = plate(w, size, checked ? accent : background);
    if (toggle) {
      g.circle(checked ? w - size / 2 : size / 2, size / 2, size * 0.32).fill(checked ? background : textColor);
    } else if (checked) {
      g.moveTo(size * 0.22, size * 0.5).lineTo(size * 0.42, size * 0.7)
        .lineTo(size * 0.76, size * 0.32).stroke({ width: 2, color: background });
    }
    return g;
  };
  const check = (text: string, checked: boolean, toggle = false) => new CheckBox({
    text, checked, style: { unchecked: mark(false, toggle), checked: mark(true, toggle), text: labelStyle },
  });
  let syncing = false;
  const changed = (value: WidgetValue) => { if (!syncing) options.change?.(value); };
  let applyValue: ((value: WidgetValue) => void) | undefined;
  switch (data.kind) {
    case 'button': {
      const button = new ButtonContainer(row(data.text, height));
      button.onPress.connect(() => changed(true));
      view.addChild(button);
      break;
    }
    case 'checkbox':
    case 'switch': {
      const checkbox = check(data.text, data.checked, data.kind === 'switch');
      checkbox.onChange.connect(value => changed(Boolean(value)));
      applyValue = value => { if (typeof value === 'boolean') checkbox.forceCheck(value); };
      view.addChild(checkbox);
      break;
    }
    case 'slider':
    case 'progress': {
      const bar = { bg: plate(width, height, background), fill: plate(width, height, accent) };
      if (data.kind === 'slider') {
        const knob = new Graphics().circle(height / 2, height / 2, height * 0.44).fill(textColor);
        const slider = new Slider({ ...bar, slider: knob, min: 0, max: 100, step: 1, value: data.value });
        slider.onChange.connect(changed);
        applyValue = value => { if (typeof value === 'number') slider.value = Math.min(100, Math.max(0, value)); };
        view.addChild(slider);
      } else {
        const progress = new ProgressBar({ ...bar, progress: data.value });
        applyValue = value => { if (typeof value === 'number') progress.progress = Math.min(100, Math.max(0, value)); };
        view.addChild(progress);
      }
      break;
    }
    case 'radio': {
      const group = new RadioGroup({
        items: data.items.map(text => check(text, false)), type: 'vertical', elementsMargin: 5,
        selectedItem: Math.max(0, Math.min(data.items.length - 1, Math.round(data.value))),
      });
      group.onChange.connect(index => changed(index));
      applyValue = value => {
        if (typeof value === 'number') group.selectItem(Math.max(0, Math.min(data.items.length - 1, Math.round(value))));
      };
      view.addChild(group);
      break;
    }
    case 'list':
      view.addChild(new List({ type: 'vertical', elementsMargin: 4, children: data.items.map(item => row(item, height)) }));
      break;
    case 'scrollBox': {
      const scroll = new WidgetScrollBox({
        width, height, type: 'vertical', background, globalScroll: false, elementsMargin: 3, disableEasing: true,
        disableProximityCheck: true,
      }, options.ticker ?? Ticker.shared);
      scroll.addItems(data.items.map(item => row(item, 32)));
      view.addChild(scroll);
      break;
    }
  }
  return {
    view,
    setValue(value: WidgetValue) {
      syncing = true;
      try { applyValue?.(value); } finally { syncing = false; }
    },
  };
}
