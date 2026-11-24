export const labStrings:Record<string,string>={
 'lab3d.title':'3D Lab','lab3d.experimental':'Experimental','lab3d.help':'Isolated Pixi 3D validation. Your scene is unchanged.',
 'lab3d.backend':'Backend','lab3d.start':'Start / rebuild','lab3d.stop':'Stop renderer','lab3d.play':'Play','lab3d.pause':'Pause',
 'lab3d.step':'Step 1/60','lab3d.reset':'Reset time','lab3d.seek':'Seek 1s','lab3d.freeze':'Freeze second','lab3d.remove':'Remove first'
};
export const labText=(key:string)=>labStrings[key]??key;
