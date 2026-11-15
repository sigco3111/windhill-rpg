export const EQUIP_KEYS=['sword','armor','boots'];
export const EQUIP_CAP=36;
export const EQUIP_NAMES={sword:['강철 검','기사의 검','폭풍의 검'],armor:['가죽 갑옷','철 갑옷','뼈 갑옷'],boots:['바람 부츠','폭풍 부츠','천둥 부츠']};
const count=n=>Number.isSafeInteger(n)&&n>=0;
export function validEquipment(e){if(!e||e.version!==1||!count(e.next)||e.next<1||!Array.isArray(e.items)||e.items.length>EQUIP_CAP||!e.equipped||!Array.isArray(e.rewards)||!e.rewards.every(n=>count(n)&&n<20)||new Set(e.rewards).size!==e.rewards.length||!count(e.drops))return false;const ids=new Set;for(const i of e.items){if(!i||!count(i.id)||i.id<1||i.id>=e.next||ids.has(i.id)||!EQUIP_KEYS.includes(i.key)||!Number.isInteger(i.tier)||i.tier<1||i.tier>3||!Number.isInteger(i.plus)||i.plus<0||i.plus>5)return false;ids.add(i.id)}return EQUIP_KEYS.every(k=>e.equipped[k]===null||e.items.some(i=>i.id===e.equipped[k]&&i.key===k));}
export function migrateEquipment(raw,gear={}){if(raw)return validEquipment(raw)?JSON.parse(JSON.stringify(raw)):null;const e={version:1,next:1,items:[],equipped:{sword:null,armor:null,boots:null},rewards:[],drops:0};for(const key of EQUIP_KEYS){const tier=gear[key];if(Number.isInteger(tier)&&tier>0&&tier<=3){const i={id:e.next++,key,tier,plus:0};e.items.push(i);e.equipped[key]=i.id;}}return e;}
export function equippedItem(e,key){return e?.items.find(i=>i.id===e.equipped[key]&&i.key===key)||null;}
export function gearTiers(e){return Object.fromEntries(EQUIP_KEYS.map(k=>[k,equippedItem(e,k)?.tier||0]));}
export function equipName(i){return i?`${EQUIP_NAMES[i.key][i.tier-1]} +${i.plus}`:'미장착';}
export function equipmentStats(e){const a=equippedItem(e,'sword'),b=equippedItem(e,'armor'),c=equippedItem(e,'boots');return{attack:[0,4,9,15][a?.tier||0]+(a?.plus||0)*2,defense:[0,2,4,6][b?.tier||0]+(b?.plus||0),speed:[1,1.12,1.25,1.4][c?.tier||0]+(c?.plus||0)*.02};}
export function enhanceCost(i){return i&&i.plus<5?80*i.tier*(i.plus+1)**2:null;}
export function addEquipment(e,key,tier){if(!EQUIP_KEYS.includes(key)||!Number.isInteger(tier)||tier<1||tier>3)return null;if(e.items.length>=EQUIP_CAP)return{overflowGold:10*tier,item:null};const item={id:e.next++,key,tier,plus:0};e.items.push(item);return{item,overflowGold:0};}
export function equipItem(e,id){const i=e.items.find(i=>i.id===id);if(!i)return false;e.equipped[i.key]=i.id;return true;}
export function enhanceItem(e,id,gold){const i=e.items.find(i=>i.id===id),cost=enhanceCost(i);if(cost===null||!Number.isSafeInteger(gold)||gold<cost)return null;i.plus++;return{gold:gold-cost,cost,item:i};}
export function salvageItem(e,id){const i=e.items.findIndex(i=>i.id===id);if(i<0||Object.values(e.equipped).includes(id))return null;const [item]=e.items.splice(i,1);return{gold:10*item.tier,item};}
export function equipmentDrop(e,stats){if(stats?.noLoot||stats?.windPractice)return null;e.drops++;if(!stats?.boss&&!stats?.elite&&!stats?.noRespawn&&e.drops%8!==0)return null;const key=EQUIP_KEYS[(Math.ceil(e.drops/8)-1+EQUIP_KEYS.length)%EQUIP_KEYS.length];const tier=stats?.boss?3:stats?.elite||stats?.noRespawn?2:e.drops>=80?3:e.drops>=32?2:1;return addEquipment(e,key,tier);}
const QUEST_GEAR={3:['sword',1],7:['armor',1],10:['boots',2],14:['sword',2],17:['armor',3],19:['sword',3]};
export function questEquipment(e,quest){const def=QUEST_GEAR[quest];if(!def||e.rewards.includes(quest))return null;e.rewards.push(quest);return addEquipment(e,...def);}
export function questEquipmentName(quest){const d=QUEST_GEAR[quest];return d?EQUIP_NAMES[d[0]][d[1]-1]:null;}
