import type {DialogueSession, DialogueView} from './index';

const css = `
[data-dialogue-box]{position:absolute;left:50%;bottom:4%;transform:translateX(-50%);width:min(92%,760px);z-index:30;box-sizing:border-box;padding:14px 18px 12px;border-radius:12px;background:rgba(10,14,24,.88);border:1px solid rgba(255,255,255,.18);color:#f3f6fb;font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.45);cursor:pointer;user-select:none}
[data-dialogue-box] .dlg-speaker{font-weight:700;font-size:13px;letter-spacing:.04em;color:#ffd27a;margin-bottom:4px;min-height:1em}
[data-dialogue-box] .dlg-text{white-space:pre-wrap;min-height:2.9em}
[data-dialogue-box] .dlg-choices{display:flex;flex-direction:column;gap:6px;margin-top:10px}
[data-dialogue-box] .dlg-choices button{all:unset;cursor:pointer;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14)}
[data-dialogue-box] .dlg-choices button:hover,[data-dialogue-box] .dlg-choices button:focus-visible{background:rgba(255,210,122,.22);border-color:#ffd27a}
[data-dialogue-box] .dlg-more{position:absolute;right:14px;bottom:8px;font-size:12px;opacity:.7;animation:dlg-bob 1s ease-in-out infinite}
@keyframes dlg-bob{50%{transform:translateY(3px)}}
[dir=rtl] [data-dialogue-box]{text-align:right}`;
/**
 * The on-screen dialogue box: speaker, text typed out (`speed` characters per second, 0 shows it at once), choices as
 * buttons. Click / Space / Enter finishes the typing, then continues; keys 1–9 pick a choice. Shared by Preview and
 * exported games; it draws over the game (DOM), never into it.
 */
export function createDialogueBox(host: HTMLElement, session: DialogueSession, options: {speed?: number} = {}) {
 const speed = options.speed ?? 50, doc = host.ownerDocument;
 if (!doc.getElementById('olive-dialogue-style')) { const style = doc.createElement('style'); style.id = 'olive-dialogue-style'; style.textContent = css; doc.head.appendChild(style); }
 if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
 const box = doc.createElement('div'), speaker = doc.createElement('div'), text = doc.createElement('div'), choices = doc.createElement('div'), more = doc.createElement('div');
 box.dataset.dialogueBox = 'true'; box.setAttribute('aria-live', 'polite');
 speaker.className = 'dlg-speaker'; text.className = 'dlg-text'; choices.className = 'dlg-choices'; more.className = 'dlg-more'; more.textContent = '▼';
 box.append(speaker, text, choices, more); box.hidden = true; host.appendChild(box);
 let current: DialogueView | null = null, shown = 0, frame = 0, last = 0;
 const typing = () => current !== null && shown < current.text.length;
 const paint = () => {
  if (!current) return;
  text.textContent = current.text.slice(0, Math.floor(shown));
  const done = !typing();
  choices.hidden = !done || !current.choices.length; more.hidden = !done || current.choices.length > 0;
  box.dataset.typing = String(!done);
 };
 const tick = (now: number) => { frame = 0; if (!current) return; shown = Math.min(current.text.length, shown + (now - last) / 1000 * speed); last = now; paint(); if (typing()) frame = requestAnimationFrame(tick); };
 const show = (view: DialogueView | null) => {
  if (frame) cancelAnimationFrame(frame); frame = 0;
  current = view; box.hidden = !view;
  // Only an open dialogue is a dialog: a hidden one must not block the editor's shortcuts (they skip open dialogs).
  if (!view) { box.removeAttribute('role'); delete box.dataset.line; return; }
  box.setAttribute('role', 'dialog');
  box.dataset.line = view.lineId; box.dataset.dialogue = view.dialogueId;
  speaker.textContent = view.speaker; speaker.hidden = !view.speaker;
  choices.replaceChildren(...view.choices.map((c, i) => { const b = doc.createElement('button'); b.type = 'button'; b.textContent = `${i + 1}. ${c.text}`; b.addEventListener('click', e => { e.stopPropagation(); session.choose(c.index); }); return b; }));
  shown = speed > 0 ? 0 : view.text.length; last = performance.now(); paint();
  if (typing()) frame = requestAnimationFrame(tick);
 };
 const next = () => { if (!current) return; if (typing()) { shown = current.text.length; paint(); return; } if (!current.choices.length) session.advance(); };
 const key = (e: KeyboardEvent) => {
  if (!current || e.defaultPrevented || e.repeat) return;
  const target = e.target as HTMLElement | null; if (target?.closest?.('input,textarea,select,[contenteditable=true]')) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); next(); return; }
  const n = Number(e.key); if (Number.isInteger(n) && n >= 1 && n <= current.choices.length && !typing()) { e.preventDefault(); session.choose(current.choices[n - 1].index); }
 };
 box.addEventListener('click', next); box.addEventListener('pointerdown', e => e.stopPropagation());
 doc.defaultView?.addEventListener('keydown', key);
 const off = session.subscribe(show); show(session.view());
 return {element: box, dispose() { off(); if (frame) cancelAnimationFrame(frame); doc.defaultView?.removeEventListener('keydown', key); box.remove(); }};
}
