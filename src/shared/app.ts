declare const __DEV_BUILD__: boolean | undefined;

export const APP_NAME = 'LudyRudy';
export const STORAGE_NAME = 'ludyRudy';
export const APP_ID = 'com.cujuju.ludyrudy';
export const IS_DEV_BUILD = typeof __DEV_BUILD__ !== 'undefined' && __DEV_BUILD__;

export function appIdentity(devBuild: boolean): { id: string; name: string } {
  return devBuild ? { id: `${APP_ID}.dev`, name: `${STORAGE_NAME} Dev` } : { id: APP_ID, name: STORAGE_NAME };
}
