// Display preferences are device-local and separate from campaign saves.
export const DISPLAY_KEY='windhill-display-v1';
export function displayMode(value){return value==='light'?'light':'standard';}
export function readDisplay(storage){try{return displayMode(storage.getItem(DISPLAY_KEY))}catch{return'standard'}}
export function writeDisplay(storage,value){try{storage.setItem(DISPLAY_KEY,displayMode(value));return true}catch{return false}}
export function displayProfile(mode,dpr=1){const light=displayMode(mode)==='light';return{mode:light?'light':'standard',shadows:!light,pixelRatio:Math.min(Number.isFinite(dpr)&&dpr>0?dpr:1,light?1:2)}}
