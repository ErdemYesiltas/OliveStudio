declare module '@profile' { const Profile: import('react').ComponentType; export default Profile; }

declare module '@native-profile' { export const createNativeAssets:(parent:string,worker:string)=>Promise<import('../main/native-assets.types').NativeAssets|null>; }
declare module '@native-build-profile' { export const createNativeBuild:(template:string,assets:()=>import('../main/native-assets.types').NativeAssets|null)=>import('@rewrite/build/node').NativeBuildService|null; }
