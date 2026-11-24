import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
export default defineConfig({base:'./',plugins:[react()],resolve:{dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:5194,strictPort:true},preview:{host:'127.0.0.1',port:5194,strictPort:true},build:{assetsInlineLimit:0,outDir:'out-spatial3d',rollupOptions:{input:resolve('spatial3d.html')}}});
