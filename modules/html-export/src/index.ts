import {type EditorModule} from '@rewrite/sdk';
import {buildTargets} from '@rewrite/build';
export const htmlExportModule:EditorModule={manifest:{id:'html-export',version:'1.0.0',apiVersion:1,requires:{build:'^1'},entries:{main:'@rewrite/html-export/node'}},activate(c){c.contribute(buildTargets,'html-export.target',{id:'html',titleKey:'build.html',nativeEntry:'@rewrite/html-export/node'});c.contribute(buildTargets,'html-export.mobile',{id:'mobile',titleKey:'build.mobile',nativeEntry:'@rewrite/html-export/mobile-node'});}};
