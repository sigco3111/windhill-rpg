import{traceRelay}from'./light-relay.js';
export const BLUE_SOURCE={x:28,z:-12,dx:-1,dz:0};
export const SURVEY_TARGETS=[{bit:1,gold:'north',blue:'south',name:'산길과 마을'},{bit:2,gold:'north',blue:'east',name:'산길과 나루'},{bit:4,gold:'east',blue:'north',name:'나루와 산길'}];
export function surveyRays(mirrors){return{gold:traceRelay(mirrors),blue:traceRelay(mirrors,BLUE_SOURCE)}}
export function surveyMatch(mirrors){const r=surveyRays(mirrors);return SURVEY_TARGETS.find(t=>t.gold===r.gold.receiver&&t.blue===r.blue.receiver)||null;}
export function surveyRecord(state){if(state?.stage!==3||state.surveyClaimed)return null;const t=surveyMatch(state.mirrors);if(!t||((state.survey||0)&t.bit))return null;return{...state,survey:((state.survey||0)|t.bit)&7};}
