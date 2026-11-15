// One bounded simulation clock. Extra wall time is discarded, never caught up.
// Rendering FPS and physical input-hold gestures keep their own wall clock.
export function createGameClock(){let elapsedTime=0,discardedSeconds=0;return{get elapsedTime(){return elapsedTime},get discardedSeconds(){return discardedSeconds},advance(realSeconds,hidden=false){if(!Number.isFinite(realSeconds)||realSeconds<=0)return 0;const dt=hidden?0:Math.min(realSeconds,.05);elapsedTime+=dt;discardedSeconds+=realSeconds-dt;return dt;}};}
