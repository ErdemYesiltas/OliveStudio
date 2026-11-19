/** Mobile app identity (Settings → Game → Mobile app): reverse-DNS ID and the name under the icon. Shared by editor and export. */
export const mobileSection = 'mobile.app';
export interface MobileApp {version: 1; appId: string; appName: string;
 /** Library image for the home-screen icon and the splash (square works best); none keeps Capacitor's placeholder. */
 iconAssetId?: string;
 /** Splash and Android adaptive-icon background, #rrggbb. */
 splashColor?: string}
export const capacitorVersion = '8.6.0';
const appIdPattern = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/;
export const defaultMobileApp = (projectName: string): MobileApp => ({version: 1, appId: `com.example.${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/^[^a-z]+/, '') || 'game'}`, appName: projectName.trim().slice(0, 40) || 'Game'});
/** Checks stored mobile settings; problems are returned as messages. */
export function parseMobileApp(value: unknown): {app: MobileApp; errors: string[]} {
 const v = (value && typeof value === 'object' ? value : {}) as Partial<MobileApp>, errors: string[] = [];
 const appId = typeof v.appId === 'string' ? v.appId : '', appName = typeof v.appName === 'string' ? v.appName.trim() : '';
 if (!appIdPattern.test(appId)) errors.push('App ID must be reverse-DNS, lowercase, with at least three parts (com.studio.game)');
 if (!appName || appName.length > 40) errors.push('App name needs 1–40 characters');
 const iconAssetId = typeof v.iconAssetId === 'string' && v.iconAssetId ? v.iconAssetId : undefined, splashColor = typeof v.splashColor === 'string' ? v.splashColor : undefined;
 if (splashColor !== undefined && !/^#[0-9a-f]{6}$/i.test(splashColor)) errors.push('Splash colour must be #rrggbb');
 return {app: {version: 1, appId, appName, ...(iconAssetId ? {iconAssetId} : {}), ...(splashColor ? {splashColor: splashColor.toLowerCase()} : {})}, errors};
}
