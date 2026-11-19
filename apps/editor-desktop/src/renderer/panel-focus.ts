/** Skip hidden/disabled descendants; panel content is a fallback focus target. */
export function focusPanelContent(root:HTMLElement):void{
 const visible=(node:HTMLElement)=>node.getClientRects().length>0&&!node.closest('[inert],[aria-hidden="true"],fieldset[disabled]');
 const candidates=[...root.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(visible);
 const selected=candidates.find(node=>node.getAttribute('aria-pressed')==='true'||node.getAttribute('aria-selected')==='true');(selected??candidates[0]??root).focus({preventScroll:true});
}
export function focusDockedPanel(id:string):void{requestAnimationFrame(()=>requestAnimationFrame(()=>{const root=[...document.querySelectorAll<HTMLElement>('[data-panel-content]')].find(node=>node.dataset.panelContent===id&&node.getClientRects().length>0);if(root)focusPanelContent(root);}));}
