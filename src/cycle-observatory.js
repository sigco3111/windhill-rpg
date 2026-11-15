// First journey stays unchanged. Later journeys change the response, not HP/reward.
export function observatoryCyclePlan(cycle){if(!Number.isSafeInteger(cycle)||cycle<2)return null;return[{role:'lancer',hp:40,dmg:7,label:'관측소 돌진 창병',x:57,z:4},{role:'spitter',hp:30,dmg:6,label:'관측소 독침 보초',x:65,z:5}];}
