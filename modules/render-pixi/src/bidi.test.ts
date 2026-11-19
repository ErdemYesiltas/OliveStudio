import {expect, it} from 'vitest';
import {bidiText, mirrorAlign, textStyle} from './contracts';

it('isolates right-to-left paragraphs by their first strong letter and leaves other text alone', () => {
 expect(bidiText('Hello 123!')).toBe('Hello 123!');
 expect(bidiText('مرحبا 123!')).toBe('⁨مرحبا 123!⁩');
 expect(bidiText('שלום\nHello\n\nسلام')).toBe('⁨שלום⁩\nHello\n\n⁨سلام⁩');
 expect(bidiText('Score: مرحبا')).toBe('⁨Score: مرحبا⁩');
});

it('mirrors left and right alignment in right-to-left languages', () => {
 expect(['left', 'center', 'right', 'justify'].map(a => mirrorAlign(a, true))).toEqual(['right', 'center', 'left', 'justify']);
 expect(mirrorAlign('left', false)).toBe('left');
 const p = {text: 'x', fontSize: 20, color: '#fff', font: '', fontWeight: 'normal', fontStyle: 'normal', align: 'left', letterSpacing: 0, strokeColor: '#000', strokeWidth: 0, alpha: 1} as never;
 expect(textStyle(p, 'Arial', true).align).toBe('right');
 expect(textStyle(p, 'Arial').align).toBe('left');
});
