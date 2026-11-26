import {expect,it} from 'vitest';
import {contrastRatio,flattenHex} from './contrast';
it('uses sRGB luminance with exact endpoints and foreground/background symmetry for opaque colors',()=>{expect(contrastRatio('#000000','#ffffff')).toBe(21);expect(contrastRatio('#ffffff','#ffffff')).toBe(1);expect(contrastRatio('#445566','#ffffff')).toBeCloseTo(contrastRatio('#ffffff','#445566'),10);expect(()=>contrastRatio('red','#ffffff')).toThrow('hex');});
it('composites transparent text/backgrounds rather than silently ignoring alpha',()=>{expect(flattenHex('#00000080','#ffffff')).toBe('#7f7f7f');expect(contrastRatio('#00000000','#ffffff')).toBe(1);expect(contrastRatio('#000000','#ffffff80','#000000')).toBeCloseTo(5.317,2);expect(()=>flattenHex('#00000000','#ffffff00')).toThrow('opaque');});
