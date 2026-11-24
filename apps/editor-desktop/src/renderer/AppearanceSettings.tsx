import {useState} from 'react';
import {ContrastReport} from './ContrastReport';
import {useUi} from './state';
import {resolveTheme, themes, ThemeSchema} from './themes';
import {t} from './strings';
import styles from './Shell.module.css';

export function AppearanceSettings(){
 const {theme,customThemes,set}=useUi();
 const [custom,setCustom]=useState(''),[error,setError]=useState('');
 const parsed=(()=>{try{return ThemeSchema.safeParse(JSON.parse(custom));}catch{return undefined;}})();
 const resolved=resolveTheme(theme,matchMedia('(prefers-color-scheme: dark)').matches,customThemes);
 const apply=()=>{
  if(!parsed?.success){setError(t('theme.invalid'));return;}
  const value=parsed.data;
  if(themes.some(item=>item.id===value.id)){setError(t('theme.reserved'));return;}
  const list=[...customThemes.filter(item=>item.id!==value.id),value];
  localStorage.setItem('rewrite:custom-themes',JSON.stringify(list));
  set({customThemes:list,theme:value.id});
  setCustom('');
  setError('');
 };
 return <div className={styles.appearance}>
  <label>{t('theme.label')}<select value={theme} onChange={event=>set({theme:event.target.value})}>
   {[...themes,{id:'system',name:t('theme.system')},...customThemes].map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
  </select></label>
  <details><summary>{t('theme.contrast')}</summary><ContrastReport theme={resolved}/></details>
  <details><summary>{t('theme.custom')}</summary>
   <p>{t('theme.customHelp')}</p>
   <textarea aria-label={t('theme.json')} value={custom} onChange={event=>{setCustom(event.target.value);setError('');}} placeholder={JSON.stringify(themes[0],null,2)}/>
   {error&&<p role="alert" className={styles.themeError}>{error}</p>}
   {parsed?.success&&<ContrastReport theme={parsed.data}/>}
   <button onClick={apply}>{t('theme.apply')}</button>
  </details>
 </div>;
}
