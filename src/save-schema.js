import {validEquipment} from './equipment.js';
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const count=v=>Number.isSafeInteger(v)&&v>=0;
const number=v=>typeof v==='number'&&Number.isFinite(v);
const optional=(v,k,check)=>v[k]===undefined||check(v[k]);
function safeTree(v,depth=0){if(depth>24)return false;if(v===null||typeof v==='boolean')return true;if(typeof v==='number')return Number.isFinite(v);if(typeof v==='string')return v.length<=10000&&!/[<>]/.test(v);if(Array.isArray(v))return v.length<=10000&&v.every(x=>safeTree(x,depth+1));if(!record(v))return false;return Object.keys(v).length<=10000&&Object.entries(v).every(([k,x])=>!['__proto__','constructor','prototype'].includes(k)&&k.length<=120&&!/[<>]/.test(k)&&safeTree(x,depth+1));}
export function validateGameSave(v,{legacy=false}={}){if(!record(v)||!safeTree(v)||!record(v.quest))return false;
if(!optional(v.quest,'idx',x=>count(x)&&x<=20)||(!legacy&&v.quest.idx===undefined)||!optional(v.quest,'state',x=>['none','active','done'].includes(x)))return false;
if(!optional(v,'level',x=>count(x)&&x>=1)||(!legacy&&v.level===undefined)||!optional(v,'skills',x=>record(x)&&Object.values(x).every(y=>typeof y==='boolean'))||(!legacy&&!record(v.skills)))return false;
for(const k of['x','z','heading'])if(!optional(v,k,number))return false;
for(const k of['hp','maxHp','playTime','xp'])if(!optional(v,k,x=>number(x)&&x>=0))return false;
for(const k of['gold','potions','kills','skKills','wKills','snakeKills','kingSnakeKills','vials','waspKills','queenWaspKills','bogSpiderKills','bogLordKills','bloodRatKills','stormWaspKills','rockSpiderKills','ruinSkelKills','ruinWarKills','ruinWardenKills','bossKills','eliteKills','flowerCount','flowersSold','skillPts','orderDone','mapFrags','trialDone','journey','observatory','courier','cartStage','echo'])if(!optional(v,k,count))return false;
if(!optional(v,'gear',g=>record(g)&&['sword','armor','boots'].every(k=>optional(g,k,x=>count(x)&&x<=3))))return false;
for(const k of['chestsOpened','shrinesPrayed','densCleared','ringsPassed'])if(!optional(v,k,x=>Array.isArray(x)&&x.every(count)))return false;
for(const k of['dex','mats'])if(!optional(v,k,x=>record(x)&&Object.values(x).every(count)))return false;
if(!optional(v,'ach',x=>record(x)&&Object.values(x).every(y=>typeof y==='boolean'))||!optional(v,'runes',x=>Array.isArray(x)&&x.every(y=>typeof y==='string')))return false;
for(const k of['beacon','estuary','bell','mist','archive','highland','canal','lightRelay','bounty','order'])if(!optional(v,k,x=>x===null||record(x)))return false;
for(const k of['startKills','goal'])if(!optional(v.quest,k,count))return false;
for(const k of['tracked','mastery','windTune','journeyEnding','insignia'])if(!optional(v,k,x=>x===null||typeof x==='string'))return false;
for(const k of['tutDone','ruinsFound','observatorySeen','sealSolved','treasureDone','watchFound','watchCleared'])if(!optional(v,k,x=>typeof x==='boolean'))return false;
if(v.order&&(!optional(v.order,'mat',x=>typeof x==='string')||!['count','reward'].every(k=>optional(v.order,k,count))))return false;
if(v.bounty&&(!optional(v.bounty,'active',x=>typeof x==='boolean')||!optional(v.bounty,'mat',x=>x===null||typeof x==='string')||!optional(v.bounty,'kind',x=>['kills','flowers','variants','elite','mats'].includes(x))||!['count','startKills','startFlowers','startVariants','startElites','startMats'].every(k=>optional(v.bounty,k,count))))return false;
if(v.equipment!==undefined&&!validEquipment(v.equipment))return false;
return true;}
