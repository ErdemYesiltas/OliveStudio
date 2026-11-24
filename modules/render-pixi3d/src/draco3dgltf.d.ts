declare module 'draco3dgltf'{
 /** Emscripten module factory; the decoder loads draco_decoder_gltf.wasm from the package folder. */
 const draco3d:{createDecoderModule(options?:Record<string,unknown>):Promise<unknown>;createEncoderModule(options?:Record<string,unknown>):Promise<unknown>};
 export default draco3d;
}
