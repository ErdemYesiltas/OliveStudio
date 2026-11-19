import {expect, it} from 'vitest';
import {TextSchema, BitmapTextSchema, textStyle, bitmapTextStyle} from './contracts';

it('wraps text only when asked: older documents keep one line per newline and the font line height', () => {
 const old = TextSchema.parse({alpha: 1, text: 'A long line', fontSize: 20, color: '#ffffff'});
 expect(old).toMatchObject({wordWrap: false, wrapWidth: 400, lineHeight: 0});
 expect(textStyle(old, 'sans-serif')).not.toHaveProperty('wordWrap');
 expect(textStyle(old, 'sans-serif')).not.toHaveProperty('lineHeight');
 const wrapped = TextSchema.parse({...old, wordWrap: true, wrapWidth: 320, lineHeight: 30});
 expect(textStyle(wrapped, 'sans-serif')).toMatchObject({wordWrap: true, wordWrapWidth: 320, breakWords: true, lineHeight: 30});
 expect(() => TextSchema.parse({...old, wrapWidth: 4})).toThrow();
 const bitmap = BitmapTextSchema.parse({alpha: 1, text: 'Score', fontSize: 30, color: '#ffffff', font: '', letterSpacing: 0, align: 'left', wordWrap: true, wrapWidth: 200});
 expect(bitmapTextStyle(bitmap, 'x')).toMatchObject({fontFamily: 'x', align: 'left', wordWrap: true, wordWrapWidth: 200});
});
