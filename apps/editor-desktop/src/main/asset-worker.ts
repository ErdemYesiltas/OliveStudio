import { buildImage } from '@rewrite/assetpack/node';
import {buildAudio} from '@rewrite/audio/node';
import {buildSpine,collectSpine} from '@rewrite/spine/node';
import {buildFont} from '@rewrite/render-pixi/font.node';
import type {BuildJob} from '@rewrite/assets/node';
process.parentPort?.on('message',event=>{const job=event.data as BuildJob&{operation?:string;path?:string};const work=job.operation==='prepare'&&job.importerId==='spine.json'?collectSpine(job.path!):job.importerId==='spine.json'?buildSpine(job):job.importerId==='audio.files'?buildAudio(job):job.importerId==='pixi.fonts'?buildFont(job):buildImage(job);void work.then(result=>process.parentPort?.postMessage({ok:true,result}),error=>process.parentPort?.postMessage({ok:false,error:String(error)}));});
