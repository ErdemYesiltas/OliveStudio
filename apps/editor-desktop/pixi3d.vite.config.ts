import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
export default defineConfig({base:'./',plugins:[react()],resolve:{dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:5192,strictPort:true},build:{outDir:'out-pixi3d',rollupOptions:{input:resolve('pixi3d-lab.html')}}});
