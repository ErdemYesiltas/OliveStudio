import { z } from 'zod';
export const ColorsSchema = z.object({ bg: z.string(), surface: z.string(), raised: z.string(), text: z.string(), muted: z.string(), border: z.string(), accent: z.string(), danger: z.string(), viewport: z.string(), focus:z.string().optional() }).strict();
const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
export const ThemeSchema = z.object({ id:z.string().regex(/^[a-z][a-z0-9-]{1,47}$/),name:z.string().min(1).max(60),scheme:z.enum(['dark','light']),colors: ColorsSchema.extend({ bg:color,surface:color,raised:color,text:color,muted:color,border:color,accent:color,danger:color,viewport:color,focus:color.optional() }) }).strict();
export type Theme = z.infer<typeof ThemeSchema>;
export const themes: Theme[] = [
 {id:'graphite',name:'Graphite',scheme:'dark',colors:{bg:'#232426',surface:'#292a2d',raised:'#34363a',text:'#e8e8e5',muted:'#a4a6ac',border:'#414348',accent:'#b1c58a',focus:'#b1c58a',danger:'#f49a9a',viewport:'#1b1d20'}},
 {id:'light',name:'Light',scheme:'light',colors:{bg:'#f5f5f2',surface:'#ffffff',raised:'#e9eaed',text:'#25282e',muted:'#5c626d',border:'#d7d9de',accent:'#2b61ae',focus:'#2b61ae',danger:'#a83e3e',viewport:'#e1e3e6'}},
 {id:'warm',name:'Warm',scheme:'light',colors:{bg:'#f5f0e8',surface:'#fcf8f2',raised:'#e8e0d5',text:'#342b2b',muted:'#6f5e59',border:'#dfd2c7',accent:'#6c5a82',focus:'#6c5a82',danger:'#a3443b',viewport:'#e9e0d5'}},
];
export function resolveTheme(choice: string, dark: boolean, custom: Theme[] = []): Theme {
 return [...themes,...custom].find(t => t.id === (choice === 'system' ? dark ? 'graphite' : 'light' : choice)) ?? themes[0];
}
export function applyTheme(theme: Theme): void {
 document.documentElement.style.colorScheme = theme.scheme; document.documentElement.dataset.theme = theme.id;
 for (const [key,value] of Object.entries({...theme.colors,focus:theme.colors.focus??theme.colors.accent})) document.documentElement.style.setProperty(`--${key}`,value);
}
