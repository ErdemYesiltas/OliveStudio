import { assetImporters } from '@rewrite/assets';
import { type EditorModule } from '@rewrite/sdk';
import { imageImporter } from './catalog';
export { imageImporter } from './catalog';
export const assetPackModule:EditorModule={manifest:{id:'assetpack',version:'1.0.0',apiVersion:1,requires:{assets:'^1',pixi:'^1'},entries:{worker:'@rewrite/assetpack/node'}},activate(c){c.contribute(assetImporters,imageImporter.id,imageImporter);}};
