import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// ---------- 기본 씬 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5d9);
scene.fog = new THREE.Fog(0x87b5d9, 40, 120);

// ---------- 날씨 (비) ----------
const RAIN_N = 700;
const rainGeo = new THREE.BufferGeometry();
{
  const arr = new Float32Array(RAIN_N * 3);
  for (let i = 0; i < RAIN_N; i++) {
    arr[i * 3] = (Math.random() - 0.5) * 40;
    arr[i * 3 + 1] = Math.random() * 18;
    arr[i * 3 + 2] = (Math.random() - 0.5) * 40;
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
}
const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0x9db8d8, size: 0.12, transparent: true, opacity: 0.75 }));
rain.visible = false;
rain.frustumCulled = false;
scene.add(rain);
const weather = { mode: 'clear', until: 0, nextAt: 70 + Math.random() * 60 };
const _skyCol = new THREE.Color();
function updateWeather(dt, now) {
  if (weather.mode === 'clear' && now >= weather.nextAt) {
    weather.mode = 'rain';
    weather.until = now + 35 + Math.random() * 15;
    toast('비가 내리기 시작합니다');
  } else if (weather.mode === 'rain' && now >= weather.until) {
    weather.mode = 'clear';
    weather.nextAt = now + 80 + Math.random() * 80;
    toast('비가 그쳤습니다');
  }
  const raining = weather.mode === 'rain';
  rain.visible = raining;
  _skyCol.setHex(raining ? 0x5f7a8d : 0x87b5d9);
  scene.background.lerp(_skyCol, Math.min(1, dt * 0.8));
  scene.fog.color.copy(scene.background);
  if (raining && state.player) {
    rain.position.copy(state.player.position);
    const arr = rainGeo.attributes.position.array;
    for (let i = 0; i < RAIN_N; i++) {
      arr[i * 3 + 1] -= 14 * dt;
      if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] += 18;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }
}

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 300);
// 세로 화면(모바일 포트레잇)에서는 수평 시야가 좁아지므로 FOV를 넓힘
function applyCamFraming() {
  const portrait = innerWidth / innerHeight < 0.9;
  camera.fov = portrait ? 72 : 55;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
applyCamFraming();

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x6a8a5a, 0.9));
const sun = new THREE.DirectionalLight(0xfff3dd, 1.6);
sun.position.set(20, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, far: 90 });
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(80, 48),
  new THREE.MeshLambertMaterial({ color: 0x7fae62 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---------- 로딩 유틸 ----------
const gltfLoader = new GLTFLoader();
// 로딩 진행 표시: 추적 대상 로드 수/완료 수를 #loadmsg에 반영
let loadTotal = 0, loadDone = 0;
function updLoading() {
  const el = document.getElementById('loadmsg');
  if (el) el.textContent = loadTotal ? `불러오는 중… ${loadDone}/${loadTotal}` : '불러오는 중…';
}
function track(p) {
  loadTotal++; updLoading();
  return p.then((v) => { loadDone++; updLoading(); return v; }, (e) => { loadDone++; updLoading(); throw e; });
}
const load = (url) => track(new Promise((res, rej) => gltfLoader.load(url, res, undefined, rej)));
async function loadObj(base) {
  // 로더는 호출마다 새로 생성 (공유 시 병렬 로드에서 재질이 섞임)
  const mtlLoader = new MTLLoader();
  const objLoader = new OBJLoader();
  const mtl = await track(mtlLoader.loadAsync(`assets/village/${base}.mtl`));
  mtl.preload();
  // OBJ 안의 라인(l)/포인트(p) 요소는 버린다: OBJLoader는 객체에 'l' 요소가 하나라도
  // 있으면 해당 객체 전체를 LineSegments로 만들어 면이 와이어프레임처럼 보이는 문제가 있음
  const objText = await (await track(fetch(`assets/village/${base}.obj`))).text();
  const stripped = objText.split('\n').filter((l) => !/^[lp] /.test(l)).join('\n');
  const obj = objLoader.setMaterials(mtl).parse(stripped);
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        m.side = THREE.DoubleSide; // Quaternius OBJ 일부 면이 안쪽을 향해 컬링되는 문제 방지
        // Blender MTL의 Kd는 이미 리니어 값인데 MTLLoader가 sRGB로 간주해 리니어로 변환하면서
        // 이중으로 어두워짐 → 변환을 되돌려 원래 리니어 값을 복원
        if (m.color) m.color.convertLinearToSRGB();
        if ('specular' in m) m.specular.setScalar(0.03);
        if ('shininess' in m) m.shininess = 4;
      }
    }
  });
  return obj;
}

function shadowify(root) {
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return root;
}

// ---------- 애니메이션 ----------
class AnimSet {
  constructor(root, clips) {
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    this.names = clips.map((c) => c.name);
    for (const c of clips) this.actions[c.name] = this.mixer.clipAction(c);
    this.current = null;
  }
  find(...keys) {
    for (const k of keys) {
      const exact = this.names.find((x) => x.toLowerCase() === k.toLowerCase());
      if (exact) return exact;
      const n = this.names.find((x) => x.toLowerCase().includes(k.toLowerCase()));
      if (n) return n;
    }
    return null;
  }
  play(...keys) {
    const n = this.find(...keys);
    if (!n || this.current === n) return this.actions[this.current];
    const next = this.actions[n];
    next.reset().fadeIn(0.15).play();
    if (this.current) this.actions[this.current].fadeOut(0.15);
    this.current = n;
    return next;
  }
  playOnce(...keys) {
    const n = this.find(...keys);
    if (!n) return null;
    const a = this.actions[n];
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.fadeIn(0.08).play();
    if (this.current && this.current !== n) this.actions[this.current].fadeOut(0.08);
    this.current = n;
    return a;
  }
  clipDuration(...keys) {
    const n = this.find(...keys);
    return n ? this.actions[n].getClip().duration : 0.5;
  }
  update(dt) { this.mixer.update(dt); }
}

// ---------- 오디오 (Kenney RPG Audio / Impact Sounds, ansimuz Chiptune: Exploration — 모두 CC0) ----------
const audio = { ctx: null, buffers: {}, muted: false, musicOn: false, stepAt: 0, stepN: 0 };
const AUDIO_FILES = {
  swing1: 'assets/audio/knifeSlice.ogg', swing2: 'assets/audio/knifeSlice2.ogg',
  hit1: 'assets/audio/impactPunch_medium_000.ogg', hit2: 'assets/audio/impactPunch_medium_001.ogg',
  death: 'assets/audio/impactSoft_heavy_000.ogg', hurt: 'assets/audio/impactPunch_heavy_000.ogg',
  reward: 'assets/audio/handleCoins.ogg', dialog: 'assets/audio/bookOpen.ogg',
  step1: 'assets/audio/footstep_grass_000.ogg', step2: 'assets/audio/footstep_grass_001.ogg',
  step3: 'assets/audio/footstep_grass_002.ogg', step4: 'assets/audio/footstep_grass_003.ogg',
  music: 'assets/audio/exploration.ogg',
};
function initAudio() {
  if (audio.ctx) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
  try {
    audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = 0.8;
    audio.master.connect(audio.ctx.destination);
    audio.musicGain = audio.ctx.createGain();
    audio.musicGain.gain.value = 0.3;
    audio.musicGain.connect(audio.master);
    for (const [k, url] of Object.entries(AUDIO_FILES)) {
      fetch(url).then((r) => r.arrayBuffer()).then((ab) => audio.ctx.decodeAudioData(ab))
        .then((buf) => { audio.buffers[k] = buf; if (k === 'music') startMusic(); })
        .catch((e) => console.warn('audio load fail', k, e));
    }
  } catch (e) { console.warn('audio init fail', e); }
}
function sfx(key, vol = 1) {
  if (!audio.ctx || audio.muted || !audio.buffers[key]) return;
  const src = audio.ctx.createBufferSource();
  src.buffer = audio.buffers[key];
  src.playbackRate.value = 0.95 + Math.random() * 0.1;
  const g = audio.ctx.createGain();
  g.gain.value = vol;
  src.connect(g); g.connect(audio.master);
  src.start();
}
function startMusic() {
  if (!audio.ctx || audio.musicOn || !audio.buffers.music) return;
  const src = audio.ctx.createBufferSource();
  src.buffer = audio.buffers.music;
  src.loop = true;
  src.connect(audio.musicGain);
  src.start();
  audio.musicOn = true;
}
// 소리 토글 버튼 (#snd) — 초기 상태는 '소리 끔'(아직 AudioContext 미생성, 첫 입력 후 재생)
window.__audio = audio; // 검증용
const sndBtn = document.getElementById('snd');
function syncSndBtn() { sndBtn.textContent = audio.muted ? '소리 켜기' : '소리 끄기'; }
sndBtn.textContent = '소리 켜기';
sndBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  initAudio();
  audio.muted = !audio.muted;
  if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.8;
  syncSndBtn();
});
addEventListener('pointerdown', () => { initAudio(); if (!audio.muted) syncSndBtn(); }, { passive: true });
addEventListener('keydown', () => { initAudio(); if (!audio.muted) syncSndBtn(); });

// ---------- 입력 ----------
const keys = new Set();
addEventListener('keydown', (e) => {
  if (state.menuOpen) { if (e.code === 'Escape') closeMenu(); return; } // 메뉴 표시 중 게임 키 차단
  if (e.code === 'Escape') { openMenu(); return; }
  keys.add(e.code);
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) state.chargeStart = performance.now(); // 누르고 있으면 강공격 충전
  }
  if (e.code === 'KeyE') tryInteract();
  if (e.code === 'KeyQ') tryDodge();
  if (e.code === 'KeyR') usePotion();
  if (e.code === 'KeyT') toggleAuto();
  if (e.code === 'KeyI') toggleInv();
  if (e.code === 'KeyM') toggleMinimap();
  if (e.code === 'KeyN') cycleTrack();
  if (e.code === 'KeyL' && !state.menuOpen && !state.dialog) openCampaignJournal();
  if (e.code === 'KeyJ' && !state.menuOpen && !state.dialog) openJourneyJournal();
  if (e.code === 'KeyF') tryWhirl();
  if (e.code === 'KeyG' && !e.repeat) tryWindshot();
  if (e.code === 'KeyK') toggleSkillTree();
});
addEventListener('keyup', (e) => {
  if (e.code === 'Space' && state.chargeStart >= 0) {
    const held = performance.now() - state.chargeStart;
    state.chargeStart = -1;
    tryAttack(held >= 450);
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));

const stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
const look = { active: false, id: -1, lx: 0, ly: 0 };
let camYaw = Math.PI, camPitch = 0.32;
let drag = null; // {x, y, t, moved}

addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false }; });
addEventListener('mouseup', (e) => {
  if (drag && !drag.moved && performance.now() - drag.t < 300) tryAttack();
  drag = null;
});
addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
  if (drag.moved) {
    camYaw -= dx * 0.005;
    camPitch = THREE.MathUtils.clamp(camPitch + dy * 0.003, 0.05, 1.1);
    drag.x = e.clientX; drag.y = e.clientY;
  }
});
const atkBtn = document.getElementById('atk');
atkBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); state.chargeStart = performance.now(); }, { passive: true });
atkBtn.addEventListener('touchend', (e) => {
  e.stopPropagation();
  if (state.chargeStart >= 0) {
    const held = performance.now() - state.chargeStart;
    state.chargeStart = -1;
    tryAttack(held >= 450);
  }
});
document.getElementById('dodge').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); tryDodge(); }, { passive: false });
document.getElementById('dodge').addEventListener('click', (e) => { e.stopPropagation(); tryDodge(); });
document.getElementById('pot').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); usePotion(); }, { passive: false });
document.getElementById('pot').addEventListener('click', (e) => { e.stopPropagation(); usePotion(); });
document.getElementById('auto').addEventListener('click', (e) => { e.stopPropagation(); toggleAuto(); });
document.getElementById('auto').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); toggleAuto(); }, { passive: false });
document.getElementById('inv').addEventListener('click', (e) => { e.stopPropagation(); toggleInv(); });
document.getElementById('quest').addEventListener('click', (e) => { e.stopPropagation(); cycleTrack(); });
document.getElementById('quest').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); cycleTrack(); }, { passive: false });
document.getElementById('skill').addEventListener('click', (e) => { e.stopPropagation(); toggleSkillTree(); });
document.getElementById('skill').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); toggleSkillTree(); }, { passive: false });
document.getElementById('whirl').addEventListener('click', (e) => { e.stopPropagation(); tryWhirl(); });
document.getElementById('whirl').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); tryWhirl(); }, { passive: false });
document.getElementById('inv').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); toggleInv(); }, { passive: false });
addEventListener('touchstart', (e) => {
  for (const t of e.changedTouches) {
    if (t.target && t.target.id === 'atk') continue;
    if (t.clientX < innerWidth / 2 && stick.id === -1) {
      stick.id = t.identifier; stick.active = true;
      stick.ox = t.clientX; stick.oy = t.clientY; stick.x = 0; stick.y = 0;
    } else if (look.id === -1) {
      look.id = t.identifier; look.active = true; look.lx = t.clientX; look.ly = t.clientY;
    }
  }
}, { passive: false });
addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === stick.id) {
      const dx = (t.clientX - stick.ox) / 45, dy = (t.clientY - stick.oy) / 45;
      const m = Math.hypot(dx, dy) || 1, c = Math.min(m, 1) / m;
      stick.x = dx * c; stick.y = dy * c;
    } else if (t.identifier === look.id) {
      camYaw -= (t.clientX - look.lx) * 0.007;
      camPitch = THREE.MathUtils.clamp(camPitch + (t.clientY - look.ly) * 0.004, 0.05, 1.1);
      look.lx = t.clientX; look.ly = t.clientY;
    }
  }
}, { passive: false });
addEventListener('touchend', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === stick.id) { stick.id = -1; stick.active = false; stick.x = 0; stick.y = 0; }
    if (t.identifier === look.id) { look.id = -1; look.active = false; }
  }
});

// ---------- 게임 상태 ----------
const state = {
  ready: false, player: null, anim: null, enemies: [], npc: null,
  heading: 0, hp: 100, maxHp: 100, dead: false,
  attackUntil: 0, attackCdUntil: 0, didHit: false, kills: 0, skKills: 0, wKills: 0,
  dialog: false, tutDone: false, attacksDone: 0,
  gold: 0, potions: 0, potCdUntil: 0, invUntil: 0, dodgeUntil: 0, dodgeCdUntil: 0, dodgeCount: 0,
  dodgeDir: new THREE.Vector3(0, 0, 1), autoOn: false, chargeStart: -1, attackStrong: false,
  windCdUntil: 0, windshot: null, mastery: null, masteryChain: null, skillPts: 0, skills: {}, whirlCdUntil: 0, bladeUntil: 0, poisonUntil: 0, poisonTickAt: 0,
  bossKills: 0, eliteKills: 0, flowers: null, flowerCount: 0, flowersSold: 0, boss: null, dex: {}, mats: {}, dlgFocus: null, order: null, orderDone: 0, // 도감: 종류별 처치 수 / mats: 재료 보유 / dlgFocus: 대화 상대 위치 / order: 수집가 특별 주문
  level: 1, xp: 0, echo: 0, cartStage: 0, courier: 0, insignia: null, estuary: {stage:0,rescued:0,bossWon:false}, bell:{stage:0,clues:0,input:0}, windTune:null, mist:{stage:0,lamps:0}, archive:{stage:0,read:false,input:0,shelf:false,valves:0,wave:0,ending:null},
  bounty: { active: false, startKills: 0, count: 0 }, tracked: 'auto', chests: null, chestsOpened: [], shrines: null, shrinesPrayed: [], trial: null, trialDone: 0,
  mapFrags: 0, treasureDone: false, treasure: null, chestProto: null, chestScale: 1, // 숨겨진 보물: 지도 조각 수집 → 보물 위치 공개
  dens: null, densCleared: [], // 몬스터 소굴: 접근 시 매복 스폰, 전멸 시 보상(1회성)
  watch: null, watchFound: false, watchCleared: false, // 버려진 망루: 발견(30m 접근) + 수호대장 격파(1회성)
  golden: null, // 황금 쥐: { nextAt, active, until }
  rings: null, ringsPassed: [], // 바람의 고리: 5곳 통과 탐험 요소
  gear: { sword: 0, armor: 0, boots: 0 }, // 장비 등급 0~2
  ach: {}, // 달성한 업적 id → true
  quest: { idx: 0, state: 'none', startKills: 0 }, // idx: QUESTS 순번, state: none → active → done
  playTime: 0, menuOpen: false, // playTime: dt상한 누적 시뮬레이션 초 (실제 경과 아님) / menuOpen: 메뉴 대시보드 표시 중
};
// 장비 효과표 (등급 0=없음)
const GEAR_ATK = [0, 4, 9, 15];        // 검: 공격력 추가
const GEAR_DEF = [0, 2, 4, 6];         // 갑옷: 받는 피해 감소(최소 1)
const GEAR_SPD = [1, 1.12, 1.25, 1.4]; // 부츠: 이동속도 배율
const GEAR_SHOP = [
  { key: 'sword', names: ['강철 검', '기사의 검', '폭풍의 검'], prices: [80, 200, 300], desc: ['공격력 +4', '공격력 +9', '공격력 +15'], mats: [null, null, [['투구 파편', 3]]] },
  { key: 'armor', names: ['가죽 갑옷', '철 갑옷', '뼈 갑옷'], prices: [60, 150, 250], desc: ['받는 피해 -2', '받는 피해 -4', '받는 피해 -6'], mats: [null, null, [['뼈 조각', 5]]] },
  { key: 'boots', names: ['바람 부츠', '폭풍 부츠', '천둥 부츠'], prices: [100, 220, 280], desc: ['이동속도 +12%', '이동속도 +25%', '이동속도 +40%'], mats: [null, null, [['거미줄', 4]]] },
];
// ---------- 스킬 트리 (기본 8노드 각1P + 기록원 보법 2택1 각2P) ----------
const SKILLS = [
  { id:'windshot',branch:'원풍',name:'바람칼날',desc:'바라보는 방향으로 직선 바람탄 · 첫 적 1명에 1.2배 피해 · 사거리10m · G키/쿨5초 · 벽에 막힘/가드 파괴 불가',req:null },
  { id: 'crush', branch: '강풍', name: '파쇄', desc: '강공격이 가드를 부수고 2.5초 경직 · 가드 적에게 피해 +30%', req: null },
  { id: 'smash', branch: '강풍', name: '분쇄', desc: '강공격 피해 3.0배 · 범위 +40%', req: 'crush' },
  { id: 'haste', branch: '질풍', name: '잔상', desc: '회피 쿨다운 2.5 → 1.6초', req: null },
  { id: 'blade', branch: '질풍', name: '칼바람', desc: '회피 후 3초 안에 다음 공격 피해 +60%', req: 'haste' },
  { id: 'riposte', branch: '질풍', name: '역풍', desc: '실제 회피 무적으로 공격을 막으면 4초 반격 준비 · 다음 근접 유효타에 체력12 회복 (회피당 1회, 가드 막힘/회전베기 제외)', req: 'blade' },
  { id: 'whirl', branch: '선풍', name: '회전베기', desc: '주위 모든 적에게 1.4배 피해 (F키 / 쿨 8초)', req: null },
  { id: 'storm', branch: '선풍', name: '폭풍', desc: '회전베기 피해 2.0배 · 쿨 6초', req: 'whirl' },
  {id:'shortstep',branch:'보법 연마 · 2택1',name:'짧은 발걸음',cost:2,group:'footwork',req:'haste',desc:'2.5m를 0.28초에 이동 · 무적0.38초 · 잔상 적용 쿨0.9초(발걸음 인장0.65초). 빠른 반격 대신 긴 예고에서 벗어날 거리가 짧다.'},
  {id:'longstep',branch:'보법 연마 · 2택1',name:'긴 발걸음',cost:2,group:'footwork',req:'haste',desc:'6m를 0.6초에 이동 · 무적0.55초 · 잔상 적용 쿨2.3초(발걸음 인장2.05초). 넓은 예고를 벗어나지만 끝부분은 무적이 아니며 다음 회피가 늦다.'},
];
const hasSkill = (id) => !!state.skills[id];
function footworkUnlocked(){return state.level>=10&&state.archive?.stage===4;}
function footworkId(){return footworkUnlocked()&&hasSkill('haste')?(hasSkill('shortstep')?'shortstep':hasSkill('longstep')?'longstep':null):null;}
function dodgeProfile(){const id=footworkId(),short=id==='shortstep',long=id==='longstep';return{id,name:short?'짧은 발걸음':long?'긴 발걸음':'기본 회피',distance:short?2.5:long?6:4,duration:short?.28:long?.6:.45,inv:short?.38:.55,cooldown:(short?(hasSkill('haste')?.9:1.5):long?(hasSkill('haste')?2.3:3.2):(hasSkill('haste')?1.6:2.5))-(activeInsignia('stride')?.25:0)};}
function footworkSafe(){return footworkUnlocked()&&insigniaSafe();}
function refundFootwork(){if(!state.dialog||!footworkSafe())return;const ids=SKILLS.filter(s=>s.group==='footwork'&&hasSkill(s.id));if(!ids.length)return;const points=ids.reduce((n,s)=>n+(s.cost||1),0);for(const s of ids)delete state.skills[s.id];state.skillPts+=points;saveGame();sfx('reward',.6);toast(`보법 연마 해제 · ${points}P 반환 · 현재 체력/쿨 유지`);}

// 전투 숙련: 기존 스킬과 별도. 선택만 저장하고 연격/감속은 전투 중에만 유지한다.
const MASTERIES = [
  {id:'chain',name:'연격',desc:'같은 적에게 3초 안에 일반공격을 이어 3번 적중하면 세번째가 가드 파괴. 헛침·강공격·회전베기는 연속 초기화. 일반공격 기본 피해로 가드 파괴 (기존 파쇄 효과 적용).'},
  {id:'pursuit',name:'추격',desc:'바람칼날이 가드·보호막 없는 적에게 실제 피해를 주면 4초 표식. 같은 적에게 다음 일반 근접 타격이 1.5배, 바람칼날 남은 쿨 2초 감소. 강공격·회전베기는 소비 불가. 표식은 저장되지 않는다.',req:'windshot'},
  {id:'gale',name:'돌풍',desc:'회전베기에 맞은 일반 적의 이동만 3초간 50% 감속. 공격·독침 속도는 그대로. 보스·1회성 적·시련·원정 보초 제외.',req:'whirl'},
];
function activeMastery(id) { return state.level >= 8 && state.mastery === id; }
function masterySafe() {
  return !state.dead && state.level >= 8 && state.npc && state.player.position.distanceTo(state.npc.pos) <= 2.6 &&
    !state.enemies.some(e => !e.dead && e.root.position.distanceTo(state.player.position) < 12);
}
function resetMasteryCombat() {
  state.masteryChain = null;
  state.pursuit = null;
  for (const e of state.enemies) e.galeUntil = 0;
}
function chainStrike(e, now) {
  if (!activeMastery('chain')) return false;
  const old = state.masteryChain;
  const count = old && old.target === e && now <= old.until ? old.count + 1 : 1;
  if (count >= 3) { state.masteryChain = null; skillFx(e.root.position,0xffc35c,1.2,'hit'); toast('연격 3타! 가드 파괴 타격'); return true; }
  state.masteryChain = {target:e,count,until:now+3};
  return false;
}
function pursuitReady(e,now){const m=state.pursuit;return activeMastery('pursuit')&&m&&m.target===e&&!e.dead&&now<m.until;}
function galeEligible(e) { return !e.dead && !e.stats.boss && !e.stats.noRespawn && !e.trial && !e.expedition; }
function enemyMoveScale(e, now) { return activeMastery('gale') && now < (e.galeUntil || 0) ? 0.5 : 1; }

// 여행 인장: 원정 완료 기록으로 해금, 전투 숙련/룬과 독립된 한 칸. 미해금 저장값은 효과 없음.
const INSIGNIAS = [
 {id:'care',name:'돌봄',desc:'사용하는 물약의 회복량 60 → 85. 해독·소모·재사용 시간은 그대로.',hint:'동쪽 관측소 기록 회수',unlocked:()=>state.observatory===4},
 {id:'guard',name:'수호',desc:'최대 체력 +25. 장착·교체로 현재 체력이 회복되지는 않는다.',hint:'관측 기록 수레 최종 인계',unlocked:()=>state.cartStage===3},
 {id:'stride',name:'발걸음',desc:'다음 회피부터 재사용 시간 -0.25초. 잔상과 함께 1.35초. 무적·거리 그대로.',hint:'북서 전령 기록 최종 인계',unlocked:()=>state.courier===3},
];
function activeInsignia(id){return state.insignia===id&&!!INSIGNIAS.find(d=>d.id===id)?.unlocked();}
function insigniaSafe(){return !state.dead&&state.npc&&state.player.position.distanceTo(state.npc.pos)<=2.6&&!state.enemies.some(e=>!e.dead&&e.root.position.distanceTo(state.player.position)<12);}
function insigniaName(){return INSIGNIAS.find(d=>activeInsignia(d.id))?.name||'미장착';}
function renderInsignias(list,rerender){
 const safe=insigniaSafe();
 list.innerHTML+=`<div class="shoprow"><div class="info"><b>여행 인장 · 독립 1칸</b><br><small>현재: ${insigniaName()} · 해금 ${INSIGNIAS.filter(d=>d.unlocked()).length}/3<br>장로 곁 2.6m · 주변 12m 적 없음일 때 무료 장착·교체·해제. 스킬 포인트/골드/룬/숙련은 유지된다.</small></div><button data-insignia="none" ${!safe||!state.insignia?'disabled':''}>해제</button></div>`+INSIGNIAS.map(d=>`<div class="shoprow"><div class="info"><b>${d.name}${activeInsignia(d.id)?' [장착 중]':''}</b><br><small>${d.desc}<br>${d.unlocked()?'✓ 해금 완료':'잠김: '+d.hint}</small></div><button data-insignia="${d.id}" ${!safe||!d.unlocked()||activeInsignia(d.id)?'disabled':''}>${activeInsignia(d.id)?'장착 중':'무료 장착'}</button></div>`).join('');
}
function bindInsignias(list,rerender){
 list.querySelectorAll('[data-insignia]').forEach(b=>b.addEventListener('click',()=>{
  const id=b.dataset.insignia,d=INSIGNIAS.find(d=>d.id===id);
  if(!state.dialog||!insigniaSafe()||(id!=='none'&&(!d||!d.unlocked()))||state.insignia===id)return;
  state.insignia=id==='none'?null:id;applyProgression();saveGame();sfx('reward',.6);skillFx(state.player.position,0xf2ce81,1.1,'ready');toast(`여행 인장: ${insigniaName()} · 현재 체력 회복 없음`);rerender();
 }));
}

// 종 원정 뒤 원풍 조율: 단일 화력 또는 세 대상 관통. 기본 바람칼날은 그대로 유지.
function piercingWind(){return state.windTune==='pierce'&&state.bell?.stage===5&&hasSkill('windshot');}
function windTuneName(){return piercingWind()?'관통풍':'바람칼날';}
function windTuneSafe(){return insigniaSafe()&&state.bell?.stage===5&&hasSkill('windshot');}
function openWindTune(){closeDialog();const can=windTuneSafe();journeyDialog('원풍 조율',`현재: <b>${windTuneName()}</b><br><br><b>바람칼날</b> · 첫 적 1명에게 공격력1.2배. 기존 방식.<br><b>관통풍</b> · 일렬 최대3명에게 각각 공격력0.9배. 같은 적은 한 발에 한 번만 맞는다. 첫 적에 대한 화력은 낮지만 줄 세운 적을 꿰뚫는다.<br><br>둘 다 사거리10m·재사용5초·G/같은 원거리 버튼. 벽·가드·보호막에서 멈추며, 가드는 기존 감소 피해만 준다. 종 파수꾼의 푸른 방어는 해제해도 그 자리에서 멈춘다.<br>추격 숙련은 마지막으로 실제 피해를 받은 생존 적 한 명에게 표식이 남는다.<br><br>해금: 수문 아래의 종 기록 완료 + 바람칼날 습득.<br>장로 곁2.6m·주변12m 적 없음일 때 무료 교체. 스킬·포인트·룬·숙련·인장은 그대로, 체력과 재사용 시간도 초기화하지 않는다.<br>여울 나루 곁 기록대의 무료 표적 연습으로 줄 세운 세 대상을 시험할 수 있다.<br><b>${can?'지금 무료 교체 가능':'지금은 교체할 수 없다. 해금과 장로 곁 안전 조건을 확인하자.'}</b>`,can?[[piercingWind()?'바람칼날로 조율':'관통풍으로 조율',()=>{if(!windTuneSafe())return;state.windTune=piercingWind()?null:'pierce';cancelWindshot('tune');saveGame();sfx('reward',.7);toast(`원풍 조율: ${windTuneName()} · 무료 교체`);openWindTune();}]]:[]);}
function clearWindPractice(){for(const e of state.windPractice||[]){e.dead=true;e.despawned=true;if(e.tele)scene.remove(e.tele);scene.remove(e.root);e.root.traverse(o=>{if(o.geometry)o.geometry.dispose();const ms=o.material?(Array.isArray(o.material)?o.material:[o.material]):[];for(const m of ms){if(m.map)m.map.dispose();m.dispose();}});const i=state.enemies.indexOf(e);if(i>=0)state.enemies.splice(i,1);}state.windPractice=null;}
function startWindPractice(){if(state.bell.stage!==5||nearbyBell()?.id!=='archive'||!state.protos.skel)return;clearWindPractice();cancelWindshot('practice');state.windPractice=[143,146,149].map((x,i)=>{const e=state.spawn(state.protos.skel,{...ENEMY,hp:99999,dmg:0,guard:false,speed:0,range:0,aggro:0,noElite:true,noRespawn:true,label:`조율 표적 ${i+1}`,windPractice:true},x,-3);e.expedition=true;e.trial=true;e.windPracticeIndex=i+1;e.windPracticeHits=0;e.root.visible=false;const root=new THREE.Group();root.position.set(x,0,-3);const wood=new THREE.MeshLambertMaterial({color:0xb39253}),cloth=new THREE.MeshLambertMaterial({color:0xc1a475});for(const[w,h,d,y]of[[.18,2.4,.18,1.2],[1.5,.15,.15,1.5],[.8,1.1,.45,1.3]]){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),w===.8?cloth:wood);m.position.y=y;root.add(m);}const head=new THREE.Mesh(new THREE.SphereGeometry(.34,10,8),cloth);head.position.y=2.15;root.add(head);const ring=new THREE.Mesh(new THREE.TorusGeometry(.3,.045,5,20),new THREE.MeshBasicMaterial({color:0xffd87a}));ring.position.set(0,1.4,-.25);root.add(ring);const name=makeNameSprite(e.stats.label);name.position.y=2.8;root.add(name);scene.remove(e.root);e.root=root;e.home.set(x,0,-3);e.nameSprite=name;scene.add(root);return e;});closeDialog();toast('표적 연습 · 서쪽에서 동쪽으로 세 표적을 줄 세워 쏘자. 보상·전리품·사망 위험 없음');}
function updateWindPractice(){if(state.windPractice&&(state.dead||!inEstuary()||state.player.position.distanceTo(new THREE.Vector3(146,0,-3))>28))clearWindPractice();}

const ENEMY = { hp: 20, dmg: 5, speed: 2.4, aggro: 11, range: 1.7, cd: 1.4, skel: true, label: '스켈레톤', windup: 0.45, gold: 5, teleH: 1.9 };
const WARRIOR = { hp: 40, dmg: 8, speed: 2.8, aggro: 12, range: 1.8, cd: 1.2, skel: true, warrior: true, label: '스켈레톤 전사', windup: 0.55, combo: true, gold: 12, teleH: 2.1 };
const BOSS = { hp: 150, dmg: 12, speed: 2.6, aggro: 15, range: 2.2, cd: 1.5, skel: true, warrior: true, boss: true, label: '묘지의 왕', windup: 0.65, combo: true, gold: 60, teleH: 3.4, guard: true };
const PLAYER = { dmg: 10, range: 2.4, arc: Math.PI * 0.6 };
const FROG = { hp: 15, dmg: 3, speed: 2.0, aggro: 9, range: 1.4, cd: 1.6, label: '개구리', windup: 0.5, leap: 2.8, gold: 4, teleH: 1.1 };
const RAT = { hp: 10, dmg: 2, speed: 3.2, aggro: 8, range: 1.2, cd: 1.1, label: '쥐', windup: 0.28, gold: 3, teleH: 0.7 };
const SPIDER = { hp: 25, dmg: 6, speed: 2.6, aggro: 10, range: 1.5, cd: 1.5, label: '거미', windup: 0.6, gold: 6, teleH: 1.3 };
// Batch P — 틴트 변형 신규 종 (도감은 label 기준으로 자동 집계)
const PFROG = { ...FROG, hp: 24, dmg: 5, speed: 2.4, cd: 1.3, gold: 8, label: '독 개구리', rangedSpit: true, tint: 0x6fd94f };
const SRAT = { ...RAT, hp: 16, dmg: 4, speed: 3.8, gold: 7, label: '그림자 쥐', tint: 0x3a3a55 };
const FSKEL = { ...ENEMY, hp: 32, dmg: 7, speed: 2.2, gold: 10, label: '서리 스켈레톤', tint: 0x55bbff, emis: 0x0a2a3a };
// 독사 계열: 물기에 중독(6초 DoT, 초당 2, 최소 1HP) — 회피로 피하고 물약으로 해독
const SNAKE = { hp: 30, dmg: 5, speed: 3.0, aggro: 12, range: 1.5, cd: 1.5, label: '독사', windup: 0.45, gold: 9, teleH: 1.0, poison: true, snake: true, tint: 0x86c93f };
const VSNAKE = { ...SNAKE, hp: 48, dmg: 8, speed: 3.5, cd: 1.3, gold: 15, label: '왕독사', kingSnake: true, tint: 0x6a3aa0, emis: 0x180a28 };
// 벌집 숲 계열: 말벌 무리 + 여왕벌(1회성 가드 미니보스) — 남동 벌집 숲 (56, 30) 서식
const WASP = { hp: 40, dmg: 7, speed: 3.2, aggro: 13, range: 1.6, cd: 1.4, label: '말벌', windup: 0.4, gold: 11, teleH: 1.2, wasp: true, tint: 0xe8c83a, tintMix: 0.4 };
const QWASP = { ...WASP, hp: 120, dmg: 12, speed: 2.8, aggro: 14, range: 2.0, cd: 1.2, windup: 0.55, gold: 80, label: '여왕벌', queenWasp: true, guard: true, noElite: true, noRespawn: true, tint: 0xc8752a, tintMix: 0.5, emis: 0x241203 };
// 독 늪지대 계열: 늪독사·늪 거미 — 남서 독 늪지대 (-28, 48) 서식. 독사 퀘스트 카운터와 분리(snake 플래그 없음), 물기에 중독
const BGSNAKE = { ...SNAKE, hp: 55, dmg: 9, speed: 3.2, cd: 1.3, gold: 14, label: '늪독사', snake: false, kingSnake: false, bogSnake: true, tint: 0x3f6a2a, emis: 0x0a180a };
const BGSPIDER = { ...SPIDER, hp: 40, dmg: 8, speed: 2.8, cd: 1.3, gold: 12, label: '늪 거미', poison: true, bogSpider: true, tint: 0x4a5d6a, emis: 0x0a1218 };
// 늪지 군주: 독 늪지대의 1회성 가드 미니보스 (여왕벌 패턴) — 큰 거미 프로토, 강공격으로 가드 파괴 필요
const BOGLORD = { ...SPIDER, hp: 220, dmg: 15, speed: 2.6, aggro: 15, range: 2.4, cd: 1.4, windup: 0.6, gold: 90, label: '늪지 군주', guard: true, poison: true, bogLord: true, noElite: true, noRespawn: true, teleH: 1.9, tint: 0x2a4a1a, tintMix: 0.6, emis: 0x0c1a08 };
// 황금 쥐: 희귀 출현, 플레이어에게서 도망, 60초 한정
const GOLDEN = { ...RAT, hp: 30, dmg: 0, speed: 5.2, aggro: 0, range: 0, cd: 9, gold: 50, label: '황금 쥐', tint: 0xffd24a, tintMix: 0.85, emis: 0x7a5c00, flee: true, noElite: true };
// Batch AA — 버려진 망루의 수호대장: 1회성 미니보스 (부활·엘리트 승격 없음)
const CAPTAIN = { ...WARRIOR, hp: 90, dmg: 11, speed: 2.7, aggro: 12, range: 2.0, cd: 1.3, windup: 0.6, gold: 45, label: '망루 수호대장', teleH: 2.6, tint: 0x8fa3c8, tintMix: 0.5, emis: 0x0d1420, noElite: true, noRespawn: true, watch: true, guard: true };
// 지명 수배 몬스터 3종 (의뢰 14~16 대상, 1회성 네임드): 가드 미니보스 패턴 + 큰 덩치(big 배율)·고유 색감
const BLOODRAT = { ...RAT, hp: 240, dmg: 16, speed: 4.0, aggro: 13, range: 1.6, cd: 1.0, windup: 0.35, gold: 130, label: '피빛 왕쥐', guard: true, bloodRat: true, noElite: true, noRespawn: true, big: 1.7, tint: 0xc03040, tintMix: 0.6, emis: 0x2a080c };
const SWASP = { ...WASP, wasp: false, hp: 280, dmg: 17, speed: 3.6, aggro: 14, range: 1.9, cd: 1.2, gold: 140, label: '칼날 말벌', guard: false, stormWasp: true, noElite: true, noRespawn: true, big: 1.35, tint: 0x9adfff, tintMix: 0.55, emis: 0x10202c };
const ROCKSP = { ...SPIDER, hp: 380, dmg: 19, speed: 2.2, aggro: 14, range: 2.0, cd: 1.6, windup: 0.65, gold: 160, label: '바위등 거미', guard: true, rockSpider: true, noElite: true, noRespawn: true, big: 1.5, teleH: 1.7, tint: 0x8f9096, tintMix: 0.6, emis: 0x141416 };
// 잊힌 유적 지역 (북서 (-36,-48)): 유적 해골·유적 수호자 — 스켈레톤 프로토 재사용, 카운터 분리(skel/warrior 플래그 끔)
const RUINSKEL = { ...ENEMY, skel: false, hp: 60, dmg: 11, speed: 2.5, aggro: 12, gold: 16, label: '유적 해골', ruinSkel: true, tint: 0xcfc4a8, tintMix: 0.55, emis: 0x2a2410 };
const RUINWAR = { ...WARRIOR, skel: false, warrior: false, hp: 110, dmg: 15, speed: 2.7, aggro: 13, gold: 24, label: '유적 수호자', ruinWar: true, tint: 0x9aa8b8, tintMix: 0.55, emis: 0x101820 };
const WARDEN = { ...RUINWAR, ruinWar: false, hp: 300, dmg: 19, speed: 2.9, aggro: 15, range: 2.2, cd: 1.2, windup: 0.6, gold: 180, label: '유적의 감시자', guard: false, combo: false, ruinWarden: true, noElite: true, noRespawn: true, big: 1.5, teleH: 1.8, tint: 0x7a6a4a, tintMix: 0.6, emis: 0x1a1408 };

// ---------- 토스트 (짧은 알림) ----------
let toastTimer = 0;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  // 튜토리얼이 떠 있으면 그 아래로 내려 겹침 방지 (토스트가 여러 줄이어도 안전)
  const tutEl = document.getElementById('tut');
  if (tutEl && tutEl.style.display !== 'none' && getComputedStyle(tutEl).display !== 'none') {
    el.style.top = `${Math.round(tutEl.getBoundingClientRect().bottom + 8)}px`;
  } else {
    el.style.top = '';
  }
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 1500);
}

// ---------- 보스 정보 플레이트 (이름+체력 HUD): 3D 이름표는 튜토리얼/벽에 가려질 수 있어 HUD로 보장 ----------
const bossPlate = document.createElement('div');
bossPlate.id = 'bossplate';
bossPlate.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:96px;min-width:220px;max-width:72vw;padding:6px 14px;background:rgba(20,16,26,.78);border:1px solid #6b5566;border-radius:10px;color:#ffd98a;font:700 15px \'Noto Sans KR\',sans-serif;text-align:center;display:none;z-index:30;pointer-events:none';
bossPlate.innerHTML = '<div id="bp-name"></div><div id="bp-cue"></div><div style="height:7px;background:#3a2f3f;border-radius:4px;margin-top:4px;overflow:hidden"><div id="bp-hp" style="height:100%;width:100%;background:#e05252;border-radius:4px"></div></div>';
document.body.appendChild(bossPlate);
const riposteHud = document.createElement('div');
riposteHud.id = 'riposte-ready';
riposteHud.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:210px;padding:5px 12px;background:rgba(20,55,43,.88);border:1px solid #70e5a0;border-radius:9px;color:#c6ffda;font:700 13px sans-serif;display:none;z-index:29;pointer-events:none;white-space:nowrap';
riposteHud.style.fontFamily = "'Noto Sans KR', sans-serif";
document.body.appendChild(riposteHud);
const windBtn = document.createElement('div');
windBtn.id='windshot'; windBtn.className='cbtn'; windBtn.textContent='바람칼날'; windBtn.style.display='none';
windBtn.setAttribute('role','button'); windBtn.setAttribute('aria-label','바람칼날 G');
document.body.appendChild(windBtn);
windBtn.addEventListener('click',e=>{e.stopPropagation();tryWindshot()});
windBtn.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();tryWindshot()},{passive:false});
const windStyle=document.createElement('style');
windStyle.textContent='#windshot{right:106px;bottom:138px;background:rgba(30,110,175,.85);font-size:10px;} @media(max-width:800px),(max-height:500px){#windshot{right:84px;bottom:154px;width:46px;height:46px;font-size:9px;}}';
windStyle.textContent+=' @media(max-width:560px){#prompt{left:10px;transform:none;max-width:calc(100vw - 190px);box-sizing:border-box;white-space:normal;text-align:center;}}';
document.head.appendChild(windStyle);

const skillTreeStyle = document.createElement('style');
skillTreeStyle.textContent = '#dlg.journey-dialog #dlg-text { max-height:min(38vh,260px);overflow-y:auto;scrollbar-width:thin; } #dlg.journey-dialog .btns { flex-wrap:wrap; } #dlg.skilltree #dlg-list { max-height: min(40vh, 260px); overflow-y:auto; scrollbar-width:thin; }';
skillTreeStyle.textContent+='#dlg.skilltree{display:flex!important;flex-direction:column;gap:4px;top:50%;bottom:auto;transform:translate(-50%,-50%);width:min(474px,calc(100vw - 20px));height:min(660px,calc(100dvh - 24px));max-height:none;box-sizing:border-box;overflow:hidden}#dlg.skilltree h3,#dlg.skilltree .btns{flex-shrink:0}#dlg.skilltree #dlg-text{flex:0 0 auto;max-height:25vh;overflow-y:auto;scrollbar-width:thin}#dlg.skilltree #dlg-list{flex:1 1 auto;min-height:60px;max-height:none;overflow-y:auto}#dlg.skilltree .btns{margin-top:4px;flex-wrap:wrap}#dlg.skilltree button:disabled{opacity:.45;cursor:default}';
document.head.appendChild(skillTreeStyle);
// 이름과 대응 지시를 분리한다. HUD 대상만 바뀌며 실제 공격/자동전투 대상은 그대로다.
const combatHudStyle=document.createElement('style');
combatHudStyle.textContent='#bp-name{line-height:1.35;word-break:keep-all;overflow-wrap:normal}#bp-cue{font-size:13px;line-height:1.4;color:#f5eddb}#bp-cue span{display:block;white-space:nowrap}#bossplate[data-warning="true"]{border-color:#ff8a75}#bossplate[data-warning="true"] #bp-cue{color:#ffb39c}@media(max-width:559px),(max-height:500px){#bossplate{padding:6px 8px!important;font-size:12px!important}#bp-cue{font-size:11px}}';
combatHudStyle.textContent+='@media(min-width:560px) and (max-height:500px){#quest{left:176px;right:150px;top:44px;max-width:none;box-sizing:border-box;text-align:center;font-size:10px;line-height:1.4;padding:4px 6px;word-break:keep-all}}';
combatHudStyle.textContent+='@media(min-width:560px) and (max-height:500px){#minimap{width:96px;height:96px}}@media(min-width:560px) and (max-height:400px){#minimap{width:72px;height:72px}#skill,#inv,#pot,#dodge,#windshot,#whirl{width:42px;height:42px;font-size:9px}#skill{right:74px;bottom:192px}#inv{right:16px;bottom:192px}#windshot{right:74px;bottom:140px}#pot{bottom:140px}#whirl{right:74px;bottom:88px}#dodge{bottom:88px}#atk{bottom:20px}}';
document.head.appendChild(combatHudStyle);
function combatCue(e,now){
 const at=[e.archerAt,e.mistAt,e.bellAt,e.pulseAt,e.stormAt,e.spitAt].filter(t=>t>now);
 const deadline=at.length?Math.min(...at):0;
 let lines=[];
 if(e.staggerUntil>now)lines=['경직 · 반격'];
 else if(e.stats.mistHunter)lines=e.mistAt?['붉은 원 예고','원 밖 · 회피']:mistLit(e)?['빛 안 · 공격 가능']:['안개 · 피해 차단','등불로 유인'];
 else if(e.stats.bellBoss)lines=e.bellAt?(e.bellOuter?['고리 예고','3m 안 · 8m 밖']:['원형 예고','4.5m 밖으로']):e.bellExposed>now?['방어 해제 · 공격']:['푸른 방어','원거리 · 강공격'];
 else if(e.stats.echoBoss&&state.echoFight?.shield)lines=['보호막','봉인석 해제'];
 else if(e.stats.ruinWarden)lines=e.pulseAt?['지면파 예고','원 밖으로']:e.pulseRecover>now?['반격 기회']:[];
 else if(e.stats.stormWasp)lines=e.stormAt?['돌진 예고','옆으로 회피']:e.stormRun?['돌진 중','옆으로 이동']:e.stormRecover>now?['반격 기회']:[];
 else if(e.stats.rangedSpit)lines=e.spitAt?['독침 예고','옆으로 회피']:e.spitLeft>0?['독침 비행','옆으로 이동']:e.spitRecover>now?['반격 기회']:['거리 유지'];
 else if(e.stats.archer)lines=e.archerAt?['세 갈래 예고','엄폐 · 옆 회피']:e.archerRecover>now?['사격 후 빈틈']:['원거리 사수'];
 else if(e.stats.guard)lines=['방패 · 강공격'];
 return{lines,deadline};
}
function updateBossPlate() {
  const now=clock.elapsedTime;
  let t=null,bd=18,warningAt=Infinity;
  for(const e of state.enemies){
    if(e.dead||!e.nameSprite)continue;
    const d=e.root.position.distanceTo(state.player.position);if(d>=18)continue;
    const cue=combatCue(e,now),at=cue.deadline;
    if(at&&(at<warningAt||(at===warningAt&&d<bd))){t=e;bd=d;warningAt=at;}
    else if(!at&&warningAt===Infinity&&d<bd){t=e;bd=d;}
  }
  if (!t || state.dead || state.dialog || state.menuOpen) { bossPlate.style.display = 'none'; return; }
  // 좁은 화면(모바일)에서는 오른쪽 공격/회피 버튼 열과 겹치지 않도록 위로 올리고 폭을 줄임
  const narrow = window.innerWidth < 560 || window.innerHeight <= 500;
  bossPlate.style.bottom = narrow ? '160px' : '150px'; // 하단 대화 프롬프트(40px~)와 겹치지 않도록 올림
  bossPlate.style.left = narrow ? '10px' : '50%';
  bossPlate.style.transform = narrow ? 'none' : 'translateX(-50%)';
  bossPlate.style.boxSizing = 'border-box';
  bossPlate.style.width = narrow ? 'calc(100vw - 190px)' : '';
  bossPlate.style.maxWidth = narrow ? '200px' : '72vw';
  bossPlate.style.minWidth = narrow ? '120px' : '220px';
  bossPlate.style.display = 'block';
  const cue=combatCue(t,now),stag=t.staggerUntil>now;
  document.getElementById('bp-name').textContent=(stag?'💫 ':t.stats.guard?'🛡 ':'')+t.stats.label;
  const cueEl=document.getElementById('bp-cue');
  const cueKey=cue.lines.join('|');
  if(cueEl.dataset.key!==cueKey){cueEl.replaceChildren(...cue.lines.map(text=>{const line=document.createElement('span');line.textContent=text;return line;}));cueEl.dataset.key=cueKey;}
  cueEl.style.display=cue.lines.length?'block':'none';
  bossPlate.dataset.warning=String(!!cue.deadline);
  document.getElementById('bp-hp').style.width = Math.max(0, Math.min(100, (t.hp / t.stats.hp) * 100)) + '%';
}

// ---------- 공격 예고 표시 (!) ----------
let teleTex = null;
function telegraphTexture() {
  if (teleTex) return teleTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#e03428';
  g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff';
  g.font = 'bold 44px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('!', 32, 34);
  teleTex = new THREE.CanvasTexture(c);
  return teleTex;
}
function showTelegraph(e, dur) {
  if (!e.tele) {
    e.tele = new THREE.Sprite(new THREE.SpriteMaterial({ map: telegraphTexture(), depthWrite: false }));
    e.tele.scale.setScalar(0.55);
    e.tele.position.y = e.stats.teleH || 1.8;
    e.root.add(e.tele);
  }
  e.tele.visible = true;
  e.teleUntil = clock.elapsedTime + dur;
}

// ---------- 충돌체 (원형 + 던전 벽) ----------
const colliders = []; // {x, z, r}

// 카메라↔플레이어 사이를 가리는 나무는 반투명 처리 (수관이 시야를 막는 문제 대응)
const treeFades = [];
function registerTreeFade(inst, x, z) {
  const mats = [];
  inst.traverse((o) => {
    if (o.isMesh && o.material) {
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) { m.transparent = true; mats.push(m); }
    }
  });
  treeFades.push({ x, z, mats, op: 1 });
}
function updateTreeFades(dt) {
  if (!state.player) return;
  const cp = camera.position, pp = state.player.position;
  const sx = pp.x - cp.x, sz = pp.z - cp.z;
  const len2 = sx * sx + sz * sz;
  for (const t of treeFades) {
    const px = t.x - pp.x, pz = t.z - pp.z;
    let target = 1;
    if (px * px + pz * pz < 225) {
      let u = len2 > 1e-6 ? ((t.x - cp.x) * sx + (t.z - cp.z) * sz) / len2 : 1;
      u = Math.max(0, Math.min(1, u));
      const qx = cp.x + sx * u - t.x, qz = cp.z + sz * u - t.z;
      if (u > 0.05 && qx * qx + qz * qz < 2.6 * 2.6) target = 0.18;
    }
    if (Math.abs(t.op - target) > 0.01) {
      t.op += (target - t.op) * Math.min(1, dt * 7);
      if (Math.abs(t.op - target) < 0.015) t.op = target;
      for (const m of t.mats) m.opacity = t.op;
    }
  }
}
// 카메라가 강하게 클램프되어 플레이어에 가까이 붙으면 플레이어를 반투명하게 (적·공격 예고 가독)
const playerFade = { mats: null, op: 1 };
function updatePlayerFade(dt) {
  if (!state.player) return;
  if (!playerFade.mats) {
    playerFade.mats = [];
    state.player.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) { m.transparent = true; playerFade.mats.push(m); }
      }
    });
  }
  const cd = camera.position.distanceTo(state.player.position);
  const target = cd < 2.6 ? 0.32 : 1;
  if (Math.abs(playerFade.op - target) > 0.01) {
    playerFade.op += (target - playerFade.op) * Math.min(1, dt * 8);
    if (Math.abs(playerFade.op - target) < 0.015) playerFade.op = target;
    for (const m of playerFade.mats) m.opacity = playerFade.op;
  }
}
const DUNGEON = { cx: 48, cz: -48, half: 0, doorHalf: 0 }; // half는 던전 생성 시 채움
function resolveCollisions(p) {
  for (const c of colliders) {
    const dx = p.x - c.x, dz = p.z - c.z;
    const d = Math.hypot(dx, dz), min = c.r + 0.45;
    if (d < min && d > 1e-4) { p.x = c.x + (dx / d) * min; p.z = c.z + (dz / d) * min; }
  }
  const { cx, cz, half, doorHalf } = DUNGEON;
  if (!half) return;
  const band = 0.8;
  if (p.x < cx - half - band || p.x > cx + half + band || p.z < cz - half - band || p.z > cz + half + band) return;
  const inDoorX = Math.abs(p.x - (DUNGEON.doorX ?? cx)) < doorHalf;
  const insideRect = Math.abs(p.x - cx) < half && Math.abs(p.z - cz) < half;
  if (insideRect) {
    // 내부: 벽 띠에 들어가면 안쪽으로 밀어냄. 남문 띠는 통행 허용.
    if (inDoorX && p.z > cz + half - band) return;
    p.x = Math.max(cx - half + band, Math.min(cx + half - band, p.x));
    p.z = Math.max(cz - half + band, Math.min(cz + half - band, p.z));
  } else {
    // 외부: 벽 띠에 들어가면 바깥으로 밀어냄. 남문 접근은 통행 허용.
    if (inDoorX && p.z > cz + half) return;
    if (Math.abs(p.x - cx) < half + band && Math.abs(p.z - cz) < half + band) {
      if (p.x > cx + half) p.x = cx + half + band; else if (p.x < cx - half) p.x = cx - half - band;
      if (p.z > cz + half) p.z = cz + half + band; else if (p.z < cz - half) p.z = cz - half - band;
    }
  }
}

function tryAttack(strong = false) {
  state.attacksDone++;
  window.__dbgAtk = (window.__dbgAtk || 0) + 1;
  window.__dbgAtkWhy = !state.ready ? 'notready' : state.dead ? 'dead' : state.dialog ? 'dialog' : '';
  if (!state.ready || state.dead || state.dialog) return;
  const now = clock.elapsedTime;
  if (now < state.attackCdUntil) { window.__dbgAtkWhy = 'cd'; return; }
  if (now < state.dodgeUntil) return;
  if (strong) state.masteryChain = null;
  state.attackStrong = strong;
  const dur = state.anim.clipDuration(strong ? '1h_melee_attack_chop' : 'slice_diagonal') || (strong ? 1.0 : 0.7);
  state.anim.playOnce(strong ? '1h_melee_attack_chop' : 'slice_diagonal');
  if(strong) skillFx(state.player.position,0xffb35c,1.5,'cast',state.heading);
  state.attackUntil = now + Math.min(dur * 0.8, strong ? 1.1 : 0.7);
  state.attackCdUntil = now + (strong ? Math.max(dur * 0.95, 1.1) : Math.max(dur * 0.9, 0.5));
  state.didHit = false;
  sfx(Math.random() < 0.5 ? 'swing1' : 'swing2', strong ? 1 : 0.7);
  if (strong) toast('강공격!');
}

// ---------- 회피 구르기 (Q / 회피 버튼) ----------
function tryDodge() {
  if (!state.ready || state.dead || state.dialog) return;
  const now = clock.elapsedTime;
  if (now < state.dodgeCdUntil) return;
  // 입력 방향 우선, 없으면 바라보는 방향
  let ix = 0, iz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
  ix += stick.x; iz += stick.y;
  if (Math.hypot(ix, iz) > 0.1) {
    const dir = new THREE.Vector3(ix, 0, iz).applyAxisAngle(new THREE.Vector3(0, 1, 0), camYaw + Math.PI);
    state.dodgeDir.copy(dir.normalize());
  } else {
    state.dodgeDir.set(Math.sin(state.heading), 0, Math.cos(state.heading));
  }
  state.heading = Math.atan2(state.dodgeDir.x, state.dodgeDir.z);
  state.player.rotation.y = state.heading;
  const form=dodgeProfile();state.dodgeFormAtCast=form;state.dodgeTravel=0;
  state.dodgeUntil = now + form.duration;
  state.dodgeCdUntil = now + form.cooldown;
  state.invUntil = now + form.inv;
  if (hasSkill('blade')) state.bladeUntil = now + 3; // 칼바람: 회피 후 다음 타격 강화
  state.dodgeFrom = state.player.position.clone();
  state.dodgeStart = now;
  state.dodgeCount++;
  state.anim.playOnce('dodge_forward', 'dodge');
  skillFx(state.player.position,hasSkill('blade')?0xc0a0ff:0x91cbff,1.1,'dodge',state.heading);
  sfx('step1', 0.6);
}

// 역풍은 빈 회피가 아니라 실제 공격의 무적 방지에서만 획득한다.
function registerDodgeBlock(now) {
  state.dodgeBlocks = (state.dodgeBlocks || 0) + 1;
  if (!hasSkill('riposte') || !state.dodgeCount || now < state.dodgeStart || now >= state.dodgeStart + (state.dodgeFormAtCast?.inv||.55) || state.riposteDodge === state.dodgeCount) return;
  state.riposteDodge = state.dodgeCount;
  state.riposteUntil = now + 4;
  skillFx(state.player.position,0x85ffc0,1.3,'ready');
  toast('역풍 준비! 4초 안에 근접 반격하면 체력12 회복');
}
function consumeRiposte(e, now, guardHeld, beforeHp) {
  if (!state.riposteUntil || now >= state.riposteUntil || !hasSkill('riposte') || guardHeld || e.hp >= beforeHp) return;
  state.riposteUntil = 0;
  const healed = Math.min(12, state.maxHp - state.hp);
  state.hp += healed;
  skillFx(state.player.position,0x6dffae,1.5,'heal');
  sfx('reward', 0.6); toast(`역풍 반격! 체력 +${healed}`); saveGame();
}

// ---------- 물약 (R / 물약 버튼) ----------
function usePotion() {
  if (!state.ready || state.dead || state.dialog) return;
  const now = clock.elapsedTime;
  if (state.potions <= 0) { toast('물약이 없습니다'); return; }
  if (now < state.potCdUntil) return;
  if (state.hp >= state.maxHp) { toast('체력이 가득 찼습니다'); return; }
  state.potions--;
  state.potCdUntil = now + 1.2;
  const healed = Math.min(activeInsignia('care') ? 85 : 60, state.maxHp - state.hp);
  if(activeInsignia('care'))skillFx(state.player.position,0x85ffc0,1.4,'heal');
  state.hp += healed;
  const cured = clock.elapsedTime < state.poisonUntil;
  state.poisonUntil = 0; state.poisonTickAt = 0;
  state.anim.playOnce('use_item');
  sfx('reward', 0.8);
  toast(`체력 +${healed}${cured ? ' · 독 해독' : ''}`);
}

// ---------- 자동 전투 (T / 자동 버튼) ----------
function toggleAuto() {
  if (!state.ready) return;
  state.autoOn = !state.autoOn;
  const b = document.getElementById('auto');
  b.textContent = state.autoOn ? '자동 전투 ON' : '자동 전투 OFF';
  b.classList.toggle('on', state.autoOn);
  toast(state.autoOn ? '자동 전투를 켰습니다 (조작하면 수동 우선)' : '자동 전투를 껐습니다');
}
// ---------- 메뉴 대시보드 (Esc / ☰ 메뉴): 설정 · 기록 · 초기화 ----------
const menuDlg = document.getElementById('menudlg');
const menuBack = document.getElementById('menuback');
const menuBody = document.getElementById('menubody');
let menuTab = 'set';
function openMenu() {
  if (!state.ready || state.dialog || state.menuOpen) return;
  state.menuOpen = true; keys.clear();
  menuDlg.style.display = 'block'; menuBack.style.display = 'block';
  renderMenu();
}
function closeMenu() { state.menuOpen = false; menuDlg.style.display = 'none'; menuBack.style.display = 'none'; }
document.getElementById('menuBtn').addEventListener('click', (e) => { e.stopPropagation(); openMenu(); });
document.getElementById('menuBtn').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); openMenu(); }, { passive: false });
menuBack.addEventListener('click', closeMenu);
document.getElementById('menuclose').addEventListener('click', closeMenu);
document.getElementById('menutabs').addEventListener('click', (e) => { const t = e.target.dataset && e.target.dataset.tab; if (t) { menuTab = t; renderMenu(); } });
function renderMenu() {
  document.querySelectorAll('#menutabs button[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === menuTab));
  if (menuTab === 'set') {
    menuBody.innerHTML = `
      <div class="mrow"><div>소리 <small>${audio.muted ? '꺼짐' : '켜짐'}</small></div><button class="act" id="m-snd">${audio.muted ? '소리 켜기' : '소리 끄기'}</button></div>
      <div class="mrow"><div>자동 전투 <small>${state.autoOn ? 'ON' : 'OFF'}</small></div><button class="act" id="m-auto">${state.autoOn ? '끄기' : '켜기'}</button></div>
      <div class="mrow"><div>모험 일지 <small>장별 진행 · L키</small></div><button class="act" id="m-campaign">열기</button></div>
      <div class="mrow"><div>여행 수첩 <small>끊어진 순례길 · J키</small></div><button class="act" id="m-journey">열기</button></div>
      <div class="mrow"><div>튜토리얼 <small>${state.tutDone ? '완료' : '진행 중'}</small></div><button class="act" id="m-tut">다시 보기</button></div>`;
    menuBody.querySelector('#m-snd').onclick = () => { initAudio(); audio.muted = !audio.muted; if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.8; syncSndBtn(); renderMenu(); };
    menuBody.querySelector('#m-auto').onclick = () => { toggleAuto(); renderMenu(); };
    menuBody.querySelector('#m-campaign').onclick = () => { closeMenu(); openCampaignJournal(); };
    menuBody.querySelector('#m-journey').onclick = () => { closeMenu(); openJourneyJournal(); };
    menuBody.querySelector('#m-tut').onclick = () => { state.tutDone = false; toast('도움말이 다시 표시됩니다'); renderMenu(); };
  } else if (menuTab === 'rec') {
    const pt = Math.floor(state.playTime || 0);
    const hh = Math.floor(pt / 3600), mm = Math.floor((pt % 3600) / 60);
    const rows = [
      ['시뮬레이션 시간', (hh > 0 ? hh + '시간 ' : '') + mm + '분 · 실제 경과와 다름'],
      ['레벨 / XP', 'Lv.' + state.level + ' (' + (state.xp || 0) + ' XP)'],
      ['총 처치', state.kills + ' (전사 ' + state.wKills + ' · 엘리트 ' + state.eliteKills + ' · 보스 ' + state.bossKills + ')'],
      ['도감 발견', Object.keys(state.dex || {}).length + '종'],
      ['전투 숙련', MASTERIES.find(m=>m.id===state.mastery)?.name || '미선택 (Lv.8)'],
      ['습득 스킬', SKILLS.filter(k=>!k.group&&state.skills[k.id]).length + ' / 8 · 보법 ' + (footworkId()?'선택':'미선택') + ' (포인트 ' + state.skillPts + ')'],
      ['보유 골드', state.gold + 'G'],
      ['장비 등급', '검 ' + state.gear.sword + ' · 갑옷 ' + state.gear.armor + ' · 부츠 ' + state.gear.boots],
      ['업적', Object.keys(state.ach || {}).length + '개'],
      ['보물상자', (state.chestsOpened || []).length + '개'],
      ['신전 기도', (state.shrinesPrayed || []).length + '곳'],
      ['몬스터 소굴', (state.densCleared || []).length + '/' + DENS.length + '곳'],
      ['바람의 고리', (state.ringsPassed || []).length + ' / 5'],
      ['지도 조각', (state.mapFrags || 0) + ' / 3'],
      ['시련', state.trialDone ? '완료' : '미완료'],
      ['숨겨진 보물', state.treasureDone ? '발굴 완료' : '미발굴'],
      ['버려진 망루', state.watchCleared ? '수호대장 격파' : (state.watchFound ? '발견' : '미발견')],
      ['지명 수배', (((state.bloodRatKills || 0) >= 1 ? 1 : 0) + ((state.stormWaspKills || 0) >= 1 ? 1 : 0) + ((state.rockSpiderKills || 0) >= 1 ? 1 : 0)) + ' / 3'],
      ['잊힌 유적', state.ruinsFound ? '발견' : '미발견'],
      ['꺼진 봉화길', state.beacon?.step===5?'봉화지기':state.beacon?.step?'원정 진행 중':'미시작'],
      ['끊어진 순례길', state.journey === 5 ? '완결' : state.journey ? `${Math.min(3,state.journey-1)} / 3 기록` : '미시작'],
      ['유적 바람길', state.sealSolved ? '개통' : '봉인'],
      ['꽃 판매', (state.flowersSold || 0) + '송이'],
    ];
    menuBody.innerHTML = '<div class="recgrid">' + rows.map(([k, v]) => `<div class="mrow"><div>${k}</div><div>${v}</div></div>`).join('') + '</div>';
  } else {
    menuBody.innerHTML = `
      <div style="color:#ffb0a0; word-break:keep-all; padding-bottom:6px">모든 진행 상황(레벨, 장비, 퀘스트, 기록)이 삭제되고 처음부터 다시 시작합니다. 되돌릴 수 없습니다.</div>
      <div class="mrow"><div>확인을 위해 <b>초기화</b>를 입력하세요</div><input id="m-reset-in" placeholder="초기화" autocomplete="off"></div>
      <div class="mrow"><div></div><button class="act danger" id="m-reset" disabled>영구 삭제하고 재시작</button></div>`;
    const inp = menuBody.querySelector('#m-reset-in');
    const btn = menuBody.querySelector('#m-reset');
    inp.oninput = () => { btn.disabled = inp.value.trim() !== '초기화'; };
    btn.onclick = () => { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} location.reload(); };
  }
}

function autoTarget() {
  let best = null, bd = 22;
  for (const e of state.enemies) {
    if (e.dead) continue;
    const d = e.root.position.distanceTo(state.player.position);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function hitFlash(root) {
  if(root===state.player&&state.archiveChannel){state.archiveChannel=null;toast('피격으로 수로 조절 중단');}
  if(root===state.player&&state.estuaryChannel){state.estuaryChannel=null;toast('피격으로 구조 중단 · 다시 시도할 수 있다.');}
  root.traverse((o) => {
    if (o.isMesh && o.material) {
      if (!o.userData.origMat) o.userData.origMat = o.material;
      const orig = o.userData.origMat;
      const mats = Array.isArray(orig) ? orig : [orig];
      // FBX 등 다중 머티리얼 메시 대응
      const clones = mats.map((m) => {
        const c = m.clone();
        if (c.emissive) { c.emissive = new THREE.Color(0xff3322); c.emissiveIntensity = 0.8; }
        return c;
      });
      o.material = Array.isArray(orig) ? clones : clones[0];
      setTimeout(() => { o.material = o.userData.origMat; }, 130);
    }
  });
}

function respawnEnemy(e) {
  const a = Math.random() * Math.PI * 2;
  e.root.position.copy(e.home).add(new THREE.Vector3(Math.cos(a) * 4, 0, Math.sin(a) * 4));
  cancelFrogSpit(e); e.spitNext = 0; e.galeUntil = 0;
  e.hp = e.stats.hp; e.mode = 'wander'; e.dead = false;
  e.root.visible = true;
  e.anim.play('walking', 'walk', 'jump', 'idle');
}

// ---------- 월드 구성 ----------
async function build() {
  const knight = await load('assets/characters/Knight.glb');
  const player = shadowify(knight.scene);
  const HIDE = ['1H_Sword_Offhand', '2H_Sword', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield'];
  player.traverse((o) => { if (HIDE.includes(o.name)) o.visible = false; });
  scene.add(player);
  state.player = player;
  state.anim = new AnimSet(player, knight.animations);
  state.anim.play('Idle');

  const skel = await load('assets/characters/Skeleton_Minion.glb');
  let spawnSeq = 0;
  const spawn = (gltf, stats, x, z) => {
    spawnSeq++;
    // 6마리마다 1마리는 엘리트: 체력·공격력 강화, 골드 3배, 붉은 색감·큰 덩치 (보스 제외)
    let st = stats;
    if (!stats.boss && !stats.noElite && spawnSeq % 6 === 0) {
      st = { ...stats, hp: Math.round(stats.hp * 2.2), dmg: Math.max(1, Math.round(stats.dmg * 1.5)), gold: (stats.gold || 3) * 3, label: '엘리트 ' + stats.label, elite: true };
    }
    const root = shadowify(SkeletonUtils.clone(gltf.scene));
    root.position.set(x, 0, z);
    if (st.elite || st.tint) {
      if (st.elite) root.scale.multiplyScalar(1.22);
      if (st.big) root.scale.multiplyScalar(st.big); // 지명 수배 네임드 덩치
      root.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const tint = (m) => {
          const c = m.clone();
          if (c.color && st.tint) c.color.lerp(new THREE.Color(st.tint), st.tintMix ?? 0.55);
          if (c.emissive && st.emis) c.emissive.setHex(st.emis);
          if (st.elite) {
            if (c.color) c.color.lerp(new THREE.Color(0xff4040), 0.5);
            if (c.emissive) c.emissive.setHex(0x330000);
          }
          return c;
        };
        o.material = Array.isArray(o.material) ? o.material.map(tint) : tint(o.material);
      });
    }
    scene.add(root);
    const anim = new AnimSet(root, gltf.animations);
    anim.play('walking', 'walk', 'jump', 'idle');
    const e = { root, anim, angle: Math.atan2(x, z), stats: st, home: new THREE.Vector3(x, 0, z), hp: st.hp, mode: 'wander', dead: false, atkUntil: 0, cdUntil: 0, respawnAt: 0 };
    if ((st.guard || st.ruinWarden || st.stormWasp || st.rangedSpit || st.archer) && !e.nameSprite) { e.nameSprite = makeNameSprite(st.label); e.nameSprite.position.y = (st.teleH ?? 1.3) + 0.7; e.root.add(e.nameSprite); } // 가드 미니보스 이름표: 보스플레이트 HUD 연동
    state.enemies.push(e);
    return e;
  };
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.8;
    spawn(skel, ENEMY, Math.cos(a) * 20, Math.sin(a) * 20);
  }
  spawn(skel, FSKEL, 30, 8);
  spawn(skel, FSKEL, -8, 32);
  state.spawn = spawn;
  state.spawnTrial = (stats, x, z) => { const e = spawn(skel, stats, x, z); e.trial = true; return e; };
  state.protos = { skel };


  // 마을 (Kenney Fantasy Town Kit, CC0)
  const knightH = new THREE.Box3().setFromObject(player).getSize(new THREE.Vector3()).y || 1.2;
  // [모델, x, z, 회전, 목표높이(캐릭터 배율)]
  const village = [
    ['windmill', -14, -22, 0.4, 6.0, 3.4], ['watermill', 16, -24, -2.2, 4.5, 3.0],
    ['fountainRound', 0, -14, 0, 3.0, 2.2],
    ['stallRed', -7, -10, 0.9, 2.2, 1.7], ['stallGreen', 7, -10, -0.9, 2.2, 1.7],
    ['cart', -12, -12, 0.6, 1.8, 1.3], ['lantern', -3, -10, 0, 1.7, 0.35], ['lantern', 3, -10, 0, 1.7, 0.35],
    ['lantern', -10, -18, 0, 1.7, 0.35], ['lantern', 10, -18, 0, 1.7, 0.35],
    ['hedge', -16, -16, 0, 1.6, 2.4], ['hedge', 16, -16, 0, 1.6, 2.4],
  ];
  const townCache = {};
  await Promise.all(village.map(async ([name, x, z, rot, hMul, cR]) => {
    try {
      if (!townCache[name]) townCache[name] = (await load(`assets/town/${name}.glb`)).scene;
      const o = shadowify(townCache[name].clone());
      const sz = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
      const maxDim = Math.max(sz.x, sz.y, sz.z) || 2;
      o.scale.setScalar((knightH * hMul) / maxDim);
      o.position.set(x, 0, z);
      o.rotation.y = rot;
      scene.add(o);
      colliders.push({ x, z, r: cR });
    } catch (err) { console.warn('town load fail', name, err); }
  }));
  // 주택·여관·마구간 (Quaternius Medieval Village, CC0 — 공식 팩 페이지 문구 직접 확인)
  const only = params.get('only'); // 격리 렌더 검증용
  if (only) {
    const o = await loadObj(only);
    scene.add(o);
    const bb = new THREE.Box3().setFromObject(o);
    console.log('only-bbox', JSON.stringify(bb.min), JSON.stringify(bb.max));
    state.ready = true;
    window.__gameReady = true;
    state.anim = { play() {}, playOnce() {}, update() {}, names: [], current: '' };
    state.player = new THREE.Object3D();
    return;
  }
  const houses = [
    ['House_1', -22, -6, Math.PI / 2, 4.2, 2.6],
    ['House_2', 22, -6, -Math.PI / 2, 4.2, 2.6],
    ['Inn', -21, -13, 0.9, 5.0, 3.0],
    ['Stable', 21, -13, -0.9, 4.4, 2.6],
    ['House_3', -6, -25, 0, 4.2, 2.6],
    ['House_4', 8, -25, 0, 4.2, 2.6],
  ];
  await Promise.all(houses.map(async ([name, x, z, rot, hMul, cR]) => {
    try {
      const o = await loadObj(name);
      const sz = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
      const maxDim = Math.max(sz.x, sz.y, sz.z) || 2;
      o.scale.setScalar((knightH * hMul) / maxDim);
      o.position.set(x, 0, z);
      o.rotation.y = rot;
      scene.add(o);
      colliders.push({ x, z, r: cR });
    } catch (err) { console.warn('house load fail', name, err); }
  }));

  // 들판 몬스터 (Quaternius Easy Enemy Pack, CC0 — 공식 팩 페이지 문구 직접 확인)
  // FBX 단위가 커서 bbox 높이 기준으로 축소하고, 발이 지면에 닿도록 래퍼로 오프셋
  const fbxLoader = new FBXLoader();
  const fieldMobs = [
    ['Frog', FROG, 0.42, [[14, 16], [-18, 22]]],
    ['Rat', RAT, 0.42, [[24, 6], [8, 26], [-26, 10]]],
    ['Rat', SRAT, 0.42, [[20, -22], [-28, -4]]],
    ['Spider', SPIDER, 0.55, [[32, -14], [-30, -18]]],
    ['Snake', SNAKE, 0.6, [[36, 18], [40, -6], [-36, -16]]],
  ];
  await Promise.all(fieldMobs.map(async ([name, stats, hMul, spots]) => {
    try {
      const fbx = await track(fbxLoader.loadAsync(`assets/enemies/${name}.fbx`));
      const bb = new THREE.Box3().setFromObject(fbx);
      const sz = bb.getSize(new THREE.Vector3());
      const sc = (knightH * hMul) / (sz.y || 1);
      fbx.scale.setScalar(sc);
      fbx.position.y = -bb.min.y * sc;
      const wrap = new THREE.Group();
      wrap.add(fbx);
      shadowify(wrap);
      state.protos[name] = { scene: wrap, animations: fbx.animations };
      for (const [x, z] of spots) spawn({ scene: wrap, animations: fbx.animations }, stats, x, z);
    } catch (err) { console.warn('enemy fbx load fail', name, err); }
  }));

  // 광장 돌길
  try {
    const road = (await load('assets/town/road.glb')).scene;
    const rs = new THREE.Box3().setFromObject(road).getSize(new THREE.Vector3());
    const tile = Math.max(rs.x, rs.z);
    const rscale = (knightH * 1.6) / tile;
    for (let i = 0; i < 12; i++) {
      const r = road.clone();
      shadowify(r).traverse((o) => { if (o.isMesh) o.castShadow = false; });
      r.scale.setScalar(rscale);
      r.position.set(0, 0.02, -4 - i * tile * rscale);
      scene.add(r);
    }
  } catch (e) { console.warn('road fail', e); }
  // 마을 울타리
  try {
    const fence = (await load('assets/town/fence.glb')).scene;
    const fw = new THREE.Box3().setFromObject(fence).getSize(new THREE.Vector3());
    const fscale = (knightH * 1.2) / Math.max(fw.x, fw.z, 0.1);
    const fwid = fw.x * fscale;
    for (let i = 0; i < 12; i++) {
      const f = shadowify(fence.clone());
      f.scale.setScalar(fscale);
      f.position.set(-22 + i * fwid, 0, -28);
      scene.add(f);
    }
  } catch (e) { console.warn('fence fail', e); }

  // 자연 오브젝트
  const natureFiles = [
    'Tree_1_A_Color1', 'Tree_1_B_Color1', 'Tree_1_C_Color1', 'Tree_2_E_Color1',
    'Bush_1_A_Color1', 'Bush_1_C_Color1', 'Bush_1_E_Color1',
    'Grass_1_A_Color1', 'Grass_1_B_Color1', 'Grass_1_C_Color1',
  ];
  const rng = mulberry32(42);
  const natureGs = await Promise.all(natureFiles.map((f) => load(`assets/nature/gltf/${f}.gltf`).catch((e) => { console.warn('nature load fail', f, e); return null; })));
  natureGs.forEach((g, fi) => {
    if (!g) return;
    const f = natureFiles[fi];
    const proto = shadowify(g.scene);
    const isTree = f.startsWith('Tree');
    const count = isTree ? 10 : 22;
    for (let i = 0; i < count; i++) {
      const inst = proto.clone();
      const r = 8 + rng() * 66, t = rng() * Math.PI * 2;
      const x = Math.cos(t) * r, z = Math.sin(t) * r;
      if (Math.hypot(x, z) < 6) continue;
      if (z < -4 && Math.abs(x) < 26 && z > -30) continue; // 마을 구역 제외
      if (Math.hypot(x - 48, z + 48) < 22) continue; // 던전 구역 제외
      inst.position.set(x, 0, z);
      inst.rotation.y = rng() * Math.PI * 2;
      inst.scale.setScalar(0.8 + rng() * 0.5);
      if (Math.hypot(x - 48, z - 40) < 9) continue; // 칼날 말벌 전투 빈터, 난수 소비 후 제외해 다른 배치 유지
      if (journeyClearing(x,z)) continue; // 순례길 배낭의 읽기/접근 공간
      scene.add(inst);
      if (isTree) { colliders.push({ x, z, r: 0.6 }); registerTreeFade(inst, x, z); }
    }
  });

  // 서쪽 숲 지역 (-45, 18): 나무 군집 + 몬스터 서식지 (바람꽃 채집 구역)
  try {
    const treeProtos = natureGs.slice(0, 4).filter(Boolean).map((g) => shadowify(g.scene));
    const bushProtos = natureGs.slice(4).filter(Boolean).map((g) => shadowify(g.scene));
    const frng = mulberry32(1337);
    for (let i = 0; i < 26 && treeProtos.length; i++) {
      const proto = treeProtos[Math.floor(frng() * treeProtos.length)];
      const inst = proto.clone();
      const a = frng() * Math.PI * 2, r = 5 + frng() * 15;
      const x = -45 + Math.cos(a) * r, z = 18 + Math.sin(a) * r;
      if (Math.hypot(x, z) > 74) continue;
      inst.position.set(x, 0, z);
      inst.rotation.y = frng() * Math.PI * 2;
      inst.scale.setScalar(0.9 + frng() * 0.5);
      if (journeyClearing(x,z)) continue;
      scene.add(inst);
      colliders.push({ x, z, r: 0.6 });
      registerTreeFade(inst, x, z);
    }
    for (let i = 0; i < 10 && bushProtos.length; i++) {
      const proto = bushProtos[Math.floor(frng() * bushProtos.length)];
      const inst = proto.clone();
      const a = frng() * Math.PI * 2, r = 4 + frng() * 14;
      inst.position.set(-45 + Math.cos(a) * r, 0, 18 + Math.sin(a) * r);
      inst.rotation.y = frng() * Math.PI * 2;
      if (journeyClearing(inst.position.x,inst.position.z)) continue;
      scene.add(inst);
    }
    // 숲 서식 몬스터 (개구리 2, 거미 2)
    const fbx2 = new FBXLoader();
    const forestMobs = [
      ['Frog', FROG, 0.42, [[-40, 24], [-50, 12]]],
      ['Frog', PFROG, 0.42, [[-44, 18], [-36, 30]]],
      ['Spider', SPIDER, 0.55, [[-38, 10], [-52, 26]]],
      ['Snake_angry', VSNAKE, 0.7, [[-48, 8], [-34, 32]]],
    ];
    await Promise.all(forestMobs.map(async ([name, stats, hMul, spots]) => {
      try {
        const fbx = await track(fbx2.loadAsync(`assets/enemies/${name}.fbx`));
        const bb = new THREE.Box3().setFromObject(fbx);
        const sz = bb.getSize(new THREE.Vector3());
        const sc = (knightH * hMul) / (sz.y || 1);
        fbx.scale.setScalar(sc);
        fbx.position.y = -bb.min.y * sc;
        const wrap = new THREE.Group();
        state.protos[name] = state.protos[name] || { scene: wrap, animations: fbx.animations };
        wrap.add(fbx);
        shadowify(wrap);
        for (const [x, z] of spots) spawn({ scene: wrap, animations: fbx.animations }, stats, x, z);
      } catch (err) { console.warn('forest mob fail', name, err); }
    }));
  } catch (e) { console.warn('forest fail', e); }

  // 벌집 숲 지역 (남동 (56, 30)): 나무 군집 + 벌집 프롭(프로시저럴) + 말벌/여왕벌 서식지
  try {
    const treeProtos2 = natureGs.slice(0, 4).filter(Boolean).map((g) => shadowify(g.scene));
    const bushProtos2 = natureGs.slice(4).filter(Boolean).map((g) => shadowify(g.scene));
    const hrng = mulberry32(2026);
    for (let i = 0; i < 22 && treeProtos2.length; i++) {
      const proto = treeProtos2[Math.floor(hrng() * treeProtos2.length)];
      const inst = proto.clone();
      const a = hrng() * Math.PI * 2, r = 6 + hrng() * 13;
      const x = 56 + Math.cos(a) * r, z = 30 + Math.sin(a) * r;
      if (Math.hypot(x, z) > 74) continue;
      inst.position.set(x, 0, z);
      inst.rotation.y = hrng() * Math.PI * 2;
      inst.scale.setScalar(0.9 + hrng() * 0.5);
      if (journeyClearing(x,z)) continue;
      if (Math.hypot(x - 48, z - 40) < 9) continue; // 돌진 경로/이름표를 덮는 수관 제외
      scene.add(inst);
      colliders.push({ x, z, r: 0.6 });
      registerTreeFade(inst, x, z);
    }
    for (let i = 0; i < 8 && bushProtos2.length; i++) {
      const proto = bushProtos2[Math.floor(hrng() * bushProtos2.length)];
      const inst = proto.clone();
      const a = hrng() * Math.PI * 2, r = 5 + hrng() * 12;
      inst.position.set(56 + Math.cos(a) * r, 0, 30 + Math.sin(a) * r);
      inst.rotation.y = hrng() * Math.PI * 2;
      if (journeyClearing(inst.position.x,inst.position.z)) continue;
      if (Math.hypot(inst.position.x - 48, inst.position.z - 40) < 9) continue;
      scene.add(inst);
    }
    // 벌집: 땅에 선 둥근 둥지 (줄무늬 구 3단) — 여왕벌이 옆을 지킴
    const hive = new THREE.Group();
    const hiveMat = new THREE.MeshStandardMaterial({ color: 0xc8985a, roughness: 0.9 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x8a6430, roughness: 0.9 });
    const seg = [[1.5, 0.75], [1.25, 1.65], [0.8, 2.4]];
    seg.forEach(([r, y], i) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), i === 1 ? bandMat : hiveMat);
      m.scale.y = 0.62; m.position.y = y;
      m.castShadow = true;
      hive.add(m);
    });
    hive.position.set(56, 0, 30);
    scene.add(hive);
    colliders.push({ x: 56, z: 30, r: 1.7 });
    const fbx3 = new FBXLoader();
    const waspMobs = [
      ['Wasp', WASP, 0.5, [[52, 26], [60, 27], [51, 34], [61, 34], [56, 21]]],
      ['Wasp', QWASP, 0.9, [[58.5, 31.5]]],
    ];
    await Promise.all(waspMobs.map(async ([name, stats, hMul, spots]) => {
      try {
        const fbx = await track(fbx3.loadAsync(`assets/enemies/${name}.fbx`));
        const bb = new THREE.Box3().setFromObject(fbx);
        const sz = bb.getSize(new THREE.Vector3());
        const sc = (knightH * hMul) / (sz.y || 1);
        fbx.scale.setScalar(sc);
        fbx.position.y = -bb.min.y * sc;
        const wrap = new THREE.Group();
        state.protos[name] = state.protos[name] || { scene: wrap, animations: fbx.animations };
        wrap.add(fbx);
        shadowify(wrap);
        for (const [x, z] of spots) spawn({ scene: wrap, animations: fbx.animations }, stats, x, z);
      } catch (err) { console.warn('wasp mob fail', name, err); }
    }));
  } catch (e) { console.warn('wasp grove fail', e); }

  // 독 늪지대 지역 (남서 (-28, 48)): 독 웅덩이(밟으면 중독) + 늪독사/늪 거미 서식지
  try {
    state.swampPos = { x: -28, z: 48 };
    const mire = new THREE.Mesh(new THREE.CircleGeometry(15, 28), new THREE.MeshLambertMaterial({ color: 0x55663c }));
    mire.rotation.x = -Math.PI / 2; mire.position.set(-28, 0.02, 48); mire.receiveShadow = true;
    scene.add(mire);
    state.swampPools = [{ x: -32, z: 44, r: 4 }, { x: -23, z: 52, r: 3.5 }];
    for (const pool of state.swampPools) {
      const w = new THREE.Mesh(new THREE.CircleGeometry(pool.r, 20), new THREE.MeshStandardMaterial({ color: 0x86a843, emissive: 0x1e2a0e, roughness: 0.6, transparent: true, opacity: 0.9 }));
      w.rotation.x = -Math.PI / 2; w.position.set(pool.x, 0.05, pool.z);
      scene.add(w);
    }
    const deadProtos = natureGs.slice(0, 4).filter(Boolean).map((g) => {
      const t = shadowify(g.scene.clone());
      t.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const dk = (m) => { const c = m.clone(); if (c.color) c.color.lerp(new THREE.Color(0x4a3f30), 0.6); return c; };
        o.material = Array.isArray(o.material) ? o.material.map(dk) : dk(o.material);
      });
      return t;
    });
    const srng = mulberry32(777);
    for (let i = 0; i < 10 && deadProtos.length; i++) {
      const inst = deadProtos[Math.floor(srng() * deadProtos.length)].clone();
      const a = srng() * Math.PI * 2, r = 6 + srng() * 11;
      const x = -28 + Math.cos(a) * r, z = 48 + Math.sin(a) * r;
      if (Math.hypot(x, z) > 74) continue;
      if (state.swampPools.some((pl) => Math.hypot(x - pl.x, z - pl.z) < pl.r + 1)) continue;
      inst.position.set(x, 0, z);
      inst.rotation.y = srng() * Math.PI * 2;
      inst.scale.setScalar(0.85 + srng() * 0.4);
      if (journeyClearing(x,z)) continue;
      scene.add(inst);
      colliders.push({ x, z, r: 0.6 });
      registerTreeFade(inst, x, z);
    }
    const reedProtos = natureGs.slice(7).filter(Boolean).map((g) => shadowify(g.scene));
    for (let i = 0; i < 12 && reedProtos.length; i++) {
      const inst = reedProtos[Math.floor(srng() * reedProtos.length)].clone();
      const a = srng() * Math.PI * 2, r = 3 + srng() * 12;
      inst.position.set(-28 + Math.cos(a) * r, 0, 48 + Math.sin(a) * r);
      inst.rotation.y = srng() * Math.PI * 2;
      scene.add(inst);
    }
    // 서식 몬스터 (기존 프로토 재사용 — 추가 로드 없음)
    const bogSnakeProto = state.protos['Snake_angry'], bogSpiderProto = state.protos['Spider'];
    if (bogSnakeProto) for (const [x, z] of [[-33, 49], [-25, 43], [-22, 55]]) spawn(bogSnakeProto, BGSNAKE, x, z);
    if (bogSpiderProto) for (const [x, z] of [[-31, 53], [-20, 47]]) spawn(bogSpiderProto, BGSPIDER, x, z);
    // 늪지 군주: 거미 프로토를 1.7배로 키운 1회성 보스 — 늪 북쪽 웅덩이 뒤에 자리
    if (bogSpiderProto) {
      const lordScene = SkeletonUtils.clone(bogSpiderProto.scene);
      lordScene.scale.multiplyScalar(1.7);
      const lordWrap = new THREE.Group();
      lordWrap.add(lordScene);
      spawn({ scene: lordWrap, animations: bogSpiderProto.animations }, BOGLORD, -28, 57);
    }
  } catch (e) { console.warn('swamp fail', e); }

  // 지명 수배 몬스터 3종 (1회성 네임드, 의뢰 14~16): 기존 프로토 재사용, 부팅 시 항상 스폰 (여왕벌·늪지 군주와 동일 패턴)
  try {
    const ratP = state.protos['Rat'], waspP2 = state.protos['Wasp'], spiderP2 = state.protos['Spider'];
    if (ratP) spawn(ratP, BLOODRAT, -64, 4);        // 서쪽 숲 외곽
    if (waspP2) spawn(waspP2, SWASP, 48, 40);       // 벌집 숲 북쪽 원형 빈터
    if (spiderP2) spawn(spiderP2, ROCKSP, -30, -60); // 북서 바위 벼랑
  } catch (e) { console.warn('named bounty fail', e); }

  // 잊힌 유적 지역 (북서 (-36,-48)): 무너진 원형 벽·기둥·잔해 + 유적 해골/수호자 서식. 던전 GLB 재사용
  try {
    state.ruinsPos = { x: -36, z: -48 };
    const rfloor = new THREE.Mesh(new THREE.CircleGeometry(11, 26), new THREE.MeshLambertMaterial({ color: 0x8d8a7a }));
    rfloor.rotation.x = -Math.PI / 2; rfloor.position.set(-36, 0.02, -48); rfloor.receiveShadow = true;
    scene.add(rfloor);
    const RD = 'assets/dungeon/';
    const wallBG = await load(`${RD}wall_broken.gltf.glb`);
    const colG = await load(`${RD}column.gltf.glb`);
    const pilG = await load(`${RD}pillar.gltf.glb`);
    const rubG = await load(`${RD}rubble_half.gltf.glb`);
    const rub2G = await load(`${RD}rubble_large.gltf.glb`);
    const rtorG = await load(`${RD}torch_lit.gltf.glb`);
    const rrng = mulberry32(2024);
    for (let i = 0; i < 12; i++) { // 무너진 원형 벽: 절반가량만 남음
      if (rrng() < 0.45) continue;
      const a = (i / 12) * Math.PI * 2;
      const wx = -36 + Math.cos(a) * 9, wz = -48 + Math.sin(a) * 9;
      const w = shadowify(wallBG.scene.clone());
      w.position.set(wx, 0, wz); w.rotation.y = a + Math.PI / 2 + (rrng() - 0.5) * 0.3;
      scene.add(w); colliders.push({ x: wx, z: wz, r: 1.2 }); registerTreeFade(w, wx, wz);
    }
    for (const [px, pz, g] of [[-32, -44, pilG], [-40, -52, pilG], [-36, -44.5, colG], [-33, -51, rubG], [-39, -44, rub2G], [-36, -52.5, rubG]]) {
      const o = shadowify(g.scene.clone());
      o.position.set(px, 0, pz); o.rotation.y = rrng() * Math.PI * 2;
      scene.add(o); colliders.push({ x: px, z: pz, r: 0.7 }); registerTreeFade(o, px, pz);
    }
    for (const [tx, tz] of [[-31.5, -47], [-40.5, -49]]) { const t = shadowify(rtorG.scene.clone()); t.position.set(tx, 0, tz); scene.add(t); }
    const rl = new THREE.PointLight(0xffb060, 4, 14, 1.6);
    rl.position.set(-36, 3, -48); scene.add(rl);
    const rsk = state.protos['skel'];
    if (rsk) for (const [x, z] of [[-40, -45], [-33, -45], [-38, -52]]) spawn(rsk, RUINSKEL, x, z);
    if (rsk) for (const [x, z] of [[-35, -50], [-41, -49]]) { const e = spawn(rsk, RUINWAR, x, z); e.root.scale.multiplyScalar(1.18); }
    if (rsk) spawn(rsk, WARDEN, -36, -49); // 유적 중앙 1회성 보스 (의뢰 19)
  } catch (e) { console.warn('ruins fail', e); }

  // 바람꽃 (수집 의뢰) — 서쪽 숲에 8송이
  buildFlowers(-45, 18);
  // 보물상자 (탐험 요소) — 언덕 곳곳 5개
  buildChests();
  buildShrines();
  buildTrialStone();
  buildDens();
  buildSeals();
  buildJourneySites();
  buildBeaconTrail();
  buildObservatory();
  buildEchoSite();
  buildCart();
  buildCourierSite();

  // NPC 마을 장로 (KayKit Mage, CC0) — 광장 분수 옆
  try {
    const mage = await load('assets/characters/Mage.glb');
    const npc = shadowify(mage.scene);
    npc.position.set(3, 0, -8);
    npc.rotation.y = Math.PI;
    scene.add(npc);
    state.npc = { root: npc, anim: new AnimSet(npc, mage.animations), pos: npc.position };
    colliders.push({ x: 3, z: -8, r: 0.5 });
    state.npc.anim.play('Idle');
  } catch (e) { console.warn('npc fail', e); }

  // NPC 수집가 (Mage 청록 틴트 변형) — 마을 서쪽, 바람꽃 매입 (송이당 6G)
  try {
    const col = await load('assets/characters/Mage.glb');
    const croot = shadowify(col.scene);
    croot.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const tint = (m) => {
        const c = m.clone();
        if (c.color) c.color.lerp(new THREE.Color(0x40c8a0), 0.45);
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(tint) : tint(o.material);
    });
    croot.position.set(2, 0, -17);
    croot.rotation.y = Math.PI * 0.75;
    scene.add(croot);
    state.npc2 = { root: croot, anim: new AnimSet(croot, col.animations), pos: croot.position };
    colliders.push({ x: 2, z: -17, r: 0.5 });
    state.npc2.anim.play('Idle');
  } catch (e) { console.warn('npc2 fail', e); }

  // 지하묘지 (KayKit Dungeon Remastered, CC0) — 북동쪽 (48, -48)
  // ?lite=1: 테스트 전용 경량 모드 — 던전/망루 장식 로딩 생략 (실제 게임에서는 항상 전체 로딩)
  if (params.get('lite') !== '1') {
    await buildDungeon(48, -48);

    // 버려진 망루 (남쪽 언덕, KayKit Dungeon Remastered) — 수호대장 1회성 전투·발견 장소
    await buildWatchtower();
  }

  buildEstuary();
  buildBellSites();
  buildMist();
  await buildArchive();
  state.ready = true;
  window.__gameReady = true;
  const lo = document.getElementById('loading');
  if (lo) lo.style.display = 'none';
  if (params.get('reset') === '1') localStorage.removeItem(SAVE_KEY);
  spawnRings();
  loadGame();
  window.__animNames = state.anim.names;
  window.__game = {
    teleportNearEnemy() {
      let e = null, bd = 1e9;
      for (const x of state.enemies) {
        if (x.dead) continue;
        const d = x.root.position.distanceTo(state.player.position);
        if (d < bd) { bd = d; e = x; }
      }
      if (!e) return;
      state.player.position.copy(e.root.position).add(new THREE.Vector3(1.5, 0, 0));
      const to = e.root.position.clone().sub(state.player.position);
      state.heading = Math.atan2(to.x, to.z);
      state.player.rotation.y = state.heading;
    },
    beaconInfo(){return{...state.beacon,status:beaconStatus(),target:beaconTarget(),fight:state.beaconFight?{step:state.beaconFight.step,enemies:state.beaconFight.enemies.map(e=>({i:state.enemies.indexOf(e),hp:e.hp,dead:e.dead,pos:e.root.position.toArray(),guard:e.stats.guard,label:e.stats.label}))}:null}},
    insigniaInfo(){return{selected:state.insignia,active:insigniaName(),safe:insigniaSafe(),unlocked:INSIGNIAS.filter(d=>d.unlocked()).map(d=>d.id),hp:state.hp,maxHp:state.maxHp,potionHeal:activeInsignia('care')?85:60,dodgeRemaining:Math.max(0,state.dodgeCdUntil-clock.elapsedTime),dodgeCooldown:dodgeProfile().cooldown}},
    windTuneInfo(){return{selected:state.windTune,active:windTuneName(),safe:windTuneSafe(),unlocked:state.bell?.stage===5&&hasSkill('windshot'),practice:(state.windPractice||[]).map(e=>({i:state.enemies.indexOf(e),hp:e.hp,hits:e.windPracticeHits,pos:e.root.position.toArray()})),lastHits:state.lastWindHits||0}},
    archiveInfo(){return{...state.archive,inside:inArchive(),status:archiveStatus(),target:archiveTarget(),gate:!state.archiveGate.mesh.visible,channel:state.archiveChannel?{...state.archiveChannel,left:Math.max(0,2.5-(clock.elapsedTime-state.archiveChannel.start))}:null,streams:state.archiveStreams.map(t=>({z:t.z,at:t.at,next:t.next,hits:t.hits,dodges:t.dodges})),fight:(state.archiveFight||[]).map(e=>({i:state.enemies.indexOf(e),hp:e.hp,dead:e.dead,pos:e.root.position.toArray(),archer:!!e.stats.archer,aim:e.archerAt||0}))}},
    mistInfo(){const f=state.mistFight,e=f?.enemy;return{...state.mist,status:mistStatus(),target:mistTarget(),sites:(state.mistProps||[]).map(d=>({id:d.id,x:d.x,z:d.z,bit:d.bit})),fight:f?{active:f.active,left:Math.max(0,f.next-clock.elapsedTime),swaps:f.swaps,blocks:f.blocks,i:state.enemies.indexOf(e),hp:e.hp,pos:e.root.position.toArray(),lit:mistLit(e),at:e.mistAt,next:e.mistNext,hits:e.mistHits,dodges:e.mistDodges,strikes:e.mistStrikes}:null}},
    bellInfo(){const e=state.bellEnemy;return{...state.bell,status:bellStatus(),target:bellTarget(),enemy:e?{i:state.enemies.indexOf(e),hp:e.hp,dead:e.dead,pos:e.root.position.toArray(),at:e.bellAt||0,next:e.bellNext||0,outer:!!e.bellOuter,exposed:Math.max(0,(e.bellExposed||0)-clock.elapsedTime),cracks:e.bellCracks,breaks:e.bellBreaks,hits:e.bellHits,dodges:e.bellDodges,pulses:e.bellPulses}:null}},
    estuaryInfo(){return{...state.estuary,status:estuaryStatus(),inside:inEstuary(),target:estuaryTarget(),channel:state.estuaryChannel?{...state.estuaryChannel,left:Math.max(0,3-(clock.elapsedTime-state.estuaryChannel.start))}:null,tides:(state.estuaryTides||[]).map(t=>({id:t.id,at:t.at,next:t.next,hits:t.hits,blocks:t.blocks,saves:t.saves})),fight:(state.estuaryFight||[]).map(e=>({i:state.enemies.indexOf(e),hp:e.hp,dead:e.dead,boss:!!e.stats.estuaryBoss,pos:e.root.position.toArray()}))}},
    courierInfo(){return{stage:state.courier||0,status:courierStatus(),target:courierTarget(),fight:state.courierFight?state.courierFight.map(e=>({i:state.enemies.indexOf(e),hp:e.hp,dead:e.dead,pos:e.root.position.toArray(),aim:e.archerAt||0,next:e.archerNext||0,recover:e.archerRecover||0,fired:e.archerFired||0,walls:e.archerWalls||0,hits:e.archerHits||0,dodges:e.archerDodges||0,interrupts:e.archerInterrupts||0,result:e.archerResult||null,lines:(e.archerLines||[]).filter(m=>m.visible).length,arrows:(e.arrows||[]).map(a=>({left:a.left,pos:a.root.position.toArray(),visible:a.root.visible,dir:a.dir.toArray()}))})):null}},
    cartInfo(){const f=state.cartRun;return{stage:state.cartStage||0,status:cartStatus(),pos:state.cartModel.root.position.toArray(),run:f?{hp:f.hp,wave:f.wave,moved:f.moved,total:f.total,raiders:f.raiders.map(e=>({i:state.enemies.indexOf(e),hp:e.hp,dead:e.dead,pos:e.root.position.toArray()}))}:null}},
    echoInfo(){const f=state.echoFight;return{done:state.echo||0,status:echoStatus(),target:echoTarget(),fight:f?{phase:f.phase,sequence:f.sequence,shield:f.shield,hp:f.boss.hp,i:state.enemies.indexOf(f.boss),pos:f.boss.root.position.toArray(),dead:f.boss.dead,pulseAt:f.boss.pulseAt||0}:null}},
    observatoryInfo(){return{step:state.observatory||0,status:observatoryStatus(),target:observatoryTarget(),doors:colliders.filter(c=>c.observatoryDoor).length,enemies:(state.observatoryFight||[]).map(e=>({i:state.enemies.indexOf(e),hp:e.hp,dead:e.dead,pos:e.root.position.toArray(),label:e.stats.label}))}},
    campaignInfo,
    frogSpit() { return state.enemies.filter(e=>e.stats.rangedSpit).map(e=>({i:state.enemies.indexOf(e),dead:e.dead,hp:e.hp,pos:e.root.position.toArray(),mode:e.mode,at:e.spitAt||0,left:e.spitLeft||0,recover:e.spitRecover||0,next:e.spitNext||0,dir:e.spitDir?.toArray(),orb:e.spitOrb?.position.toArray(),visible:!!e.spitOrb?.visible,line:!!e.spitLine?.visible,result:e.spitResult||null,now:clock.elapsedTime})); },
    stormCharge() { const e=state.enemies.find(e=>e.stats.stormWasp); return e ? {dead:e.dead,hp:e.hp,guard:e.stats.guard,mode:e.mode,at:e.stormAt||0,run:e.stormRun||0,recover:e.stormRecover||0,from:e.stormFrom?.toArray(),to:e.stormTo?.toArray(),pos:e.root.position.toArray(),line:!!e.stormLine?.visible,result:e.stormResult||null,now:clock.elapsedTime} : null; },
    wardenPulse() { const e = state.enemies.find(e => e.stats.ruinWarden); return e ? { dead:e.dead, hp:e.hp, guard:e.stats.guard, mode:e.mode, at:e.pulseAt || 0, recover:e.pulseRecover || 0, center:e.pulseCenter ? [e.pulseCenter.x,e.pulseCenter.z] : null, ring:!!(e.pulseRing && e.pulseRing.visible), result:e.pulseResult || null, now:clock.elapsedTime } : null; },
    heal() { state.hp = state.maxHp; if (state.dead) respawn(); },
    talk() { tryInteract(); },
    addKills(n) { state.kills += n; },
    addVariantKills(label, n) { state.dex[label] = (state.dex[label] || 0) + n; },
    setBounty(kind, active) { state.bounty.kind = kind; state.bounty.active = !!active; if (kind === 'variants') state.bounty.startVariants = variantKillCount(); if (kind === 'kills') state.bounty.startKills = state.kills; if (kind === 'flowers') state.bounty.startFlowers = state.flowerCount; if (kind === 'elite') state.bounty.startElites = state.eliteKills || 0; if (kind === 'mats') { if (!state.bounty.mat) state.bounty.mat = BOUNTY_MATS[(state.bounty.count || 0) % BOUNTY_MATS.length]; state.bounty.startMats = state.mats[state.bounty.mat] || 0; } },
    setCounters(k, sk, w) { state.kills = k; state.skKills = sk; state.wKills = w; },
    save() { saveGame(); },
    teleport(x, z) { state.player.position.set(x, 0, z); },
    face(x, z) { const pp = state.player.position; state.heading = Math.atan2(x - pp.x, z - pp.z); state.player.rotation.y = state.heading; },
    invuln(sec) { state.invUntil = clock.elapsedTime + sec; },
    onlyEnemy(idx) { state.enemies.forEach((e, i) => { if (i !== idx) { e.dead = true; e.mode = 'dead'; e.respawnAt = 1e9; e.root.visible = false; if (e.tele) e.tele.visible = false; } }); },
    setCamYaw(v) { camYaw = v; },
    setHp(v) { state.hp = Math.max(0, Math.min(state.maxHp, v)); },
    setGold(v) { state.gold = Math.max(0, v); },
    addXp(n) { gainXp(n); },
    setQuest(idx, st) { state.quest = { idx, state: st, startKills: st === 'active' ? questCounter({ idx }) : 0 }; applyProgression(); },
    setFlowers(n) { state.flowerCount = n; },
    setFlowersSold(n) { state.flowersSold = n; },
    setMat(name, n) { state.mats[name] = n; },
    poisonInfo() { return { poisoned: clock.elapsedTime < state.poisonUntil, until: +state.poisonUntil.toFixed(2), hp: state.hp, potions: state.potions }; },
    setMapFrags(n) { state.mapFrags = n; if (n >= 3 && !state.treasureDone) spawnTreasure(); },
    spawnGolden(x, z) { if (!state.protos || !state.protos.Rat) return false; if (!state.golden) state.golden = { nextAt: 0, active: null, until: 0 }; const e = state.spawn(state.protos.Rat, GOLDEN, x, z); e.home.set(x, 0, z); state.golden.active = e; state.golden.until = clock.elapsedTime + 60; return true; },
    setDialog(v) { state.dialog = !!v; },
    footworkInfo(){return{...dodgeProfile(),unlocked:footworkUnlocked(),safe:footworkSafe(),points:state.skillPts,owned:SKILLS.filter(s=>s.group==='footwork'&&hasSkill(s.id)).map(s=>s.id),cast:state.dodgeFormAtCast||null,invLeft:Math.max(0,state.invUntil-clock.elapsedTime),dodgeLeft:Math.max(0,state.dodgeUntil-clock.elapsedTime),cooldownLeft:Math.max(0,state.dodgeCdUntil-clock.elapsedTime)};},
    givePts(n) { state.skillPts = (state.skillPts || 0) + n; },
    questInfo() { return { ...state.quest, progress: questProgress() }; },
    probeAt(i) { const x = state.enemies[i]; return x ? { label: x.stats.label, hp: x.hp, guard: !!x.stats.guard, staggered: !!(x.staggerUntil && clock.elapsedTime < x.staggerUntil), dead: x.dead } : null; },
    listEnemies() { return state.enemies.map((e, i) => ({ i, label: e.stats.label, hp: e.hp, guard: !!e.stats.guard, dead: e.dead, x: +e.root.position.x.toFixed(1), z: +e.root.position.z.toFixed(1) })); },
    learnAll() { for (const s of SKILLS) state.skills[s.id] = true; updateWhirlBtn(); },
    skillInfo() { return { pts: state.skillPts || 0, mastery: state.mastery, pursuit: state.pursuit&&pursuitReady(state.pursuit.target,clock.elapsedTime)?{label:state.pursuit.target.stats.label,i:state.enemies.indexOf(state.pursuit.target),left:+(state.pursuit.until-clock.elapsedTime).toFixed(2)}:null, pursuitHits:window.__dbgPursuit||0, chain: state.masteryChain && clock.elapsedTime <= state.masteryChain.until && !state.masteryChain.target.dead ? {count:state.masteryChain.count,left:+(state.masteryChain.until-clock.elapsedTime).toFixed(2),label:state.masteryChain.target.stats.label} : null, slowed:state.enemies.filter(e=>!e.dead&&enemyMoveScale(e,clock.elapsedTime)<1).length, skills: { ...state.skills }, windCd:+Math.max(0,state.windCdUntil-clock.elapsedTime).toFixed(2), windshot:state.windshot?{left:state.windshot.left,pos:state.windshot.pos.toArray(),dir:state.windshot.dir.toArray()}:null, windResult:state.windResult||null, fx:skillFxPool.filter(f=>f.root.visible).map(f=>({kind:f.kind,position:f.root.position.toArray(),age:+(clock.elapsedTime-f.start).toFixed(2)})), whirlCd: +Math.max(0, state.whirlCdUntil - clock.elapsedTime).toFixed(2), bladeLeft: +Math.max(0, state.bladeUntil - clock.elapsedTime).toFixed(2), riposteLeft: +Math.max(0, (state.riposteUntil || 0) - clock.elapsedTime).toFixed(2), riposteDodge: state.riposteDodge || 0 }; },
    enemyProbe() { let e = null, bd = 1e9; for (const x of state.enemies) { if (x.dead) continue; const d = x.root.position.distanceTo(state.player.position); if (d < bd) { bd = d; e = x; } } return e ? { label: e.stats.label, hp: e.hp, maxHp: e.stats.hp, guard: !!e.stats.guard, staggered: !!(e.staggerUntil && clock.elapsedTime < e.staggerUntil), dist: +bd.toFixed(2) } : null; },
    fadeDebug(cx, cz, r) { let f = 0, n = 0; for (const t of treeFades) { if (cx !== undefined && Math.hypot(t.x - cx, t.z - cz) > r) continue; n++; if (t.op < 0.5) f++; } return { faded: f, total: n }; },
    playerOpacity() { return +playerFade.op.toFixed(2); },
    camDist() { return +camera.position.distanceTo(state.player.position).toFixed(2); },
    setRain(sec) { weather.mode = 'rain'; weather.until = clock.elapsedTime + sec; },
    flowerPos(i) { return state.flowers ? state.flowers[i].root.position.toArray() : null; },
    debug() { return { dungeon: { ...DUNGEON }, colliders, hp: state.hp, dead: state.dead, dialog: state.dialog }; },
  };
}

// ---------- NPC 대화 / 의뢰 ----------
// ---------- 의뢰(퀘스트) 체인 ----------
// 보상은 applyProgression()이 완료 idx 기준으로 재계산해 세이브 복원과 항상 일치
const RUNES = [ // 선택형 성장: 유적 해방 후 3택1 영구 축복 (되돌릴 수 없음)
  { id: 'blade', name: '칼바람 룬', desc: '공격력 +4' },
  { id: 'hill', name: '언덕 룬', desc: '최대 체력 +40' },
  { id: 'gale', name: '질주 룬', desc: '이동 속도 +8%' },
];
const QUESTS = [
  { name: '스켈레톤 처치', goal: 3, counter: 'skKills', unit: '마리',
    offer: '유랑자여, 잘 왔네. 언덕에 스켈레톤이 들끓어 마을 사람들이 불안해하고 있네.<br>스켈레톤 <b>3마리</b>를 처치해주게. 사례는 하겠네.',
    progress: '스켈레톤 처치를 부탁했었지.',
    done: '스켈레톤 3마리를 모두 해치웠군! 마을이 자네 덕분에 한시름 놓았네.<br>약속한 사례일세: <b>최대 체력 100 → 130</b>.' },
  { name: '들판 몬스터 토벌', goal: 5, counter: 'fieldKills', unit: '마리',
    offer: '요즘 들판의 개구리며 쥐, 거미들이 흉포해져서 밭일을 못하겠다는군.<br>들판 몬스터 <b>5마리</b>를 토벌해주게. 자네 검솜씨를 봤으니 가능할 걸세.',
    progress: '들판 몬스터 토벌을 부탁했었지.',
    done: '들판이 한결 안전해졌네! 이제 주민들이 밭에 나갈 수 있겠어.<br>사례일세: <b>공격력 10 → 14</b>.' },
  { name: '묘지의 전사', goal: 2, counter: 'wKills', unit: '기',
    offer: '북동쪽 지하묘지에는 <b>스켈레톤 전사</b>가 지키고 있다네.<br>그 <b>2기</b>를 쓰러뜨려주면 마을에도 평화가 오겠네.',
    progress: '지하묘지의 스켈레톤 전사를 부탁했었지.',
    done: '전사들까지 해치우다니, 자네는 진정한 유랑 검객일세!<br>사례일세: <b>최대 체력 130 → 160</b>.' },
  { name: '바람꽃 수집', goal: 5, counter: 'flowers', unit: '송이',
    offer: '서쪽 숲에 <b>바람꽃</b>이 피었네. 약재로 쓸모가 많은 꽃일세.<br>빛나는 바람꽃 <b>5송이</b>를 꺾어다 주게. 숲에는 몬스터가 많으니 조심하게.',
    progress: '서쪽 숲의 바람꽃을 부탁했었지.',
    done: '이 향기, 틀림없는 바람꽃이군! 좋은 약재가 되겠어.<br>사례일세: <b>골드 40G와 체력 물약 2개</b>.' },
  { name: '묘지의 왕', goal: 1, counter: 'bossKills', unit: '기',
    offer: '마지막 부탁일세. 지하묘지 깊은 곳에 전사들의 왕, <b>묘지의 왕</b>이 깨어났다네.<br>그를 쓰러뜨려주면 언덕에 진정한 평화가 오겠네. 물약을 챙겨가게나.',
    progress: '지하묘지의 왕을 부탁했었지.',
    done: '묘지의 왕까지 해치우다니! 자네는 이 언덕의 영웅일세!<br>사례일세: <b>최대 체력 160 → 190</b>과 <b>골드 60G</b>.' },
  { name: '변종 토벌', goal: 3, counter: 'variantKills', unit: '마리',
    offer: '근래 평범하지 않은 몬스터가 목격된단다. 숲의 <b>독 개구리</b>, 들판의 <b>그림자 쥐</b>, 북쪽의 <b>서리 스켈레톤</b>... 변종들일세.<br>변종을 <b>3마리</b> 처치해주게. 어느 종이든 좋네.',
    progress: '변종 토벌을 부탁했었지.',
    done: '변종들까지 정리했군! 이제 언덕 어디든 안전하겠어.<br>사례일세: <b>공격력 14 → 18</b>과 <b>골드 80G</b>.' },
  { name: '독사 토벌', goal: 4, counter: 'snakeKills', unit: '마리',
    offer: '들판에 <b>독사</b>가 나타났다네. 물리면 독이 온몸에 퍼져 위험하니 밭일하는 주민들이 겁을 내고 있어.<br>독사 <b>4마리</b>를 처치해주게. 물린다면 물약으로 해독하게나.',
    progress: '들판의 독사를 부탁했었지.',
    done: '독사들을 해치웠군! 주민들이 밭에 나갈 수 있겠어.<br>사례일세: <b>공격력 18 → 22</b>.' },
  { name: '왕독사 토벌', goal: 2, counter: 'kingSnakeKills', unit: '마리',
    offer: '서쪽 숲 깊은 곳에 독사들의 우두머리, <b>왕독사</b>가 도사리고 있네.<br>왕독사 <b>2마리</b>를 처치해주게. 독이 더 지독하니 물약을 넉넉히 챙기게나.',
    progress: '서쪽 숲의 왕독사를 부탁했었지.',
    done: '왕독사까지 쓰러뜨렸군! 숲이 한결 안전해졌어.<br>사례일세: <b>최대 체력 190 → 220</b>과 <b>골드 120G</b>.' },
  { name: '독니 수집', goal: 3, counter: 'vials', unit: '개',
    offer: '약재상이 독사의 <b>독니</b>로 해독제를 만든다는군. 독사를 처치하면 얻을 수 있네.<br>독니 <b>3개</b>를 모아다 주게. 수집가에게 팔면 다시 모아야 하니 유의하게.',
    progress: '독니 수집을 부탁했었지.',
    done: '이 독니들이면 해독제를 한가득 만들 수 있겠어.<br>사례일세: <b>골드 100G</b>와 <b>체력 물약 2개</b>.' },
  { name: '말벌 토벌', goal: 5, counter: 'waspKills', unit: '마리',
    offer: '남동쪽 <b>벌집 숲</b>의 <b>말벌</b>들이 흉폭해져 길가는 사람들이 쏘이곤 한단다.<br>말벌 <b>5마리</b>를 처치해주게. 벌집 근처는 위험하니 조심하게나.',
    progress: '벌집 숲의 말벌을 부탁했었지.',
    done: '말벌들을 정리했군! 이제 숲길을 오갈 수 있겠어.<br>사례일세: <b>공격력 22 → 26</b>.' },
  { name: '여왕벌 토벌', goal: 1, counter: 'queenWaspKills', unit: '마리', abs: true,
    offer: '벌집 숲 한가운데 무리를 이끄는 <b>여왕벌</b>이 있네. 그녀석이 있는 한 말벌은 계속 불어날 걸세.<br><b>여왕벌</b>을 처치해주게. 덩치가 크니 물약을 넉넉히 챙기게나.',
    progress: '벌집 숲의 여왕벌을 부탁했었지.',
    done: '여왕벌까지 쓰러뜨렸군! 자네야말로 이 언덕의 영웅일세!<br>사례일세: <b>최대 체력 220 → 260</b>과 <b>골드 150G</b>.' },
  { name: '늪지 독니 수집', goal: 3, counter: 'bogVials', unit: '개',
    offer: '남서쪽에 <b>독 늪지대</b>가 번지고 있네. 늪의 <b>늪독사</b>에게서 나오는 <b>늪지 독니</b>는 지독한 독을 품고 있어, 약재상이 위험하다며 회수를 부탁해왔네.<br>늪지 독니 <b>3개</b>를 모아다 주게. 수집가에게 팔면 다시 모아야 하니 유의하게.',
    progress: '독 늪지대의 늪지 독니를 부탁했었지.',
    done: '이 독기 어린 독니들, 내가 안전하게 봉인해두겠네.<br>사례일세: <b>골드 130G</b>와 <b>체력 물약 2개</b>.' },
  { name: '늪 거미 토벌', goal: 3, counter: 'bogSpiderKills', unit: '마리',
    offer: '독 늪지대의 <b>늪 거미</b>들이 독 웅덩이를 지키며 영역을 넓히고 있네. 더 번지기 전에 줄여야 하네.<br>늪 거미 <b>3마리</b>를 처치해주게. 물리면 독에 중독되니 물약을 챙기게나.',
    progress: '독 늪지대의 늪 거미를 부탁했었지.',
    done: '늪 거미까지 정리했군! 늪이 한결 안전해졌어.<br>사례일세: <b>최대 체력 260 → 290</b>과 <b>골드 170G</b>.' },
  { name: '늪지 군주 토벌', goal: 1, counter: 'bogLordKills', unit: '마리', abs: true,
    offer: '독 늪지대 깊은 곳, 커다란 <b>늪지 군주</b>가 독 웅덩이를 거느리고 있네. 그놀이 있는 한 늪의 독기는 사라지지 않을 걸세.<br><b>늪지 군주</b>를 처치해주게. 단단한 가드를 두르고 있으니 <b>길게 눌러 강공격</b>으로 가드를 부수게나.',
    progress: '독 늪지대의 늪지 군주를 부탁했었지.',
    done: '늪지 군주를 쓰러뜨렸군! 이제 늪의 독기도 서서히 걷힐 걸세. 자네는 진정 이 언덕의 수호자일세!<br>사례일세: <b>공격력 26 → 30</b>과 <b>골드 200G</b>.' },
  { name: '수배: 피빛 왕쥐', goal: 1, counter: 'bloodRatKills', unit: '마리', abs: true,
    offer: '서쪽 숲 외곽에 소문의 <b>피빛 왕쥐</b>가 나타났다네. 말만 한 쥐가 마을 창고를 털고 주민까지 물었다는군.<br>수배령이 내려왔으니 처치해주게. 몸놀림이 재빠르고 가드를 두르니, <b>길게 눌러 강공격</b>으로 가드를 부수게나.',
    progress: '서쪽 숲 외곽의 피빛 왕쥐를 부탁했었지.',
    done: '피빛 왕쥐를 잡았군! 이제 창고 곡식이 안전하겠어.<br>수배 사례금일세: <b>공격력 30 → 34</b>와 <b>골드 220G</b>.' },
  { name: '수배: 칼날 말벌', goal: 1, counter: 'stormWaspKills', unit: '마리', abs: true,
    offer: '벌집 숲에서 쫓겨난 <b>칼날 말벌</b>이 숲 북쪽 원형 빈터에 웅거하고 있네. 날갯짓이 칼날 같아 지나던 상인이 크게 다쳤다는군.<br>처치해주게. <b>붉은 직선 띠</b>가 보이면 옆으로 이동하거나 회피하게. 돌진 뒤 <b>푸른 반격창</b>을 노리게나.',
    progress: '숲 북쪽 빈터의 칼날 말벌을 부탁했었지.',
    done: '칼날 말벌까지 잡다니! 상인들이 안심하고 길을 다니겠어.<br>수배 사례금일세: <b>최대 체력 290 → 330</b>과 <b>골드 260G</b>.' },
  { name: '수배: 바위등 거미', goal: 1, counter: 'rockSpiderKills', unit: '마리', abs: true,
    offer: '북서 바위 벼랑에 등껍질이 바위 같은 <b>바위등 거미</b>가 자리를 잡았다네. 무엇이든 통째로 삼켜버리는 무서운 놈일세.<br>처치해주게. 단단한 가드를 두르니 <b>길게 눌러 강공격</b>으로 가드를 부수는 게 핵심일세.',
    progress: '북서 바위 벼랑의 바위등 거미를 부탁했었지.',
    done: '바위등 거미를 쓰러뜨렸군! 자네는 이제 언덕 최고의 현상금 사냥꾼일세!<br>수배 사례금일세: <b>공격력 34 → 38</b>과 <b>골드 300G</b>, <b>체력 물약 2개</b>.' },
  { name: '유적 해골 토벌', goal: 3, counter: 'ruinSkelKills', unit: '기',
    offer: '북서쪽에 오래된 <b>잊힌 유적</b>이 발견됐다네. 그곳을 배회하는 <b>유적 해골</b>들이 영역을 넓히기 전에 정리해야 하네.<br>유적 해골 <b>3기</b>를 처치해주게. 모래빛 뼈대가 특징일세.',
    progress: '잊힌 유적의 유적 해골을 부탁했었지.',
    done: '유적 해골들을 정리했군! 유적이 한결 얌전해졌어.<br>사례일세: <b>공격력 38 → 42</b>와 <b>골드 320G</b>.' },
  { name: '유적 수호자 토벌', goal: 2, counter: 'ruinWarKills', unit: '기',
    offer: '잊힌 유적 깊은 곳에는 옛 왕국의 무사였던 <b>유적 수호자</b>들이 아직도 망령으로 남아 자리를 지키고 있네.<br>유적 수호자 <b>2기</b>를 처치해주게. 단단하니 물약을 챙기게나.',
    progress: '잊힌 유적의 유적 수호자를 부탁했었지.',
    done: '수호자들의 망령까지 편히 보내줬군! 이제 유적은 고요히 잠들 수 있겠어.<br>사례일세: <b>최대 체력 330 → 370</b>과 <b>골드 360G</b>.' },
  { name: '유적의 감시자', goal: 1, counter: 'ruinWardenKills', unit: '기', abs: true,
    offer: '잊힌 유적 한가운데, 옛 왕국의 마지막 무장 <b>유적의 감시자</b>가 아직도 출입을 감시하고 있네. 그의 저주를 풀어주는 것이 유적을 진정으로 해방하는 길일세.<br><b>유적의 감시자</b>를 처치해주게. 붉은 원으로 <b>지면파</b>를 예고하네. <b>원 밖으로 이동하거나 회피</b>하고, 공격 후 푸른 원이 보일 때 반격하게나.',
    progress: '잊힌 유적의 감시자를 부탁했었지.',
    done: '감시자의 저주를 풀어줬군! 수백 년의 짐을 내려놓았을 걸세. 자네는 이 언덕의 전설일세!<br>사례일세: <b>공격력 42 → 46</b>과 <b>골드 400G</b>, <b>체력 물약 2개</b>.' },
];
// 기존 20개 의뢰의 진행 구조를 보여 주는 일지. 새로운 장/보상/완료 조건을 더하지 않는다.
const CAMPAIGN_CHAPTERS = [
  {name:'언덕의 첫걸음',from:0,to:5,guide:'기본 공격과 길게 누르는 강공격을 익히고, 서쪽 숲과 지하묘지를 오간다. 스킬 포인트는 K키에서 직접 배분한다.'},
  {name:'갈라진 숲길',from:5,to:10,guide:'변종과 독사, 벌집 숲으로 향한다. 독 개구리의 녹색 직선 예고는 옆으로 피하고, 중독되면 R 물약으로 해독한다.'},
  {name:'늪의 그늘',from:10,to:14,guide:'늪 가장자리에서 독 웅덩이를 피해 이동한다. 단단한 가드는 길게 누르는 강공격이나 회전베기로 부순다.'},
  {name:'세 갈래 수배령',from:14,to:17,guide:'세 수배 대상의 대응을 구분한다. 칼날 말벌의 직선 돌진은 옆으로 비킨 뒤 푸른 반격창을 노린다.'},
  {name:'잊힌 유적',from:17,to:20,guide:'유적의 해골과 수호자를 지나 감시자에게 향한다. 지면파의 붉은 원에서 벗어난 뒤 푸른 반격창에 접근한다.'},
];
function campaignInfo(){
  const done=Math.max(0,Math.min(QUESTS.length,state.quest.idx||0));
  const chapter=CAMPAIGN_CHAPTERS.findIndex(c=>done<c.to);
  return{done,total:QUESTS.length,chapter,chapters:CAMPAIGN_CHAPTERS.map(c=>({name:c.name,done:Math.max(0,Math.min(c.to-c.from,done-c.from)),total:c.to-c.from,locked:done<c.from})),quest:QUESTS[done]?.name||null};
}
function openCampaignJournal(){
  if(!state.ready||state.dead||state.menuOpen)return;
  const info=campaignInfo(),qd=QUESTS[info.done],active=state.quest.state==='active';state.dlgFocus=null;
  let html=`<b>메인 의뢰 ${info.done} / ${info.total} 완료</b><br>`;
  if(qd){const c=CAMPAIGN_CHAPTERS[info.chapter];html+=`현재 ${info.chapter+1}장 · <b>${c.name}</b><br><br><b>${qd.name}</b> · ${active?`${Math.max(0,questProgress())} / ${qd.goal} ${qd.unit}`:'장로에게 수락'}<br>${active?(questProgress()>=qd.goal?'목표를 채웠다. 마을 장로에게 돌아가 보고하자.':`목표: ${qd.goal}${qd.unit}. 목표 추적을 켜면 현재 대상이나 보고 장소를 안내한다.`):'마을 장로와 대화해 다음 의뢰를 받자.'}<br><br>${c.guide}`;}
  else html+='메인 의뢰 기록을 모두 마쳤다. 이것은 모든 탐험 활동이나 플레이 시간의 완료를 뜻하지 않는다. 남은 탐험과 성장 선택은 아래에서 확인할 수 있다.';
  html+='<br><br><b>장별 기록</b>';
  for(const[cidx,c]of CAMPAIGN_CHAPTERS.entries()){
    const p=info.chapters[cidx];
    if(p.locked){html+=`<div style="padding:7px 0;border-top:1px solid #445">${cidx+1}장 · 아직 펼치지 않은 기록</div>`;continue;}
    const names=QUESTS.slice(c.from,Math.min(c.to,info.done)).map(q=>'✓ '+q.name);
    html+=`<details style="padding:7px 0;border-top:1px solid #445"><summary>${cidx+1}장 · ${c.name} · ${p.done}/${p.total}${p.done===p.total?' 완료':''}</summary>${names.length?names.join('<br>'):'아직 완료한 의뢰가 없다.'}</details>`;
  }
  html+=`<br><b>성장 선택</b><br>Lv.${state.level} · 스킬 포인트 ${state.skillPts||0}P · 기본 스킬 ${SKILLS.filter(k=>!k.group&&state.skills[k.id]).length}/8 · 보법 ${footworkId()?'선택':'미선택'}<br>포인트가 있어도 스킬은 자동으로 배우지 않는다. 스킬 창에서 설명과 선행 조건을 확인하자.`;
  html+=`<br>원풍 조율: <b>${windTuneName()}</b> · 종 탐험 완료 뒤 장로 곁 스킬 창에서 무료 교체.`;
  html+=`<br>여행 인장: <b>${insigniaName()}</b> · 해금 ${INSIGNIAS.filter(d=>d.unlocked()).length}/3 · 장로 곁 스킬 창에서 한 개 장착. 관측소·수레·전령길 완료 기록으로 열린다.`;
  html+='<br><br><b>선택 탐험</b> · 메인 의뢰와 별도<br>';
  const optional=[['침묵의 기록원',archiveStatus()],['안개의 항로',mistStatus()],['수문 아래의 종',bellStatus()],['회색 여울',estuaryStatus()],['북서 전령길',courierStatus()],['관측 기록 운반',cartStatus()],['유적 잔향 봉인',echoStatus()],['동쪽 바람 관측소',observatoryStatus()],['꺼진 봉화길',state.beacon?.step===5?'봉화지기 기록 완료':state.beacon?.step?beaconStatus():'묘지의 왕 보고 후 마을 남쪽 출발석에서 시작'],['끊어진 순례길',state.journey===5?'이야기 기록 완료':state.journey?`기록 ${Math.min(3,state.journey-1)}/3 · 여행 수첩(J)에서 다음 단서`:'마을 장로의 여행 수첩에서 시작'],['유적 바람길',state.sealSolved?'무료 왕복길 개통':'유적 남쪽의 비문과 세 문양을 살피기'],['몬스터 소굴',`${(state.densCleared||[]).length}/${DENS.length}곳 정리`],['버려진 망루',state.watchCleared?'수호대장 격파':state.watchFound?'발견 · 수호대장은 남아 있다':'들판에서 망루 찾기'],['시련의 돌',state.trialDone?'시련 완료':'마을 밖 시련의 돌에서 규칙 확인']];
  html+=optional.map(([k,v])=>`<div style="padding:6px 0;border-top:1px solid #445"><b>${k}</b><br>${v}</div>`).join('');
  html+='<br><small>이 일지는 기존 의뢰와 탐험의 진행 안내다. 장 수는 새 콘텐츠 분량이나 권장 플레이 시간을 뜻하지 않는다.</small>';
  const buttons=[];
  if(qd)buttons.push(['메인 목표 추적',()=>{state.tracked='quest';saveGame();closeDialog();toast('메인 의뢰 목표를 추적합니다')}]);
  buttons.push(['스킬 보기',()=>{closeDialog();openSkillTree()}],['여행 수첩',()=>{closeDialog();openJourneyJournal()}]);
  journeyDialog('모험 일지',html,buttons);
}

function variantKillCount() {
  return Object.entries(state.dex || {}).filter(([k]) => ['독 개구리', '그림자 쥐', '서리 스켈레톤'].some((l) => k === l || k === '엘리트 ' + l)).reduce((s, [, n]) => s + n, 0);
}
function questCounter(q) {
  const d = QUESTS[q.idx];
  if (!d) return 0;
  if (d.counter === 'skKills') return state.skKills || 0;
  if (d.counter === 'wKills') return state.wKills || 0;
  if (d.counter === 'fieldKills') return (state.kills || 0) - (state.skKills || 0); // 전사 포함 스켈레톤 제외
  if (d.counter === 'flowers') return state.flowerCount || 0;
  if (d.counter === 'bossKills') return state.bossKills || 0;
  if (d.counter === 'variantKills') return variantKillCount();
  if (d.counter === 'snakeKills') return state.snakeKills || 0;
  if (d.counter === 'kingSnakeKills') return state.kingSnakeKills || 0;
  if (d.counter === 'waspKills') return state.waspKills || 0;
  if (d.counter === 'queenWaspKills') return state.queenWaspKills || 0;
  if (d.counter === 'vials') return state.mats['독니'] || 0; // 실제 보유 수량 기준: 판매·소비 시 진행도도 줄어듦
  if (d.counter === 'bogVials') return state.mats['늪지 독니'] || 0; // 독니 수집과 같은 보유량 기준
  if (d.counter === 'bogSpiderKills') return state.bogSpiderKills || 0;
  if (d.counter === 'bogLordKills') return state.bogLordKills || 0;
  if (d.counter === 'bloodRatKills') return state.bloodRatKills || 0;
  if (d.counter === 'stormWaspKills') return state.stormWaspKills || 0;
  if (d.counter === 'rockSpiderKills') return state.rockSpiderKills || 0;
  if (d.counter === 'ruinSkelKills') return state.ruinSkelKills || 0;
  if (d.counter === 'ruinWarKills') return state.ruinWarKills || 0;
  if (d.counter === 'ruinWardenKills') return state.ruinWardenKills || 0;
  return 0;
}
function applyProgression() {
  const done = state.quest.idx; // idx번째 미만은 완료된 의뢰
  state.maxHp = 100; PLAYER.dmg = 10;
  if (done >= 1) state.maxHp = 130;
  if (done >= 2) PLAYER.dmg = 14;
  if (done >= 3) state.maxHp = 160;
  if (done >= 5) state.maxHp = 190;
  if (done >= 6) PLAYER.dmg = 18;
  if (done >= 7) PLAYER.dmg = 22;
  if (done >= 8) state.maxHp = 220;
  if (done >= 9) PLAYER.dmg = 26;
  if (done >= 10) state.maxHp = 260;
  if (done >= 13) state.maxHp = 290;
  if (done >= 14) PLAYER.dmg = 30;
  if (done >= 15) PLAYER.dmg = 34;
  if (done >= 16) state.maxHp = 330;
  if (done >= 17) PLAYER.dmg = 38;
  if (done >= 18) PLAYER.dmg = 42;
  if (done >= 19) state.maxHp = 370;
  if (done >= 20) PLAYER.dmg = 46;
  if ((state.runes || []).includes('blade')) PLAYER.dmg += 4; // 칼바람 룬
  if ((state.runes || []).includes('hill')) state.maxHp += 40; // 언덕 룬
  state.maxHp += ((state.level || 1) - 1) * 10; // 레벨당 최대 체력 +10
  state.maxHp += (state.shrinesPrayed || []).length * 5; // 바람 제단 축복: 제단당 최대 체력 +5
  if(state.observatory === 4) state.maxHp += 10; // 관측소 기록의 가호, 재계산해도 중첩 안 됨
  if(activeInsignia('guard'))state.maxHp+=25;
  state.hp = Math.min(state.hp, state.maxHp);
}
// ---------- 레벨·경험치 ----------
function xpNeed(level) { return 40 + (level - 1) * 20; }
function gainXp(n) {
  state.xp = (state.xp || 0) + n;
  while (state.xp >= xpNeed(state.level || 1)) {
    state.xp -= xpNeed(state.level || 1);
    state.level = (state.level || 1) + 1;
    state.skillPts = (state.skillPts || 0) + 1;
    applyProgression();
    state.hp = state.maxHp; // 레벨 업 시 완전 회복
    sfx('reward', 1);
    toast(`레벨 업! Lv ${state.level} · 체력 회복 · 스킬 포인트 +1 (K)` + (state.level === 8 ? ' · 장로 곁에서 전투 숙련 선택 가능' : ''));
  }
}

const dlgEl = () => document.getElementById('dlg');
function questProgress() { const d = QUESTS[state.quest.idx]; return d ? Math.min(questCounter(state.quest) - (d.abs ? 0 : state.quest.startKills), d.goal) : 0; } // abs: 1회성 보스 의뢰는 수락 전 선처치도 진행 인정
function tryInteract() {
  if (!state.ready || state.dead || state.dialog) return;
  if (state.npc && state.player.position.distanceTo(state.npc.pos) <= 2.6) { state.dlgFocus = state.npc.pos; openDialog(); return; }
  if (state.npc2 && state.player.position.distanceTo(state.npc2.pos) <= 2.6) { state.dlgFocus = state.npc2.pos; openCollectorDialog(); return; }
  if (state.trialStone && state.player.position.distanceTo(state.trialStone.root.position) <= 2.8) { openTrialDialog(); return; }
  const arc=nearbyArchive();if(arc){openArchive(arc);return;}
  const mist=nearbyMist();if(mist){openMist(mist);return;}
  const bell=nearbyBell();if(bell){openBell(bell);return;}
  const est=nearbyEstuary();if(est){openEstuary(est);return;}
  const courier=nearbyCourier();if(courier){openCourier(courier);return;}
  if(nearbyCart()){openCart();return;}
  const echo=nearbyEcho(); if(echo){openEcho(echo);return;}
  const obs=nearbyObservatory(); if(obs){openObservatoryDialog(obs);return;}
  const seal = nearbySeal();
  if (seal) { openSealDialog(seal); return; }
  const beacon = nearbyBeacon();
  if(beacon){openBeaconDialog(beacon);return;}
  const site = nearbyJourneySite();
  if (site) openJourneySite(site);
}
function offerRunes() { // 유적 해방 후 룬 3택1 선택 (선택은 되돌릴 수 없음)
  state.dialog = true;
  sfx('reward', 0.8);
  document.getElementById('dlg-name').textContent = '바람의 룬';
  document.getElementById('dlg-list').innerHTML = '';
  document.getElementById('dlg-text').innerHTML = '유적의 감시자가 남긴 문양이 세 갈래 바람으로 갈라지네. 자네의 길에 맞는 <b>룬 하나</b>를 선택하게.<br>한번 고른 룬은 되돌릴 수 없다네.';
  const btns = document.getElementById('dlg-btns');
  btns.innerHTML = '';
  for (const r of RUNES) {
    const b = document.createElement('button');
    b.textContent = `${r.name} — ${r.desc}`;
    b.addEventListener('click', () => {
      if ((state.runes || []).length || state.quest.idx < 20) return; // 중복 클릭/이전 버튼 재실행 방지
      state.runes = [...(state.runes || []), r.id];
      applyProgression(); state.hp = Math.min(state.hp, state.maxHp);
      sfx('reward', 1); toast(`룬 획득: ${r.name} (${r.desc})`);
      closeDialog(); saveGame();
    });
    btns.appendChild(b);
  }
  dlgEl().style.display = 'block';
  document.getElementById('dlgback').style.display = 'block';
}
function openDialog() {
  state.dialog = true;
  sfx('dialog', 0.7);
  const q = state.quest;
  const d = QUESTS[q.idx];
  const name = document.getElementById('dlg-name');
  const text = document.getElementById('dlg-text');
  const btns = document.getElementById('dlg-btns');
  btns.innerHTML = '';
  const mk = (label, cls, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', fn);
    btns.appendChild(b);
  };
  name.textContent = '마을 장로';
  if (!d && !(state.runes || []).length) { offerRunes(); return; } // 의뢰 19 완료 후 룬 미선택 시(구 세이브 포함) 우선 제공
  if (!d) {
    // 모든 의뢰 완료 후: 반복 의뢰 (몬스터 처치 ↔ 바람꽃 수집 번갈아 제공)
    const b = state.bounty;
    b.kind = b.kind || 'kills';
    const BOUNTY_ROT = ['kills', 'flowers', 'mats', 'variants', 'elite']; // 처치 → 수집 → 재료 납품 → 변종 → 엘리트 순환
    if (b.kind === 'mats' && !b.mat) b.mat = BOUNTY_MATS[(b.count || 0) % BOUNTY_MATS.length];
    const goal = bountyGoal(b);
    const prog = bountyProg(b);
    const what = b.kind === 'flowers' ? '바람꽃 <b>4송이</b> 수집' : b.kind === 'variants' ? '변종 <b>2마리</b> 처치' : b.kind === 'elite' ? '엘리트 <b>1마리</b> 토벌' : b.kind === 'mats' ? '<b>' + b.mat + ' 3개</b> 납품' : '몬스터 <b>8마리</b> 처치';
    const reward = 35 + Math.min(b.count * 5, 25) + (b.kind === 'variants' ? 15 : 0) + (b.kind === 'elite' ? 25 : 0) + (b.kind === 'mats' ? (MAT_PRICE[b.mat] || 5) * 3 : 0); // 변종·엘리트는 위험수당, 납품은 재료값 보전
    const acceptText = b.kind === 'flowers' ? '바람꽃 4송이 수집' : b.kind === 'variants' ? '변종 2마리 처치' : b.kind === 'elite' ? '엘리트 1마리 토벌' : b.kind === 'mats' ? b.mat + ' 3개 납품' : '몬스터 8마리 처치';
    if (b.active && prog >= goal) {
      text.innerHTML = `의뢰를 마쳤군! 목표 달성(${what})을 확인했네.<br>사례일세: <b>골드 ${reward}</b>.`;
      mk('사례를 받는다', '', () => { state.gold += reward; if (b.kind === 'mats') { state.mats[b.mat] = Math.max(0, (state.mats[b.mat] || 0) - 3); b.mat = null; } b.count++; b.active = false; b.kind = BOUNTY_ROT[(BOUNTY_ROT.indexOf(b.kind) + 1) % BOUNTY_ROT.length]; sfx('reward', 1); closeDialog(); saveGame(); });
    } else if (b.active) {
      text.innerHTML = `반복 의뢰: ${what} — 현재 <b>${prog} / ${goal}</b>.<br>조금만 더 힘내주게.`;
      mk('계속', '', closeDialog);
    } else {
      text.innerHTML = `마을의 모든 부탁을 들어주었네. 자네는 이제 이 언덕의 영웅일세.<br>바람 언덕에서 마음껏 유랑하게나.<br><br>마을에는 늘 손이 모자라니, <b>반복 의뢰</b>(${what})도 맡아주면 고맙겠네.`;
      mk('의뢰를 받는다', '', () => { b.active = true; b.startKills = state.kills; b.startFlowers = state.flowerCount; b.startVariants = variantKillCount(); b.startElites = state.eliteKills || 0; if (b.kind === 'mats') b.startMats = state.mats[b.mat] || 0; sfx('dialog', 0.7); closeDialog(); saveGame(); toast(`반복 의뢰: ${acceptText}`); });
      mk('닫기', '', closeDialog);
    }
  } else if (q.state === 'none') {
    text.innerHTML = d.offer;
    mk('수락한다', '', () => { q.state = 'active'; q.startKills = questCounter(q); closeDialog(); saveGame(); });
    mk('나중에', 'sub', closeDialog);
  } else if (q.state === 'active' && questProgress() >= d.goal) {
    text.innerHTML = d.done;
    mk('사례를 받는다', '', () => {
      const claimed = q.idx;
      q.idx++; q.state = 'none'; q.startKills = 0;
      applyProgression(); state.hp = state.maxHp;
      // 의뢰별 추가 사례 (골드/물약은 수령 시 1회 지급, 세이브에 저장됨)
      if (claimed === 3) { state.gold += 40; state.potions = Math.min(SHOP.potionMax, state.potions + 2); }
      if (claimed === 4) { state.gold += 60; }
      if (claimed === 5) { state.gold += 80; }
      if (claimed === 7) { state.gold += 120; }
      if (claimed === 8) { state.gold += 100; state.potions = Math.min(SHOP.potionMax, state.potions + 2); state.mats['독니'] = Math.max(0, (state.mats['독니'] || 0) - 3); } // 독니 3개 납품
      if (claimed === 10) { state.gold += 150; }
      if (claimed === 11) { state.gold += 130; state.potions = Math.min(SHOP.potionMax, state.potions + 2); state.mats['늪지 독니'] = Math.max(0, (state.mats['늪지 독니'] || 0) - 3); } // 늪지 독니 3개 납품
      if (claimed === 12) { state.gold += 170; }
      if (claimed === 13) { state.gold += 200; }
      if (claimed === 14) { state.gold += 220; }
      if (claimed === 15) { state.gold += 260; }
      if (claimed === 16) { state.gold += 300; state.potions = Math.min(SHOP.potionMax, state.potions + 2); }
      if (claimed === 17) { state.gold += 320; }
      if (claimed === 18) { state.gold += 360; }
      if (claimed === 19) { state.gold += 400; state.potions = Math.min(SHOP.potionMax, state.potions + 2); }
      const runeOffer = claimed === 19;
      sfx('reward', 1);
      closeDialog(); saveGame();
      if (runeOffer) offerRunes(); // 의뢰 19 사례 수령 직후 룬 선택
    });
  } else if (q.state === 'active') {
    text.innerHTML = `${d.progress} 현재 <b>${questProgress()} / ${d.goal}</b> ${d.unit}네.<br>조금만 더 힘내주게.`;
    mk('계속', '', closeDialog);
  }
  mk('여행 수첩', 'sub', openJourneyJournal);
  mk('상점', 'sub', openShop);
  document.getElementById('dlg-list').innerHTML = '';
  dlgEl().style.display = 'block';
  document.getElementById('dlgback').style.display = 'block';
}
const SHOP = { potionPrice: 30, potionMax: 5, potionHeal: 60 };
function openShop() {
  sfx('dialog', 0.5);
  const text = document.getElementById('dlg-text');
  const list = document.getElementById('dlg-list');
  const btns = document.getElementById('dlg-btns');
  document.getElementById('dlg-name').textContent = '마을 장로 · 상점';
  btns.innerHTML = '';
  // 상품 행(카드) 배치: 이름·효과는 좌측, 구매 버튼은 우측
  const rows = [];
  const mkRow = (infoHtml, btnLabel, onBuy) => {
    const row = document.createElement('div');
    row.className = 'shoprow';
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = infoHtml;
    const b = document.createElement('button');
    b.addEventListener('click', () => { if (b.disabled) return; onBuy(); });
    b._label = btnLabel;
    row.appendChild(info); row.appendChild(b);
    list.appendChild(row);
    rows.push({ b, info });
    return b;
  };
  const potionBtn = mkRow('', '', () => {
    if (state.gold < SHOP.potionPrice || state.potions >= SHOP.potionMax) return;
    state.gold -= SHOP.potionPrice;
    state.potions++;
    sfx('reward', 1);
    toast('체력 물약을 샀습니다');
    saveGame();
    render();
  });
  const gearBtns = GEAR_SHOP.map((g) => mkRow('', '', () => {
    const lvl = state.gear[g.key];
    if (lvl >= g.names.length || state.gold < g.prices[lvl]) return;
    const req = g.mats && g.mats[lvl];
    if (req && !req.every(([mn, n]) => (state.mats[mn] || 0) >= n)) return;
    state.gold -= g.prices[lvl];
    if (req) for (const [mn, n] of req) state.mats[mn] -= n;
    state.gear[g.key] = lvl + 1;
    sfx('reward', 1);
    toast(`${g.names[lvl]}을(를) 장착했습니다`);
    saveGame();
    render();
  }));
  const render = () => {
    const owned = GEAR_SHOP.map((g) => state.gear[g.key] > 0 ? g.names[state.gear[g.key] - 1] : null).filter(Boolean);
    text.innerHTML = `보유 골드: <b>${state.gold}G</b> · 장비: ${owned.length ? owned.join(', ') : '없음'}`;
    rows[0].info.innerHTML = `체력 물약 <small>회복 ${SHOP.potionHeal} · 보유 ${state.potions}/${SHOP.potionMax}개</small>`;
    potionBtn.textContent = state.potions >= SHOP.potionMax ? '가득 참' : `${SHOP.potionPrice}G`;
    potionBtn.disabled = state.potions >= SHOP.potionMax || state.gold < SHOP.potionPrice;
    GEAR_SHOP.forEach((g, i) => {
      const lvl = state.gear[g.key];
      const b = gearBtns[i];
      if (lvl >= g.names.length) {
        rows[i + 1].info.innerHTML = `${g.names[lvl - 1]} <small>최고 등급 보유 중</small>`;
        b.textContent = '보유';
        b.disabled = true;
        return;
      }
      const ownedPrev = lvl > 0 ? ` <small>(보유: ${g.names[lvl - 1]})</small>` : '';
      const req = g.mats && g.mats[lvl];
      const reqStr = req ? ` · 재료: ${req.map(([mn, n]) => `${mn}×${n}(보유 ${state.mats[mn] || 0})`).join(', ')}` : '';
      rows[i + 1].info.innerHTML = `${g.names[lvl]} <small>${g.desc[lvl]}${reqStr}</small>${ownedPrev}`;
      b.textContent = `${g.prices[lvl]}G${req ? ' + 재료' : ''}`;
      b.disabled = state.gold < g.prices[lvl] || (req && !req.every(([mn, n]) => (state.mats[mn] || 0) >= n));
    });
  };
  const back = document.createElement('button');
  back.textContent = '돌아가기';
  back.className = 'sub';
  back.addEventListener('click', openDialog);
  btns.appendChild(back);
  render();
  // 상점이 열려 있는 동안 골드 등 외부 변화(상자 자동 개봉 등)가 있으면 표시를 따라가게 갱신
  clearInterval(window.__shopIv);
  window.__shopIv = setInterval(() => {
    if (document.getElementById('dlg-name').textContent !== '마을 장로 · 상점' || dlgEl().style.display === 'none') { clearInterval(window.__shopIv); return; }
    render();
  }, 500);
}
// ---------- 인벤토리 (I 키 / 가방 버튼) ----------
function openInv() {
  if (!state.ready || state.dead) return;
  state.dialog = true;
  sfx('dialog', 0.5);
  document.getElementById('dlg-name').textContent = '인벤토리';
  const list = document.getElementById('dlg-list');
  const btns = document.getElementById('dlg-btns');
  btns.innerHTML = '';
  const renderInv = () => {
    document.getElementById('dlg-text').innerHTML =
      `레벨 <b>${state.level || 1}</b> (경험치 ${state.xp || 0}/${xpNeed(state.level || 1)}) · 공격력 <b>${PLAYER.dmg + GEAR_ATK[state.gear.sword]}</b> · 받는 피해 감소 <b>${GEAR_DEF[state.gear.armor]}</b> · 이동속도 <b>×${+(GEAR_SPD[state.gear.boots] * ((state.runes || []).includes('gale') ? 1.08 : 1)).toFixed(2)}</b> · 룬 <b>${(state.runes || []).length ? (state.runes || []).map((id) => (RUNES.find((r) => r.id === id) || {}).name).filter(Boolean).join(', ') : '없음'}</b><br>` +
      `골드 <b>${state.gold}G</b> · 물약 <b>${state.potions}/${SHOP.potionMax}</b> · 바람꽃 <b>${state.flowerCount}송이(판매 가능 ${(state.flowerCount || 0) - (state.flowersSold || 0)})</b> · 보물 상자 <b>${(state.chestsOpened || []).length}개</b> · 재료 <b>${Object.entries(state.mats || {}).filter(([, n]) => n > 0).map(([mn, c]) => `${mn}×${c}`).join(' ') || '없음'}</b>`;
    const gearOwned = GEAR_SHOP.map((g) => state.gear[g.key] > 0 ? `${g.names[state.gear[g.key] - 1]}(${g.key === 'sword' ? '검' : g.key === 'armor' ? '갑옷' : '부츠'})` : null).filter(Boolean);
    list.innerHTML =
      `<div class="shoprow"><div class="info">장비 <small>${gearOwned.length ? gearOwned.join(', ') : '없음'}</small></div></div>` +
      `<div class="shoprow"><div class="info"><b>몬스터 도감 ${Object.keys(state.dex).length}종</b></div></div>` +
      (Object.keys(state.dex).length
        ? Object.entries(state.dex).sort((a, b) => b[1] - a[1]).map(([label, n]) => `<div class="shoprow"><div class="info">${label} <small>${n}마리 처치</small></div></div>`).join('')
        : '<div class="shoprow"><div class="info"><small>아직 처치한 몬스터가 없습니다</small></div></div>') +
      `<div class="shoprow"><div class="info"><b>업적 ${Object.keys(state.ach).length}/${ACH.length}</b></div></div>` +
      ACH.map((a) => `<div class="shoprow"><div class="info">${state.ach[a.id] ? '<b style="color:#8fd68f">[달성]</b>' : '<small>[미달성]</small>'} ${a.name}</div></div>`).join('');
  };
  const close = document.createElement('button');
  close.textContent = '닫기';
  close.className = 'sub';
  close.addEventListener('click', closeDialog);
  btns.appendChild(close);
  renderInv();
  dlgEl().style.display = 'block';
  document.getElementById('dlgback').style.display = 'block';
  // 패널이 열려 있는 동안 골드·물약 등 변화를 따라가게 갱신
  clearInterval(window.__invIv);
  window.__invIv = setInterval(() => {
    if (document.getElementById('dlg-name').textContent !== '인벤토리' || dlgEl().style.display === 'none') { clearInterval(window.__invIv); return; }
    renderInv();
  }, 500);
}
function toggleInv() {
  const invOpen = dlgEl().style.display !== 'none' && document.getElementById('dlg-name').textContent === '인벤토리';
  if (invOpen) { closeDialog(); return; }
  if (state.dialog) return; // 다른 대화·상점이 열려 있으면 열지 않음
  openInv();
}
// ---------- 스킬 트리 (K 키 / 스킬 버튼) ----------
function openSkillTree() {
  if (!state.ready || state.dead) return;
  state.dialog = true;
  sfx('dialog', 0.5);
  dlgEl().classList.add('skilltree');
  document.getElementById('dlg-name').textContent = '스킬 트리';
  const list = document.getElementById('dlg-list');
  const btns = document.getElementById('dlg-btns');
  const renderTree = () => {
    document.getElementById('dlg-text').innerHTML = `보유 스킬 포인트 <b>${state.skillPts || 0}</b> · 레벨업 시 +1<br><small>현재 ${dodgeProfile().name} · ${dodgeProfile().distance}m / 무적${dodgeProfile().inv}초 / 쿨${dodgeProfile().cooldown.toFixed(2)}초</small>`;
    list.innerHTML='';renderInsignias(list,renderTree);
    list.innerHTML += SKILLS.map((s) => {
      const owned = hasSkill(s.id);
      const form=s.group==='footwork',other=form&&SKILLS.some(k=>k.group==='footwork'&&k.id!==s.id&&hasSkill(k.id));
      const locked = (s.req && !hasSkill(s.req)) || (form&&!footworkUnlocked());
      const can = !owned && !locked && !other && (!form||footworkSafe()) && (state.skillPts || 0) >= (s.cost||1);
      const reqName = locked ? (s.req&&!hasSkill(s.req)?SKILLS.find(x=>x.id===s.req).name:'Lv.10 + 기록원 원본 인계') : '';
      return `${s.id==='shortstep'?'<div class="shoprow"><div class="info"><b>보법 연마 · Lv.10 + 기록원 원본 인계 + 잔상</b><br><small>2택1 · 각2P. 장로 곁2.6m·주변12m 적 없음에서 습득·해제. 해제 시 이 보법의 2P만 반환. 기존 스킬/체력/쿨 유지.</small></div></div>':''}<div class="shoprow"><div class="info">${owned ? '<b style="color:#8fd68f">[습득]</b> ' : locked ? '<small>[잠김] </small>' : ''}<b>${s.branch} · ${s.name}</b><br><small>${s.desc}${locked ? ` (선행: ${reqName})` : ''}</small></div>${!owned && !locked ? `<button data-skill="${s.id}" ${can ? '' : 'disabled'}>습득 (${s.cost||1}P)</button>` : ''}</div>`;
    }).join('');
    const learnedForm=SKILLS.find(s=>s.group==='footwork'&&hasSkill(s.id));
    if(learnedForm)list.innerHTML+=`<div class="shoprow"><div class="info"><b>보법 연마 해제</b><br><small>${learnedForm.name}에 쓴 2P만 반환 · 기본 회피로 복귀</small></div><button data-footwork-refund ${footworkSafe()?'':'disabled'}>해제 (+2P)</button></div>`;
    const safe = masterySafe();
    list.innerHTML += `<div class="shoprow"><div class="info"><b>Lv.8 전투 숙련 · 3택1</b><br><small>현재: ${MASTERIES.find(m=>m.id===state.mastery)?.name || '미선택'} · 기존 스킬/포인트 유지<br>장로 곁 2.6m · 주변 12m 적 없음일 때 무료 선택·교체. 전투 중 교체 불가.</small></div></div>` + MASTERIES.map(m=>{
      const owned = state.mastery === m.id;
      const can = safe && (!m.req || hasSkill(m.req));
      return `<div class="shoprow"><div class="info"><b>${m.name}${owned ? ' [선택 중]' : ''}</b><br><small>${m.desc}${m.req && !hasSkill(m.req) ? ` (${SKILLS.find(s=>s.id===m.req)?.name||m.req} 습득 필요)` : ''}</small></div><button data-mastery="${m.id}" ${!can || owned ? 'disabled' : ''}>${owned?'선택 중':'무료 선택'}</button></div>`;
    }).join('');
    bindInsignias(list,renderTree);
    list.querySelector('[data-footwork-refund]')?.addEventListener('click',()=>{refundFootwork();renderTree();});
    list.querySelectorAll('button[data-mastery]').forEach(b=>b.addEventListener('click',()=>{
      const m = MASTERIES.find(m=>m.id===b.dataset.mastery);
      if (!m || !masterySafe() || (m.req && !hasSkill(m.req)) || state.mastery===m.id) return;
      state.mastery = m.id; resetMasteryCombat(); saveGame(); sfx('reward',.8); toast(`전투 숙련: ${m.name}`); renderTree();
    }));
    list.querySelectorAll('button[data-skill]').forEach((b) => b.addEventListener('click', () => {
      const s = SKILLS.find((x) => x.id === b.dataset.skill);
      if (!s || hasSkill(s.id) || (state.skillPts || 0) < (s.cost||1) || (s.req && !hasSkill(s.req))) return;
      if(s.group==='footwork'&&(!footworkSafe()||SKILLS.some(k=>k.group==='footwork'&&hasSkill(k.id))))return;
      state.skillPts-=s.cost||1; state.skills[s.id] = true;
      sfx('reward', 1);
      toast(s.id === 'windshot' ? '바람칼날 해금! G키 또는 바람칼날 버튼' : s.id === 'whirl' ? '회전베기 해금! F키 또는 회전베기 버튼' : `스킬 습득: ${s.name}`);
      saveGame(); updateWhirlBtn(); renderTree();
    }));
  };
  btns.innerHTML = '';
  const close = document.createElement('button');
  close.textContent = '닫기';
  close.className = 'sub';
  close.addEventListener('click', closeDialog);
  btns.appendChild(close);
  const tuneBtn=document.createElement('button');tuneBtn.textContent='원풍 조율';tuneBtn.className='sub';tuneBtn.addEventListener('click',openWindTune);btns.appendChild(tuneBtn);
  renderTree();
  dlgEl().style.display = 'block';
  document.getElementById('dlgback').style.display = 'block';
}
function toggleSkillTree() {
  const open = dlgEl().style.display !== 'none' && document.getElementById('dlg-name').textContent === '스킬 트리';
  if (open) { closeDialog(); return; }
  if (state.dialog) return;
  openSkillTree();
}
function updateWhirlBtn() {
  const b = document.getElementById('whirl');
  if (b) b.style.display = hasSkill('whirl') ? 'flex' : 'none';
  windBtn.style.display = hasSkill('windshot') ? 'flex' : 'none';
}

// ---------- 미니맵 (M 키로 켜기/끄기, 탭하면 크기 전환) ----------
const mmap = document.getElementById('minimap');
const mctx = mmap.getContext('2d');
const MMAP_RANGE = 85; // 플레이어 중심 ±85m 표시
let mmapLast = -1;
function toggleMinimap() { mmap.classList.toggle('off'); }
mmap.addEventListener('click', (e) => { e.stopPropagation(); mmap.classList.toggle('big'); });
mmap.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); mmap.classList.toggle('big'); }, { passive: false });
function drawMinimap() {
  if (mmap.classList.contains('off')) return;
  const now = clock.elapsedTime;
  if (now - mmapLast < 0.25) return;
  mmapLast = now;
  const W = mmap.width, H = mmap.height, cx = W / 2, cz = H / 2;
  const p = state.player.position;
  const px = (x) => cx + ((x - p.x) / MMAP_RANGE) * (W / 2);
  const pz = (z) => cz + ((z - p.z) / MMAP_RANGE) * (H / 2);
  mctx.clearRect(0, 0, W, H);
  const dot = (x, z, color, r) => { mctx.fillStyle = color; mctx.beginPath(); mctx.arc(px(x), pz(z), r, 0, Math.PI * 2); mctx.fill(); };
  if (DUNGEON.half) {
    mctx.strokeStyle = 'rgba(150,120,255,.7)';
    mctx.strokeRect(px(DUNGEON.cx - DUNGEON.half), pz(DUNGEON.cz - DUNGEON.half), ((DUNGEON.half * 2) / MMAP_RANGE) * (W / 2), ((DUNGEON.half * 2) / MMAP_RANGE) * (H / 2));
  }
  if (state.chests) for (const c of state.chests) if (!c.opened) dot(c.x, c.z, '#ffd94d', 3);
  if (state.treasure && !state.treasureDone) dot(state.treasure.x, state.treasure.z, '#7de8ff', 4);
  if (state.dens) for (const d of state.dens) if (!d.cleared) dot(d.x, d.z, '#ff6a5a', 3);
  if (state.golden && state.golden.active && !state.golden.active.dead) dot(state.golden.active.root.position.x, state.golden.active.root.position.z, '#fff04a', 4.5);
  if (state.rings) for (const r of state.rings) if (!r.passed) dot(r.x, r.z, '#9fdcff', 3.5);
  if (!state.watchCleared) dot(WATCH_POS.x, WATCH_POS.z, state.watchFound ? '#e8a04c' : '#b8b2a6', 3.5); // 버려진 망루: 미발견 회색 → 발견 후 호박색
  if (state.swampPos) dot(state.swampPos.x, state.swampPos.z, '#8aa24f', 4); // 독 늪지대
  if (state.ruinsPos) dot(state.ruinsPos.x, state.ruinsPos.z, state.ruinsFound ? '#d8cba8' : '#b8b2a6', 4); // 잊힌 유적: 미발견 회색 → 발견 후 모래색
  for (const d of state.journeySites || []) dot(d.x,d.z,state.journey>d.step?'#8aa2a2':'#8be1e5',3);
  if(archiveReady()){mctx.strokeStyle='#b8c5dc';mctx.strokeRect(px(230),pz(-32),60/MMAP_RANGE*W/2,64/MMAP_RANGE*H/2);mctx.fillStyle='#738b9e';for(const c of colliders)if(c.archiveWall)mctx.fillRect(px(c.x)-1,pz(c.z)-1,2,2);for(const d of ARCHIVE_SITES)dot(d.x,d.z,'#c0d8ed',3);}
  if(mistReady())for(const d of MIST_LAMPS)dot(d.x,d.z,'#ffedaf',4);
  if(bellReady())for(const d of BELL_SITES)dot(d.x,d.z,'#ffda78',3);
  if(estuaryReady()){dot(70,-12,'#98e2ed',4);mctx.strokeStyle='rgba(110,200,210,.8)';mctx.beginPath();mctx.arc(px(150),pz(0),32/MMAP_RANGE*W/2,0,Math.PI*2);mctx.stroke();for(const d of ESTUARY_SITES.slice(1))dot(d.x,d.z,'#98e2ed',3);}
  if(state.courier!==3)dot(-47,-14,'#f2ce81',4);
  if(state.cartModel&&state.cartStage!==3)dot(state.cartModel.root.position.x,state.cartModel.root.position.z,'#78e4d8',4);
  dot(-8,-58,state.echo===2?'#d8c47c':'#bca0fa',4);
  dot(60,5,state.observatory===4?'#e8cf7c':'#6ee0ed',4);
  for (const d of state.sealObjects || []) if (d.id.endsWith('Gate')) dot(d.x, d.z, state.sealSolved ? '#83dcff' : '#737b87', 4);
  if (state.flowers) for (const f of state.flowers) if (!f.taken) dot(f.x, f.z, '#7de87d', 2.5);
  if (state.npc) dot(state.npc.pos.x, state.npc.pos.z, '#6db3ff', 3.5);
  if (state.npc2) dot(state.npc2.pos.x, state.npc2.pos.z, '#6db3ff', 3.5);
  for (const e of state.enemies) { if (e.dead) continue; dot(e.root.position.x, e.root.position.z, e.stats.elite ? '#ff9040' : '#ff5555', e.stats.elite ? 3.5 : 2.5); }
  if (state.boss && !state.boss.dead) dot(state.boss.root.position.x, state.boss.root.position.z, '#c080ff', 4);
  mctx.save();
  mctx.translate(cx, cz);
  mctx.rotate(Math.PI - state.heading);
  mctx.fillStyle = '#fff';
  mctx.beginPath(); mctx.moveTo(0, -5); mctx.lineTo(3.5, 4); mctx.lineTo(-3.5, 4); mctx.closePath(); mctx.fill();
  mctx.restore();
}
const COLLECTOR = { flowerPrice: 6 };
// 몬스터 재료 드롭 (일반 45%, 엘리트 100%×2, 보스 100%×3) — 수집가가 매입
const MATS = {
  '스켈레톤': { name: '뼈 조각', price: 4 },
  '스켈레톤 전사': { name: '투구 파편', price: 8 },
  '개구리': { name: '개구리 기름', price: 3 },
  '쥐': { name: '부드러운 가죽', price: 3 },
  '거미': { name: '거미줄', price: 5 },
  '묘지의 왕': { name: '왕의 유품', price: 40 },
  '망루 수호대장': { name: '수호대장 투구', price: 22 },
  '유적의 감시자': { name: '감시자 문장', price: 30 },
  '독 개구리': { name: '독 주머니', price: 6 },
  '그림자 쥐': { name: '그림자 가죽', price: 5 },
  '서리 스켈레톤': { name: '서리 뼈', price: 7 },
  '독사': { name: '독니', price: 7 },
  '왕독사': { name: '맹독 주머니', price: 12 },
  '말벌': { name: '벌집 조각', price: 9 },
  '여왕벌': { name: '여왕벌 침', price: 30 },
  '늪지 군주': { name: '군주의 독주머니', price: 60 },
  '늪독사': { name: '늪지 독니', price: 10 },
  '늪 거미': { name: '늪 거미줄', price: 8 },
  '유적 해골': { name: '고대 뼈 조각', price: 11 },
  '유적 수호자': { name: '수호자 판금', price: 14 },
  '피빛 왕쥐': { name: '피빛 갈기', price: 25 },
  '칼날 말벌': { name: '칼날 날개', price: 28 },
  '바위등 거미': { name: '바위 등껍질', price: 32 },
};
const MAT_PRICE = Object.fromEntries(Object.values(MATS).map((m) => [m.name, m.price]));
// 반복 의뢰 '재료 납품' 변형: 리스폰되는 몹의 재료만 대상 (1회성 보스 재료 제외). 목표 3개, 수령 시 납품 소비
const BOUNTY_MATS = ['뼈 조각', '거미줄', '독니', '벌집 조각', '늪지 독니', '늪 거미줄', '맹독 주머니', '독 주머니', '그림자 가죽', '서리 뼈'];
function bountyGoal(b) { return b.kind === 'flowers' ? 4 : b.kind === 'variants' ? 2 : b.kind === 'elite' ? 1 : b.kind === 'mats' ? 3 : 8; }
function bountyProg(b) { return b.kind === 'flowers' ? state.flowerCount - (b.startFlowers || 0) : b.kind === 'variants' ? variantKillCount() - (b.startVariants || 0) : b.kind === 'elite' ? state.eliteKills - (b.startElites || 0) : b.kind === 'mats' ? (state.mats[b.mat] || 0) - (b.startMats || 0) : state.kills - (b.startKills || 0); }
// 수집가 특별 주문: 무작위 재료를 고급(기본가의 2.5배)에 매입. 납품하면 다음 주문 생성
const ORDER_POOL = ['뼈 조각', '투구 파편', '개구리 기름', '부드러운 가죽', '거미줄', '독 주머니', '그림자 가죽', '서리 뼈'];
function genOrder(exclude) {
  const pool = ORDER_POOL.filter((m) => m !== exclude);
  const mat = pool[Math.floor(Math.random() * pool.length)];
  const count = 3 + Math.floor(Math.random() * 3);
  return { mat, count, reward: Math.round((MAT_PRICE[mat] || 4) * count * 2.5) };
}
function openCollectorDialog() {
  state.dialog = true;
  sfx('dialog', 0.7);
  const name = document.getElementById('dlg-name');
  const text = document.getElementById('dlg-text');
  const btns = document.getElementById('dlg-btns');
  btns.innerHTML = '';
  const mk = (label, cls, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', fn);
    btns.appendChild(b);
  };
  name.textContent = '수집가';
  const sellable = (state.flowerCount || 0) - (state.flowersSold || 0);
  const matEntries = Object.entries(state.mats || {}).filter(([, n]) => n > 0);
  const matsTotal = matEntries.reduce((s, [mn, c]) => s + (MAT_PRICE[mn] || 0) * c, 0);
  let html = sellable > 0
    ? `오, 바람꽃을 가져왔군! 좋은 약재지.<br>지금 팔 수 있는 <b>${sellable}송이</b>를 송이당 <b>${COLLECTOR.flowerPrice}G</b>에 사주겠네.`
    : `바람꽃은 서쪽 숲에서 나오네. 빛나는 꽃을 꺾어오면 송이당 <b>${COLLECTOR.flowerPrice}G</b>에 사주지.<br>장로 의뢰에 쓴 꽃은 팔 수 없으니 유의하게.`;
  html += matEntries.length
    ? `<br>몬스터 재료도 사고 있네: ${matEntries.map(([mn, c]) => `${mn} ×${c}`).join(', ')} — 전부 <b>${matsTotal}G</b>에 사지.`
    : '<br>몬스터가 떨어뜨리는 재료도 가져오면 사주겠네.';
  if (!state.order) state.order = genOrder();
  const od = state.order;
  const odHave = state.mats[od.mat] || 0;
  html += `<br>특별 주문이 있네: <b>${od.mat} ×${od.count}</b> — 납품하면 두둑이 <b>${od.reward}G</b>를 주지. (보유 ${odHave}개, 지금까지 ${state.orderDone || 0}회 납품)`;
  text.innerHTML = html;
  if (sellable > 0) {
    mk(`바람꽃 ${sellable}송이 판매 (+${sellable * COLLECTOR.flowerPrice}G)`, '', () => {
      state.gold += sellable * COLLECTOR.flowerPrice;
      state.flowersSold = (state.flowersSold || 0) + sellable;
      sfx('reward', 1);
      toast(`바람꽃 ${sellable}송이 판매 · +${sellable * COLLECTOR.flowerPrice}G`);
      closeDialog(); saveGame();
    });
  }
  if (matsTotal > 0) {
    mk(`재료 모두 판매 (+${matsTotal}G)`, '', () => {
      state.gold += matsTotal;
      state.mats = {};
      sfx('reward', 1);
      toast(`재료 판매 · +${matsTotal}G`);
      closeDialog(); saveGame();
    });
  }
  if (odHave >= od.count) {
    mk(`특별 주문 납품: ${od.mat} ×${od.count} (+${od.reward}G)`, '', () => {
      state.mats[od.mat] -= od.count;
      state.gold += od.reward;
      state.orderDone = (state.orderDone || 0) + 1;
      state.order = genOrder(od.mat);
      sfx('reward', 1);
      toast(`특별 주문 완료 · +${od.reward}G`);
      checkAch();
      closeDialog(); saveGame();
    });
  }
  mk('닫기', 'sub', closeDialog);
  document.getElementById('dlg-list').innerHTML = '';
  dlgEl().style.display = 'block';
  document.getElementById('dlgback').style.display = 'block';
}
function closeDialog() {
  dlgEl().classList.remove('skilltree','journey-dialog');
  state.dlgFocus = null;
  state.dialog = false;
  dlgEl().style.display = 'none';
  document.getElementById('dlgback').style.display = 'none';
  clearInterval(window.__shopIv);
  clearInterval(window.__invIv);
}
document.getElementById('prompt').addEventListener('click', tryInteract);
document.getElementById('prompt').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); tryInteract(); }, { passive: false });

// ---------- 세이브 (localStorage) ----------
const SAVE_KEY = 'windhill-save';
function saveGame() {
  if (!state.ready) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      x: state.player.position.x, z: state.player.position.z,
      hp: state.hp, maxHp: state.maxHp, kills: state.kills, skKills: state.skKills || 0, wKills: state.wKills || 0,
      heading: state.heading, quest: state.quest, tutDone: state.tutDone, snakeKills: state.snakeKills || 0, kingSnakeKills: state.kingSnakeKills || 0, vials: state.vials || 0, waspKills: state.waspKills || 0, queenWaspKills: state.queenWaspKills || 0, bogSpiderKills: state.bogSpiderKills || 0, bogLordKills: state.bogLordKills || 0, bloodRatKills: state.bloodRatKills || 0, stormWaspKills: state.stormWaspKills || 0, rockSpiderKills: state.rockSpiderKills || 0, ruinSkelKills: state.ruinSkelKills || 0, ruinWarKills: state.ruinWarKills || 0, ruinWardenKills: state.ruinWardenKills || 0, ruinsFound: !!state.ruinsFound,
      gold: state.gold, potions: state.potions, bossKills: state.bossKills || 0, eliteKills: state.eliteKills || 0, flowerCount: state.flowerCount || 0, flowersSold: state.flowersSold || 0, dex: state.dex, mats: state.mats, level: state.level || 1, xp: state.xp || 0,
      bounty: state.bounty, tracked: state.tracked || 'auto', mastery: state.mastery || null, skills: state.skills || {}, skillPts: state.skillPts || 0, chestsOpened: state.chestsOpened || [], shrinesPrayed: state.shrinesPrayed || [], trialDone: state.trialDone || 0, gear: state.gear, ach: state.ach, order: state.order || null, orderDone: state.orderDone || 0,
      observatory: state.observatory || 0, observatorySeen: !!state.observatorySeen,
      beacon: {step:state.beacon?.step||0,supply:state.beacon?.supply||null},
      cartStage: state.cartStage || 0, courier: state.courier || 0, insignia: state.insignia || null, estuary:{stage:state.estuary.stage,rescued:state.estuary.rescued,bossWon:!!state.estuary.bossWon}, bell:{stage:state.bell.stage,clues:state.bell.clues,input:state.bell.input}, windTune:piercingWind()?'pierce':null, mist:{stage:state.mist.stage,lamps:state.mist.lamps}, archive:{...state.archive},
      echo: state.echo || 0,
      journey: state.journey || 0, journeyEnding: state.journeyEnding || null,
      sealSolved: !!state.sealSolved,
      runes: state.runes || [],
      mapFrags: state.mapFrags || 0, treasureDone: !!state.treasureDone, densCleared: state.densCleared || [], ringsPassed: state.ringsPassed || [], watchFound: !!state.watchFound, watchCleared: !!state.watchCleared,
      playTime: Math.floor(state.playTime || 0),
    }));
  } catch (e) { console.warn('save fail', e); }
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    state.player.position.set(s.x ?? 0, 0, s.z ?? 8); // 기본 스폰은 마을 남쪽 빈터(시장 노점 북쪽 8m)
    state.heading = s.heading || 0;
    state.player.rotation.y = state.heading;
    state.hp = s.hp ?? state.maxHp;
    state.maxHp = s.maxHp || 100;
    state.kills = s.kills || 0;
    state.skKills = s.skKills || 0;
    state.wKills = s.wKills || 0;
    state.tutDone = !!s.tutDone;
    state.snakeKills = s.snakeKills || 0;
    state.waspKills = s.waspKills || 0; state.queenWaspKills = s.queenWaspKills || 0;
    state.bogSpiderKills = s.bogSpiderKills || 0;
    state.bogLordKills = s.bogLordKills || 0;
    state.bloodRatKills = s.bloodRatKills || 0;
    state.stormWaspKills = s.stormWaspKills || 0;
    state.rockSpiderKills = s.rockSpiderKills || 0;
    state.ruinSkelKills = s.ruinSkelKills || 0;
    state.ruinWarKills = s.ruinWarKills || 0;
    state.ruinWardenKills = s.ruinWardenKills || 0;
    state.ruinsFound = !!s.ruinsFound;
    const bs=s.beacon?.step;state.beacon={step:Number.isInteger(bs)?Math.max(0,Math.min(5,bs)):0,supply:['medicine','flare'].includes(s.beacon?.supply)?s.beacon.supply:null};if(state.beacon.step>=2&&!state.beacon.supply)state.beacon.step=1;
    state.journey = Number.isInteger(s.journey) ? Math.max(0,Math.min(5,s.journey)) : 0;
    state.journeyEnding = ['remember','share'].includes(s.journeyEnding) && state.journey === 5 ? s.journeyEnding : null;
    state.observatory = Number.isInteger(s.observatory) ? Math.max(0,Math.min(4,s.observatory)) : 0;
    state.courier=Number.isInteger(s.courier)?Math.max(0,Math.min(3,s.courier)):0;
    state.cartStage=Number.isInteger(s.cartStage)?Math.max(0,Math.min(3,s.cartStage)):0;
    state.insignia=INSIGNIAS.some(d=>d.id===s.insignia&&d.unlocked())?s.insignia:null;
    state.cartModel.root.position.set(cartPoint().x,0,cartPoint().z);
    const es=s.estuary;state.estuary={stage:Number.isInteger(es?.stage)?Math.max(0,Math.min(5,es.stage)):0,rescued:Number.isInteger(es?.rescued)?es.rescued&3:0,bossWon:!!es?.bossWon};if(state.estuary.stage<3)state.estuary.bossWon=false;if(state.estuary.stage<2)state.estuary.rescued=0;if(state.estuary.stage>=3)state.estuary.rescued=3;if(state.estuary.stage===2&&state.estuary.rescued===3)state.estuary.stage=3;
    const bsaved=s.bell;state.bell={stage:Number.isInteger(bsaved?.stage)?Math.max(0,Math.min(5,bsaved.stage)):0,clues:Number.isInteger(bsaved?.clues)?bsaved.clues&7:0,input:Number.isInteger(bsaved?.input)?Math.max(0,Math.min(3,bsaved.input)):0};if(!bellReady())state.bell={stage:0,clues:0,input:0};if(!state.bell.stage){state.bell.clues=0;state.bell.input=0;}if(state.bell.stage<2)state.bell.input=0;if(state.bell.stage===1&&state.bell.clues===7)state.bell.stage=2;if(state.bell.stage>=2)state.bell.clues=7;if(state.bell.stage===2&&state.bell.input===3)state.bell.stage=3;if(state.bell.stage>=3)state.bell.input=3;
    const ms=s.mist;state.mist={stage:Number.isInteger(ms?.stage)?Math.max(0,Math.min(4,ms.stage)):0,lamps:Number.isInteger(ms?.lamps)?ms.lamps&3:0};if(!mistReady())state.mist={stage:0,lamps:0};if(!state.mist.stage)state.mist.lamps=0;if(state.mist.stage===1&&state.mist.lamps===3)state.mist.stage=2;if(state.mist.stage>=2)state.mist.lamps=3;
    const ar=s.archive;state.archive={stage:Number.isInteger(ar?.stage)?Math.max(0,Math.min(4,ar.stage)):0,read:!!ar?.read,input:Number.isInteger(ar?.input)?Math.max(0,Math.min(3,ar.input)):0,shelf:!!ar?.shelf,valves:Number.isInteger(ar?.valves)?ar.valves&3:0,wave:Number.isInteger(ar?.wave)?Math.max(0,Math.min(2,ar.wave)):0,ending:['keep','share'].includes(ar?.ending)?ar.ending:null};if(!archiveReady()||!state.archive.stage)state.archive={stage:0,read:false,input:0,shelf:false,valves:0,wave:0,ending:null};else{const a=state.archive;if(a.input===3)a.shelf=true;if(a.shelf){a.read=true;a.input=3;}if(!a.read)a.input=0;if(!a.shelf||a.valves!==3)a.wave=0;if(a.stage>=2||a.wave===2){a.stage=Math.max(2,a.stage);a.read=a.shelf=true;a.input=3;a.valves=3;a.wave=2;}if(a.stage!==4)a.ending=null;}if(inArchive()&&!state.archive.stage)state.player.position.set(129,0,-5);
    state.echo=Number.isInteger(s.echo)?Math.max(0,Math.min(2,s.echo)):0;
    state.observatorySeen=!!s.observatorySeen || state.observatory>0;
    updateObservatoryVisuals();
    if((!state.observatory&&observatoryInside(state.player.position))||colliders.some(c=>c.observatoryWall&&Math.hypot(state.player.position.x-c.x,state.player.position.z-c.z)<c.r+.8))state.player.position.set(60,0,-4);
    state.sealSolved = s.sealSolved === true;
    state.sealInput = [];
    updateSealVisuals();
    state.runes = Array.isArray(s.runes) ? [...new Set(s.runes.filter(id => RUNES.some(r => r.id === id)))].slice(0, 1) : [];
    state.kingSnakeKills = s.kingSnakeKills || 0;
    state.vials = s.vials || 0;
    state.gold = s.gold || 0;
    state.potions = s.potions || 0;
    state.bossKills = s.bossKills || 0;
    state.eliteKills = s.eliteKills || 0;
    state.flowerCount = s.flowerCount || 0;
    state.flowersSold = s.flowersSold || 0;
    state.mats = s.mats || {};
    state.order = s.order || null;
    state.orderDone = s.orderDone || 0;
    state.dex = s.dex || {};
    state.level = s.level || 1;
    state.xp = s.xp || 0;
    state.bounty = s.bounty || { active: false, startKills: 0, count: 0 };
    state.tracked = s.tracked || 'auto';
    state.skills = s.skills || {};
    state.windTune=s.windTune==='pierce'&&state.bell.stage===5&&hasSkill('windshot')?'pierce':null;
    state.mastery = MASTERIES.some(m=>m.id===s.mastery) ? s.mastery : null;
    resetMasteryCombat();
    // 구 세이브 소급: (레벨-1) - 이미 습득에 쓴 포인트 - 보유 포인트 만큼만 지급 (중복 지급 방지, 감액 없음)
    const spentPts = SKILLS.filter((k) => state.skills[k.id]).reduce((n,k)=>n+(k.cost||1),0);
    const earnedPts = Math.max(0, (s.level || 1) - 1);
    const backfill = Math.max(0, earnedPts - spentPts - (s.skillPts || 0));
    state.skillPts = (s.skillPts || 0) + backfill;
    if (backfill > 0) setTimeout(() => toast(`기존 레벨 보상: 스킬 포인트 +${backfill}`), 500);
    updateWhirlBtn();
    state.chestsOpened = s.chestsOpened || [];
    state.shrinesPrayed = s.shrinesPrayed || [];
    state.trialDone = s.trialDone || 0;
    if (state.shrines) state.shrines.forEach((r, i) => { r.prayed = state.shrinesPrayed.includes(i); r.beam.visible = !r.prayed; });
    if (s.gear) state.gear = { sword: s.gear.sword || 0, armor: s.gear.armor || 0, boots: s.gear.boots || 0 };
    if (s.ach) state.ach = s.ach;
    if (state.chests) state.chests.forEach((c, i) => { c.opened = state.chestsOpened.includes(i); c.beam.visible = !c.opened; });
    // 지도 조각: 구버전 세이브는 이미 연 조각 상자 수로 소급 산정
    state.mapFrags = s.mapFrags !== undefined ? s.mapFrags : (s.chestsOpened || []).filter((i) => FRAG_CHESTS.has(i)).length;
    state.treasureDone = !!s.treasureDone;
    if (state.mapFrags >= 3 && !state.treasureDone) spawnTreasure();
    state.densCleared = s.densCleared || [];
    state.ringsPassed = s.ringsPassed || [];
    if (state.rings) state.rings.forEach((r, i) => { r.passed = state.ringsPassed.includes(i); r.mesh.visible = !r.passed; r.halo.visible = !r.passed; });
    if (state.dens) state.dens.forEach((d, i) => { d.cleared = state.densCleared.includes(i); d.beam.visible = !d.cleared; });
    state.watchFound = !!s.watchFound;
    state.watchCleared = !!s.watchCleared;
    state.playTime = s.playTime || 0;
    if (state.watch && state.watch.guardian && state.watchCleared) {
      const g = state.watch.guardian;
      g.dead = true; g.mode = 'dead'; g.hp = 0; g.root.visible = false; g.respawnAt = 1e12;
    }
    // 1회성 보스(여왕벌·늪지 군주·지명 수배 3종): 처치 기록 있는 세이브면 부팅 스폰분 제거 — 리로드 재스폰·1회성 재료 중복 파밍 방지
    const killOnce = (flag, killed) => { if (!killed) return; for (const e of state.enemies) { if (e.stats[flag] && !e.dead) { e.dead = true; e.mode = 'dead'; e.hp = 0; e.root.visible = false; if (e.tele) e.tele.visible = false; e.respawnAt = 1e12; } } };
    killOnce('queenWasp', state.queenWaspKills || 0);
    killOnce('bogLord', state.bogLordKills || 0);
    killOnce('bloodRat', state.bloodRatKills || 0);
    killOnce('stormWasp', state.stormWaspKills || 0);
    killOnce('rockSpider', state.rockSpiderKills || 0);
    killOnce('ruinWarden', state.ruinWardenKills || 0);
    if (s.quest) {
      // 구버전(goal 보유, idx 없음) 마이그레이션: 완료→idx1, 나머지는 idx0 유지
      if (s.quest.idx === undefined) {
        state.quest = { idx: s.quest.state === 'done' ? 1 : 0, state: s.quest.state === 'done' ? 'none' : (s.quest.state || 'none'), startKills: s.quest.startKills || 0 };
      } else {
        state.quest = s.quest;
      }
    }
    applyProgression();
  } catch (e) { console.warn('load fail', e); }
}
setInterval(() => { if (state.ready && !state.dead) saveGame(); }, 4000);

// ---------- 던전 생성 ----------
async function buildDungeon(cx, cz) {
  const D = 'assets/dungeon/';
  const floorG = await load(`${D}floor_tile_large.gltf.glb`);
  const wallG = await load(`${D}wall.gltf.glb`);
  const ts = Math.max(...(() => { const s = new THREE.Box3().setFromObject(floorG.scene).getSize(new THREE.Vector3()); return [s.x, s.z]; })());
  const wallH = new THREE.Box3().setFromObject(wallG.scene).getSize(new THREE.Vector3()).y;
  const N = 8; // 타일 수 (N x N)
  const half = (N * ts) / 2;
  const doorI = Math.floor(N / 2);
  DUNGEON.cx = cx; DUNGEON.cz = cz; DUNGEON.half = half;
  DUNGEON.doorHalf = ts * 0.45;
  DUNGEON.doorX = cx - half + ts / 2 + doorI * ts;
  const put = (proto, x, z, ry = 0, y = 0) => {
    const o = shadowify(proto.scene.clone());
    o.position.set(x, y, z);
    o.rotation.y = ry;
    scene.add(o);
    return o;
  };
  // 바닥
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    put(floorG, cx - half + ts / 2 + i * ts, cz - half + ts / 2 + j * ts);
  }
  // 벽 (남쪽 중앙에 문)
  for (let i = 0; i < N; i++) {
    const x = cx - half + ts / 2 + i * ts;
    if (i !== doorI) put(wallG, x, cz + half, 0);            // 남
    put(wallG, x, cz - half, Math.PI);                        // 북
    put(wallG, cx - half, cz - half + ts / 2 + i * ts, Math.PI / 2);   // 서
    put(wallG, cx + half, cz - half + ts / 2 + i * ts, -Math.PI / 2);  // 동
  }
  // 기둥 + 횃불(조명)
  const pillarG = await load(`${D}pillar.gltf.glb`);
  const torchG = await load(`${D}torch_lit.gltf.glb`);
  const inset = ts * 1.5;
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (const [sx, sz] of corners) {
    const px = cx + sx * (half - inset), pz = cz + sz * (half - inset);
    put(pillarG, px, pz);
    colliders.push({ x: px, z: pz, r: 0.7 });
    put(torchG, px, pz, 0, wallH * 0.9);
    const l = new THREE.PointLight(0xff9a3c, 6, ts * 5, 1.6);
    l.position.set(px, wallH * 1.1, pz);
    scene.add(l);
  }
  // 소품
  const props = [
    ['chest_gold.glb', 0, -half + inset, 0, 0.9],
    ['barrel_small.gltf.glb', -half + inset, half - inset, 0, 0.55],
    ['box_stacked.gltf.glb', half - inset, half - inset * 1.5, 0.4, 0.8],
    ['table_medium.gltf.glb', -half + inset * 1.2, 0, Math.PI / 2, 1.0],
    ['rubble_half.gltf.glb', half - inset, -half + inset, 0, 0.9],
    ['coin_stack_medium.gltf.glb', 0.8, -half + inset + 0.6, 0, 0.4],
  ];
  for (const [f, ox, oz, ry, cr] of props) {
    try {
      put(await load(D + f), cx + ox, cz + oz, ry);
      if (cr) colliders.push({ x: cx + ox, z: cz + oz, r: cr });
    } catch (e) { console.warn('prop', f, e); }
  }
  // 던전 입구 표식 (남쪽 문 밖 계단)
  try { put(await load(`${D}stairs_wide.gltf.glb`), cx, cz + half + ts, Math.PI); } catch (e) {}
  // 던전 수호자 2기 (Skeleton Warrior: HP40/공격8)
  const war = await load('assets/characters/Skeleton_Warrior.glb');
  state.protos.war = war;
  state.spawn(war, WARRIOR, cx - ts, cz);
  state.spawn(war, WARRIOR, cx + ts, cz);
  // 보스: 묘지의 왕 (Skeleton Warrior 1.7배, HP150/공격12/연속타)
  const boss = state.spawn(war, BOSS, cx, cz - half + inset * 2.2);
  boss.root.scale.setScalar(1.7);
  boss.nameSprite = makeNameSprite('묘지의 왕');
  boss.nameSprite.position.y = 3.6;
  boss.root.add(boss.nameSprite);
  state.boss = boss;
}

// 이름표 스프라이트
function makeNameSprite(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(40,10,10,.65)';
  g.beginPath(); g.roundRect(28, 8, 200, 48, 10); g.fill();
  g.fillStyle = '#ffd98a';
  g.font = 'bold 30px "Noto Sans KR", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false }));
  s.scale.set(2.4, 0.6, 1);
  return s;
}

// ---------- 바람꽃 (수집 오브젝트) ----------
function buildFlowers(cx, cz) {
  state.flowers = [];
  const rng2 = mulberry32(777);
  const stemMat = new THREE.MeshLambertMaterial({ color: 0x3f7a3f });
  const petalMat = new THREE.MeshLambertMaterial({ color: 0xffb7e3, emissive: 0xff6ec7, emissiveIntensity: 0.9 });
  const coreMat = new THREE.MeshLambertMaterial({ color: 0xfff3a0, emissive: 0xffe36e, emissiveIntensity: 1 });
  for (let i = 0; i < 8; i++) {
    const a = rng2() * Math.PI * 2, r = 3 + rng2() * 13;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const root = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.55, 6), stemMat);
    stem.position.y = 0.27;
    const petal = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17), petalMat);
    petal.position.y = 0.6;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), coreMat);
    core.position.y = 0.6;
    root.add(stem, petal, core);
    root.position.set(x, 0, z);
    scene.add(root);
    state.flowers.push({ root, petal, taken: false, respawnAt: 0, x, z });
  }
}
function updateFlowers(dt, now) {
  if (!state.flowers) return;
  for (const f of state.flowers) {
    if (f.taken) {
      if (now > f.respawnAt) { f.taken = false; f.root.visible = true; }
      continue;
    }
    f.petal.rotation.y += dt * 1.5;
    f.petal.position.y = 0.6 + Math.sin(now * 2 + f.x) * 0.05;
    if (!state.dead && state.player.position.distanceTo(f.root.position) < 1.3) {
      f.taken = true;
      f.root.visible = false;
      f.respawnAt = now + 45;
      state.flowerCount++;
      state.gold += 1;
      sfx('reward', 0.6);
      toast('바람꽃 +1송이');
      state.anim.playOnce('pick_up', 'pick');
      saveGame();
    }
  }
}

// ---------- 보물상자 (탐험 요소): 언덕 곳곳 5개, 근접 시 개봉 ----------
const CHESTS = [
  { x: 34, z: 44, gold: 15 },
  { x: -62, z: -24, gold: 20 },
  { x: 22, z: -42, gold: 15 },
  { x: -48, z: 30, gold: 25 },
  { x: 58, z: 18, gold: 30 },
  { x: 10, z: -60.5, gold: 40 }, // 버려진 망루 내부 (수호대장이 지킴)
];
// 숨겨진 보물: 이 상자들에서 낡은 지도 조각 획득, 3개 모으면 보물 위치 공개
const FRAG_CHESTS = new Set([1, 3, 4]);
const TREASURE_POS = { x: -20, z: -58 };
const TREASURE_GOLD = 150;
function spawnTreasure() {
  if (state.treasure || state.treasureDone) return;
  let root;
  if (state.chestProto) {
    root = shadowify(state.chestProto.clone(true));
    root.scale.setScalar(state.chestScale * 1.6);
    root.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); if (o.material.color) o.material.color.lerp(new THREE.Color(0xffd24a), 0.55); if (o.material.emissive) o.material.emissive.setHex(0x332200); } });
  } else {
    root = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.7), new THREE.MeshLambertMaterial({ color: 0xd4a017, emissive: 0x332200 }));
    root.position.y = 0.35;
  }
  root.position.x = TREASURE_POS.x; root.position.z = TREASURE_POS.z;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.8, 10, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x7de8ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  beam.position.y = 5;
  root.add(beam);
  scene.add(root);
  state.treasure = { root, beam, x: TREASURE_POS.x, z: TREASURE_POS.z };
}
function updateTreasure() {
  const t = state.treasure;
  if (!t || state.treasureDone || state.dead) return;
  if (state.player.position.distanceTo(t.root.position) < 1.8) {
    state.treasureDone = true;
    t.beam.visible = false;
    state.gold += TREASURE_GOLD;
    state.potions = Math.min(SHOP.potionMax, state.potions + 2);
    sfx('reward', 1);
    toast(`숨겨진 보물! +${TREASURE_GOLD} 골드 · 물약 +2`);
    state.anim.playOnce('pick_up', 'pick');
    checkAch();
    saveGame();
  }
}

// ---------- 몬스터 소굴 3곳: 접근하면 매복, 전멸 시 보상 (전투·탐험 콘텐츠, 1회성) ----------
const DENS = [
  { x: 44, z: 52, name: '쥐 소굴', mobs: [['Rat', RAT, 3]], gold: 40 },
  { x: -50, z: -46, name: '거미 소굴', mobs: [['Spider', SPIDER, 2]], gold: 50 },
  { x: 20, z: 64, name: '서리 소굴', mobs: [['skel', FSKEL, 2]], gold: 60 },
  { x: -5, z: 35, name: '독사 소굴', mobs: [['Snake_angry', SNAKE, 2], ['Snake_angry', VSNAKE, 1]], gold: 70 }, // 중앙 북쪽 공터: 독사 2 + 왕독사 1 혼합 매복
];
function buildDens() {
  state.dens = [];
  DENS.forEach((d, i) => {
    const root = new THREE.Group();
    const mound = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.2, 7), new THREE.MeshLambertMaterial({ color: 0x4a4038 }));
    mound.position.y = 0.6; mound.castShadow = true; root.add(mound);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.2, 8), new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
    hole.position.y = 0.1; root.add(hole);
    const bone = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), new THREE.MeshLambertMaterial({ color: 0xd8d4c8 }));
    bone.position.set(0.9, 0.12, 0.5); bone.rotation.y = 0.7; root.add(bone);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.65, 7, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff6a5a, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    beam.position.y = 3.5; root.add(beam);
    root.position.set(d.x, 0, d.z);
    scene.add(root);
    const cleared = (state.densCleared || []).includes(i);
    beam.visible = !cleared;
    state.dens.push({ root, beam, x: d.x, z: d.z, name: d.name, gold: d.gold, mobSpec: d.mobs, cleared, spawned: false, mobs: [] });
  });
}
// 독 늪지대 독 웅덩이: 안에 서 있으면 중독 갱신(기존 중독 DoT 재사용, 최소 1HP)
function updateSwamp(now) {
  if (!state.swampPools || state.dead) return;
  const p = state.player.position;
  for (const pool of state.swampPools) {
    const dx = p.x - pool.x, dz = p.z - pool.z;
    if (dx * dx + dz * dz < pool.r * pool.r) {
      const fresh = now >= state.poisonUntil;
      state.poisonUntil = now + 1.6;
      if (state.poisonTickAt < now) state.poisonTickAt = now + 1;
      if (fresh) toast('독 늪의 독기에 중독되었습니다! 물약(R)으로 해독');
      return;
    }
  }
}
function updateDens() {
  if (!state.dens || state.dead) return;
  for (let i = 0; i < state.dens.length; i++) {
    const d = state.dens[i];
    if (d.cleared) continue;
    if (!d.spawned) {
      if (state.player.position.distanceTo(d.root.position) < 7) {
        d.spawned = true;
        d.beam.visible = false;
        for (const [pn, stats, n] of d.mobSpec) {
          const proto = state.protos && state.protos[pn];
          if (!proto) continue;
          for (let k = 0; k < n; k++) {
            const a = Math.random() * Math.PI * 2;
            const mob = state.spawn(proto, stats, d.x + Math.cos(a) * 2.5, d.z + Math.sin(a) * 2.5);
            mob.denMob = true; // 소굴은 전멸시키는 1회성 전투. 일반 필드 리스폰과 분리
            d.mobs.push(mob);
          }
        }
        toast(`${d.name} 발견! 매복한 몬스터를 물리치세요`);
        sfx('dialog', 0.7);
      }
    } else if (d.mobs.length && d.mobs.every((e) => e.dead)) {
      d.cleared = true;
      state.densCleared = state.dens.map((o, j) => (o.cleared ? j : -1)).filter((j) => j >= 0);
      state.gold += d.gold;
      sfx('reward', 1);
      toast(`${d.name} 정리! +${d.gold} 골드 (${state.densCleared.length}/${DENS.length})`);
      checkAch();
      saveGame();
    }
  }
}
async function buildChests() {
  try {
    const gl = await load('assets/dungeon/chest_gold.glb');
    const bb = new THREE.Box3().setFromObject(gl.scene);
    const sz = bb.getSize(new THREE.Vector3());
    const sc = 0.6 / (sz.y || 1);
    state.chestProto = gl.scene; state.chestScale = sc;
    state.chests = [];
    CHESTS.forEach((c, i) => {
      const root = shadowify(gl.scene.clone(true));
      root.scale.setScalar(sc);
      root.position.set(c.x, 0, c.z);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.55, 6, 10, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      beam.position.y = 3;
      root.add(beam);
      scene.add(root);
      const opened = (state.chestsOpened || []).includes(i);
      beam.visible = !opened;
      state.chests.push({ root, beam, x: c.x, z: c.z, gold: c.gold, opened });
    });
  } catch (e) { console.warn('chest fail', e); }
}
function updateChests() {
  if (!state.chests || state.dead) return;
  for (let i = 0; i < state.chests.length; i++) {
    const c = state.chests[i];
    if (c.opened) continue;
    if (state.player.position.distanceTo(c.root.position) < 1.4) {
      c.opened = true;
      c.beam.visible = false;
      state.gold += c.gold;
      state.chestsOpened = state.chests.map((o, j) => (o.opened ? j : -1)).filter((j) => j >= 0);
      sfx('reward', 1);
      let extra = '';
      if (FRAG_CHESTS.has(i) && !state.treasureDone) {
        state.mapFrags = Math.min(3, (state.mapFrags || 0) + 1);
        extra = ` · 낡은 지도 조각 (${state.mapFrags}/3)`;
        if (state.mapFrags >= 3) { spawnTreasure(); extra += ' — 지도 완성! 빛기둥을 찾아보세요'; }
      }
      toast(`보물상자! +${c.gold} 골드 (${state.chestsOpened.length}/${CHESTS.length})${extra}`);
      state.anim.playOnce('pick_up', 'pick');
      saveGame();
    }
  }
}

// ---------- 버려진 망루: 남쪽 언덕의 폐허 + 수호대장 (장소·전투·발견 콘텐츠, 1회성) ----------
const WATCH_POS = { x: 10, z: -58 };
async function buildWatchtower() {
  const D = 'assets/dungeon/';
  const cx = WATCH_POS.x, cz = WATCH_POS.z;
  const root = new THREE.Group();
  root.position.set(cx, 0, cz);
  scene.add(root);
  const wallG = await load(`${D}wall.gltf.glb`);
  const brokenG = await load(`${D}wall_broken.gltf.glb`);
  const halfG = await load(`${D}wall_half.gltf.glb`);
  const rubbleG = await load(`${D}rubble_half.gltf.glb`);
  const pillarG = await load(`${D}pillar.gltf.glb`);
  const torchG = await load(`${D}torch_lit.gltf.glb`);
  const R = 4.2, SEG = 12;
  const skip = new Set([3, 9]); // 3=남쪽 입구(마을 방향), 9=북쪽 무너진 구간
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const wx = cx + Math.cos(a) * R, wz = cz + Math.sin(a) * R;
    if (skip.has(i)) {
      if (i === 9) { // 북쪽 무너진 구간만 잔해+충돌
        const r = shadowify(rubbleG.scene.clone());
        r.position.set(wx, 0, wz); r.rotation.y = a; scene.add(r);
        registerTreeFade(r, wx, wz);
        colliders.push({ x: wx, z: wz, r: 0.9 });
      } // i===3 남쪽은 입구: 잔해·충돌 없이 개방 (실플레이 진입 경로)
      continue;
    }
    const proto = i % 4 === 2 ? brokenG : i % 4 === 1 ? halfG : wallG; // 높이·형태를 섞어 폐허 느낌
    const o = shadowify(proto.scene.clone());
    // 폐허다운 낮은 벽: 3인칭 카메라가 벽 너머 내부를 볼 수 있게 Y만 낮춤(바닥 면적·충돌 불변)
    o.scale.y = proto === wallG ? 0.45 : proto === halfG ? 0.7 : 0.8;
    o.position.set(wx, 0, wz);
    o.rotation.y = a + Math.PI / 2;
    scene.add(o);
    registerTreeFade(o, wx, wz); // 카메라-플레이어 사이 벽이 시야를 가리면 페이드
    colliders.push({ x: wx, z: wz, r: 1.25 });
  }
  // 입구 양옆 기둥 + 횃불, 중앙 조명
  for (const sx of [-1, 1]) {
    const px = cx + sx * 2.4, pz = cz + R - 1.4;
    const p = shadowify(pillarG.scene.clone()); p.position.set(px, 0, pz); scene.add(p);
    registerTreeFade(p, px, pz);
    colliders.push({ x: px, z: pz, r: 0.7 });
    const t = shadowify(torchG.scene.clone()); t.position.set(px, 2.6, pz); scene.add(t);
  }
  const l = new THREE.PointLight(0xff9a3c, 5, 16, 1.6);
  l.position.set(cx, 3.4, cz);
  scene.add(l);
  // 수호대장 (Skeleton_Warrior 프로토타입은 buildDungeon이 state.protos.war에 보관)
  let guardian = null;
  if (state.protos && state.protos.war) {
    guardian = state.spawn(state.protos.war, CAPTAIN, cx, cz - 1.0);
    guardian.root.scale.multiplyScalar(1.45);
    guardian.home.set(cx, 0, cz);
    guardian.nameSprite = makeNameSprite('망루 수호대장');
    guardian.nameSprite.position.y = 2.9;
    guardian.root.add(guardian.nameSprite);
  }
  state.watch = { root, guardian };
}
// ---------- 꺼진 봉화길: 보급 선택과 두 전투 지점을 잇는 1회성 원정 ----------
const BEACON_SITES=[{id:'start',x:10,z:10,name:'봉화길 출발석'},{id:'fork',x:0,z:28,name:'원정 보급함'},{id:'forest',x:-20,z:18,name:'서쪽 우회길'},{id:'ridge',x:18,z:40,name:'동쪽 능선길'},{id:'fire',x:8,z:60,name:'꺼진 봉화'}];
function beaconStep(){return state.beacon?.step||0}
function beaconSite(id){return BEACON_SITES.find(s=>s.id===id)}
function beaconTarget(){const st=beaconStep();if(!st||st===5)return null;const id=st===1?'fork':st===2?(state.beacon.supply==='medicine'?'forest':'ridge'):st===3?'fire':'start';const d=beaconSite(id);return{x:d.x,z:d.z,label:st===4?'봉화길 귀환 보고':d.name}}
function beaconStatus(){
 const step=beaconStep(),fight=state.beaconFight;
 if(step===1)return '보급함에서 한 가지 선택';
 if(step===2||step===3){if(!fight||fight.step!==step)return '목표 현장 10m 안으로 이동';const left=fight.enemies.filter(e=>!e.dead).length;return left?`원정 보초 ${left}/${fight.enemies.length} 남음 · 일반 적은 목표 아님`:(step===2?'보초 정리 · 현장에서 E로 다음 지점':'보초 정리 · 봉화 앞에서 E로 점화');}
 if(step===4)return '출발석 앞에서 E로 귀환 기록';
 return step===5?'봉화지기 기록 완료':'';
}
function buildBeaconTrail(){state.beaconProps=BEACON_SITES.map(d=>{const root=new THREE.Group();root.position.set(d.x,0,d.z);const base=new THREE.Mesh(new THREE.CylinderGeometry(.8,1,.6,8),new THREE.MeshLambertMaterial({color:0x777c80}));base.position.y=.3;root.add(base);const post=new THREE.Mesh(new THREE.BoxGeometry(.2,1.6,.2),new THREE.MeshLambertMaterial({color:0x9b774a}));post.position.y=1.2;root.add(post);const gem=new THREE.Mesh(d.id==='fire'?new THREE.ConeGeometry(.6,1.5,7):new THREE.OctahedronGeometry(.3),new THREE.MeshBasicMaterial({color:0xe1aa51}));gem.position.y=2.2;root.add(gem);
 if(d.id==='fire'){const bowl=new THREE.Mesh(new THREE.CylinderGeometry(.85,.45,.45,10),new THREE.MeshLambertMaterial({color:0x404958}));bowl.position.y=1.35;root.add(bowl);for(let i=0;i<3;i++){const log=new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,1.4,6),new THREE.MeshLambertMaterial({color:0x60432c}));log.rotation.z=Math.PI/2;log.rotation.y=i*Math.PI/3;log.position.y=1.6;root.add(log)}gem.position.y=2.05;const heart=new THREE.Mesh(new THREE.ConeGeometry(.3,.95,7),new THREE.MeshBasicMaterial({color:0xffd75c}));heart.position.set(0,1.95,.25);root.add(heart);root.userData.fireHeart=heart;}
 else if(d.id==='fork'){for(let i=0;i<2;i++){const box=new THREE.Mesh(new THREE.BoxGeometry(.75,.65,.65),new THREE.MeshLambertMaterial({color:i?0x8c6942:0x6a7950}));box.position.set(i?1:-1,.32,.35);root.add(box)}const med=new THREE.Mesh(new THREE.BoxGeometry(.36,.12,.65),new THREE.MeshBasicMaterial({color:0xe4ddd0}));med.position.set(-1,.7,.35);root.add(med);}
 else {const flag=new THREE.Mesh(new THREE.BoxGeometry(1.25,.65,.1),new THREE.MeshLambertMaterial({color:d.id==='forest'?0x729f66:d.id==='ridge'?0xd6a14f:0x6b94bb}));flag.position.set(.5,1.55,0);root.add(flag)}
 const label=makeNameSprite(d.name);label.position.y=3.1;root.add(label);let litLabel=null;if(d.id==='fire'){litLabel=makeNameSprite('밝힌 봉화');litLabel.position.y=3.1;litLabel.visible=false;root.add(litLabel)}scene.add(root);return{...d,root,gem,label,litLabel}})}
function nearbyBeacon(){if(!state.ready||state.dead)return null;return(state.beaconProps||[]).find(d=>Math.hypot(state.player.position.x-d.x,state.player.position.z-d.z)<2.5)||null}
function beaconAdvance(step){state.beacon.step=step;state.tracked=step<5?'beacon':'auto';saveGame();closeDialog()}
function clearBeaconFight(){if(!state.beaconFight)return;for(const e of state.beaconFight.enemies){cancelFrogSpit(e);cancelStormCharge(e);cancelWardenPulse(e);if(e.tele)scene.remove(e.tele);scene.remove(e.root);const i=state.enemies.indexOf(e);if(i>=0)state.enemies.splice(i,1)}state.beaconFight=null}
function openBeaconDialog(d){
 state.dlgFocus=d.root.position;const step=beaconStep(),near=()=>nearbyBeacon()?.id===d.id;
 if(d.id==='start'){
  if(step===0){journeyDialog('꺼진 봉화길','남쪽 봉화가 꺼져 늦은 여행자들이 방향을 잃고 있다.<br>보급함에서 한 가지 물품을 골라 길을 열고, 봉화를 밝힌 뒤 돌아오자.<br><br>서쪽 우회길은 근접 보초 둘, 동쪽 능선길은 원거리 보초 둘이 지킨다. 마지막 봉화에는 갑옷 보초가 있다.<br>이름이 <b>원정</b>으로 시작하는 보초만 목표다. 일반 적은 지나쳐도 된다.<br>원정 적은 재화·경험치·일반 의뢰 처치에 포함되지 않는다. 사망·재접속·현장24m 이탈 시 현재 전투만 처음부터, 완료한 지점과 선택은 유지된다.<br>완료 기록: <b>봉화지기</b> · 능력치 보상 없음.'+(state.quest.idx<5?'<br><br>묘지의 왕 의뢰를 장로에게 보고한 뒤 시작할 수 있다.':''),state.quest.idx>=5?[[ '원정 시작',()=>{if(beaconStep()||!near())return;state.beacon={step:1,supply:null};beaconAdvance(1)}]]:[]);return}
  if(step===4){journeyDialog('돌아온 봉화지기','먼 언덕에서 새 불빛이 보인다. 길 위의 누군가는 오늘 밤 그 불빛으로 돌아올 것이다.<br>출발석의 빈 칸에 이번 원정의 기록을 남기자.',[['원정 기록 남기기',()=>{if(beaconStep()!==4||!near())return;beaconAdvance(5);toast('원정 기록: 봉화지기');sfx('reward',.7)}]]);return}
  journeyDialog('봉화길 출발석',step===5?'봉화지기 기록이 새겨져 있다. 꺼진 길에 불빛을 돌려놓았다.<br>이 원정은 완료되었으며 보상을 반복해서 받지 않는다.':'원정이 진행 중이다. 목표 표지를 따라 보급함과 선택한 길을 지나자.');return;
 }
 if(step===1&&d.id==='fork'){
  journeyDialog('한 가지만 가져갈 수 있다','<b>붕대 꾸러미</b>: 서쪽 우회길의 근접 보초 둘을 지나면 체력30 회복(한 번). 마지막 갑옷 보초는 그대로다.<br><br><b>봉화 화약</b>: 동쪽 능선길의 독침 보초 둘을 지난다. 마지막 보초는 갑옷이 깨져 체력65/가드 없음이 된다. 중간 회복은 없다.<br><br>선택은 이번 원정 동안 바꿀 수 없다. 보급은 무료이며 물약/골드를 쓰지 않는다.',[['붕대 · 서쪽 우회',()=>{if(beaconStep()!==1||!near())return;state.beacon.supply='medicine';beaconAdvance(2)}],['화약 · 동쪽 능선',()=>{if(beaconStep()!==1||!near())return;state.beacon.supply='flare';beaconAdvance(2)}]]);return;
 }
 const target=beaconTarget();if(!target||target.x!==d.x||target.z!==d.z){journeyDialog(d.name,'지금 원정 목표는 다른 곳이다. 표지를 따라 먼저 보급과 앞선 길을 확인하자.');return}
 if(step===2||step===3){
  const fight=state.beaconFight,won=fight&&fight.step===step&&fight.enemies.every(e=>e.dead);
  journeyDialog(d.name,won?(step===2?'보초를 모두 넘었다. 다음은 남쪽 봉화다.'+(state.beacon.supply==='medicine'?'<br>붕대를 쓰면 체력30을 최대체력 안에서 한 번 회복한다.':'<br>화약은 마지막 갑옷을 깨뜨릴 때 쓴다.'):'마지막 보초를 쓰러뜨렸다. 마른 장작에 불을 붙일 수 있다.'):`${beaconStatus()}<br>이름이 '원정'으로 시작하는 보초만 상대하자. 일반 적은 지나쳐도 된다.<br>전투 현장 24m 밖으로 나가면 현재 전투가 초기화된다.`,won?[[step===2?'다음 지점으로': '봉화 점화',()=>{if(beaconStep()!==step||!near()||!state.beaconFight?.enemies.every(e=>e.dead))return;clearBeaconFight();if(step===2&&state.beacon.supply==='medicine')state.hp=Math.min(state.maxHp,state.hp+30);beaconAdvance(step+1);toast(step===3?'봉화를 밝혔다. 출발석으로 귀환하자.':'길이 열렸다. 다음은 남쪽 봉화.')}]]:[]);return;
 }
 journeyDialog(d.name,'지금은 조사할 일이 없다. 출발석과 원정 목표를 확인하자.');
}
function updateBeaconTrail(){
 const st=beaconStep(),target=beaconTarget();for(const d of state.beaconProps||[])if(d.id==='fire'){d.gem.material.color.setHex(st>=4?0xff6a24:0x777c80);d.root.userData.fireHeart.visible=st>=4;d.label.visible=st<4;d.litLabel.visible=st>=4;d.name=st>=4?'밝힌 봉화':'꺼진 봉화';}
 if(state.dead){clearBeaconFight();return}if(state.beaconFight&&target&&Math.hypot(state.player.position.x-target.x,state.player.position.z-target.z)>24){clearBeaconFight();toast('원정 현장을 벗어났다. 돌아가면 현재 전투를 다시 시작한다.')}if(state.dialog||state.menuOpen||!target||![2,3].includes(st)||state.trial?.active)return;
 if(!state.beaconFight&&Math.hypot(state.player.position.x-target.x,state.player.position.z-target.z)<10){
  const ranged=st===2&&state.beacon.supply==='flare';const weakened=state.beacon.supply==='flare';
  const stats=st===3?{...WARRIOR,hp:weakened?65:100,dmg:10,guard:!weakened,label:weakened?'원정 약화 보초':'원정 갑옷 보초',noElite:true,noRespawn:true}:ranged?{...PFROG,label:'원정 독침 보초',noElite:true,noRespawn:true}:{...ENEMY,hp:35,dmg:6,label:'원정 근접 보초',noElite:true,noRespawn:true};
  const enemies=[];for(let i=0;i<(st===3?1:2);i++){const proto=ranged?state.protos.Frog:state.protos.skel;if(!proto)continue;const e=state.spawn(proto,stats,target.x+(i?2:-2),target.z+2);e.expedition=true;e.trial=true;if(!e.nameSprite){e.nameSprite=makeNameSprite(stats.label);e.nameSprite.position.y=2.3;e.root.add(e.nameSprite)}enemies.push(e)}
  if(enemies.length)state.beaconFight={step:st,enemies};
 }
}

// ---------- 동쪽 바람 관측소: 실제 투사체로 여는 탐험 구간 ----------
// 0 외부 종 -> 1 보초 -> 2 내부 종 -> 3 기록 -> 4 완료. 전투 중 이탈/사망만 재시도.
function observatoryStatus(){return ['동쪽 들판 (60, -7), 안내판에서 시작 · 바람칼날 필요','입구 개방 · 안쪽 근접/독침 보초를 처치','보초 정리 · 낮은 벽을 돌아 안쪽 종에 바람칼날','기록함 개방 · 북쪽 기록을 읽기','관측 기록 회수 완료 · 최대 체력 +10'][state.observatory||0];}
function observatoryBlocked(a,b){return colliders.some(c=>c.observatoryWall&&segmentDistance(c,a,b)<c.r+.15);}
function observatoryInside(p){return p.x>53&&p.x<67&&p.z>-.5&&p.z<11;}
function observatoryTarget(){const n=state.observatory||0;if(n===4||(!state.observatorySeen&&!n))return null;return [{x:56,z:-6,label:'외부 바람종 · 3m 밖에서 G'},{x:60,z:2,label:'안쪽 보초 둘 처치'},{x:65,z:9,label:'안쪽 바람종 · 벽을 돌아 G'},{x:59,z:10,label:'관측 기록함'}][n];}
function buildObservatory(){
 const root=new THREE.Group();scene.add(root);state.observatoryRoot=root;state.observatoryDoors=[];
 const stone=new THREE.MeshLambertMaterial({color:0x718797});
 const box=(x,z,w,d,h,mat=stone)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,h/2,z);m.castShadow=true;m.receiveShadow=true;root.add(m);return m};
 const wall=(x,z,w,d,door=false)=>{const m=box(x,z,w,d,1.65);for(let t=0;t<=Math.max(w,d);t+=.6){const c={x:x+(w>d?t-w/2:0),z:z+(d>w?t-d/2:0),r:.38,observatoryWall:true,observatoryDoor:door};colliders.push(c);}if(door)state.observatoryDoors.push(m);};
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(16,14),new THREE.MeshLambertMaterial({color:0x8c9586}));floor.rotation.x=-Math.PI/2;floor.position.set(60,.025,5);root.add(floor);
 wall(52,5,.6,14);wall(68,5,.6,14);wall(60,12,16,.6);wall(55,-2,6,.6);wall(65,-2,6,.6);wall(60,-2,3,.6,true);
 wall(62,5.5,.6,5); // 두 번째 종의 직선 사선을 막는 낮은 벽, 북쪽/동쪽 통로는 열림
 state.observatoryBells=[[56,-6,'입구 바람종'],[65,9,'안쪽 바람종']].map(([x,z,name],i)=>{
  box(x-.65,z,.12,.12,1.6);box(x+.65,z,.12,.12,1.6);const top=box(x,z,1.5,.16,.16);top.position.y=1.6;
  const bell=new THREE.Mesh(new THREE.ConeGeometry(.45,.65,10,1,true),new THREE.MeshLambertMaterial({color:0xb49b58,side:THREE.DoubleSide}));bell.position.set(x,1.05,z);root.add(bell);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.65,.06,6,24),new THREE.MeshBasicMaterial({color:0x70ddff}));ring.position.set(x,1.05,z);root.add(ring);
  const label=makeNameSprite(name);label.position.set(x,2.35,z);root.add(label);return{x,z,name,bell,ring,i};});
 state.observatorySites=[{id:'board',x:60,z:-7,name:'바람 관측소 안내판'},{id:'record',x:59,z:10,name:'관측 기록함'}].map(d=>{box(d.x,d.z,d.id==='board'?1.5:1,.45,d.id==='board'?1.1:.6,new THREE.MeshLambertMaterial({color:0x87613d}));const label=makeNameSprite(d.name);label.position.set(d.x,2,d.z);root.add(label);return d;});
 updateObservatoryVisuals();
}
function updateObservatoryVisuals(){const n=state.observatory||0;for(const m of state.observatoryDoors||[])m.visible=n===0;
 const doorColliders=colliders.filter(c=>c.observatoryDoor);if(n>0&&doorColliders.length){state.observatoryDoorColliders=doorColliders;for(let i=colliders.length-1;i>=0;i--)if(colliders[i].observatoryDoor)colliders.splice(i,1);}
 if(n===0&&!doorColliders.length&&state.observatoryDoorColliders)colliders.push(...state.observatoryDoorColliders);
 for(const b of state.observatoryBells||[]){const done=b.i===0?n>0:n>=3;b.ring.material.color.setHex(done?0xffdc75:0x70ddff);b.bell.material.color.setHex(done?0xf5d36b:0xb49b58);}
}
function nearbyObservatory(){if(!state.player||state.dead)return null;return(state.observatorySites||[]).find(d=>Math.hypot(state.player.position.x-d.x,state.player.position.z-d.z)<2.5)||null;}
function openObservatoryDialog(d){
 state.dialog=true;state.dlgFocus=new THREE.Vector3(d.x,0,d.z);document.getElementById('dlg-name').textContent=d.name;document.getElementById('dlg-list').innerHTML='';const btns=document.getElementById('dlg-btns');btns.innerHTML='';
 const add=(label,fn)=>{const b=document.createElement('button');b.textContent=label;b.onclick=()=>{if(state.dead||!state.dialog||nearbyObservatory()?.id!==d.id)return;b.disabled=true;fn()};btns.appendChild(b)};
 const n=state.observatory||0;
 document.getElementById('dlg-text').innerHTML=d.id==='board'?`<b>바람을 멀리 보내는 이에게</b><br>입구 왼쪽의 종을 <b>3m 이상 떨어져</b> 바람칼날(G/버튼)로 울리면 문이 열린다. K에서 1P로 배운다. 근접공격과 회전베기로는 종을 울릴 수 없다.<br>안쪽 보초 둘은 근접 공격과 독침을 함께 쓴다. 낮은 돌벽으로 독침을 막고, 정리한 뒤 벽을 돌아 안쪽 종을 울리자. 마지막 기록함은 북쪽에 있다.<br><b>현재: ${observatoryStatus()}</b><br>단계마다 저장. 사망·멀리 이탈하면 미완료 전투만 다시 시작한다. 보초는 전리품을 주지 않으며 최종 기록 보상은 한 번뿐이다.`:n<3?`기록함이 잠겨 있다.<br>${observatoryStatus()}<br>보초를 정리하고 안쪽 종에 바람칼날을 보내자.`:n===3?'안쪽에 구름과 바람의 방향을 그린 장부가 남았다.<br>"종은 명령을 전하는 도구가 아니었다. 골짜기 건너편에서 길을 잃은 이들에게 돌아오는 방향을 알려 주었다. 마지막 관측자는 폭풍이 멎을 때까지 이곳을 지켰다."<br>기록 회수: 최대 체력 +10 · 경험치 60 · 60G (한 번)':'기록을 안전하게 챙겼다. 폭풍이 와도 돌아갈 방향을 잊지 않을 것이다.<br>관측소의 가호: 최대 체력 +10 (적용 중).<br>돌봄 인장 해금 · 장로 곁 스킬 창에서 장착.';
 if(d.id==='board'&&n<4)add('관측소 목표 추적',()=>{state.observatorySeen=true;state.tracked='observatory';saveGame();closeDialog()});
 if(d.id==='record'&&n===3)add('관측 기록 회수',()=>{if(state.observatory!==3)return;state.observatory=4;state.gold+=60;applyProgression();gainXp(60);if(state.tracked==='observatory')state.tracked='auto';updateObservatoryVisuals();saveGame();closeDialog();sfx('reward',1);toast('관측 기록 회수! 최대 체력 +10 · 경험치 60 · 60G')});
 add('닫기',closeDialog);dlgEl().style.display='block';document.getElementById('dlgback').style.display='block';
}
function hitObservatoryBell(w,p){const n=state.observatory||0;if(n!==0&&n!==2)return false;const b=state.observatoryBells?.[n===0?0:1];if(!b||Math.hypot(p.x-b.x,p.z-b.z)>.65)return false;
 if(Math.hypot(w.origin.x-b.x,w.origin.z-b.z)<3){toast('너무 가까워 종의 울림이 모이지 않는다. 3m 밖에서 쏘자.');return true;}
 if(n===2&&!observatoryInside(w.origin)){toast('안쪽 종은 관측소 안에서 울려야 한다.');return true;}
 state.observatory=n+1;state.observatorySeen=true;state.tracked='observatory';updateObservatoryVisuals();skillFx(new THREE.Vector3(b.x,1,b.z),0xffdc75,1.7,'hit');saveGame();sfx('reward',.8);toast(n===0?'입구 바람종 공명! 관측소 문이 열렸다.':'안쪽 바람종 공명! 북쪽 기록함이 열렸다.');return true;
}
function clearObservatoryFight(){if(!state.observatoryFight)return;for(const e of state.observatoryFight){e.dead=true;e.despawned=true;e.mode='dead';e.respawnAt=1e12;e.root.visible=false;if(e.tele)e.tele.visible=false;cancelFrogSpit(e)}state.observatoryFight=null;}
function updateObservatory(){
 if(!state.player)return;const p=state.player.position,n=state.observatory||0;
 if(!n&&observatoryInside(p)){p.set(60,0,-4);toast('먼저 입구 바람종을 울려 문을 열자.');return;}
 if(!state.observatorySeen&&Math.hypot(p.x-60,p.z+7)<18){state.observatorySeen=true;toast('동쪽 바람 관측소 발견 · 입구 안내판을 읽자.');}
 if(state.dead||Math.hypot(p.x-60,p.z-5)>23){if(state.observatoryFight){clearObservatoryFight();toast('관측소 전투가 초기화되었다. 열린 문과 저장된 단계는 유지된다.')}return;}
 if(n!==1)return;
 if(state.observatoryFight?.every(e=>e.dead)){clearObservatoryFight();state.observatory=2;updateObservatoryVisuals();saveGame();toast('보초를 정리했다. 돌벽을 돌아 안쪽 종에 바람칼날을 보내자.');return;}
 if(state.dialog||state.menuOpen||state.trial?.active||state.observatoryFight||!observatoryInside(p))return;
 const defs=[[state.protos.skel,{...ENEMY,hp:40,dmg:7,label:'관측소 근접 보초'},57,4],[state.protos.Frog,{...PFROG,hp:30,dmg:6,label:'관측소 독침 보초'},65,5]];
 if(defs.some(([proto])=>!proto))return;
 state.observatoryFight=defs.map(([proto,stats,x,z])=>{const e=state.spawn(proto,{...stats,noElite:true,noRespawn:true},x,z);e.trial=true;e.expedition=true;e.observatoryGuard=true;if(!e.nameSprite){e.nameSprite=makeNameSprite(stats.label);e.nameSprite.position.y=2.3;e.root.add(e.nameSprite)}return e;});
}

// ---------- 북서 전령길: 엄폐와 세 갈래 사격 ----------
const COURIER_CENTER={x:-54,z:-23},COURIER_BOARD={x:-47,z:-14,name:'북서 전령길 안내판',id:'board'},COURIER_BOX={x:-54,z:-31,name:'전령의 봉인함',id:'box'};
// ---------- 회색 여울: 별도 섬, 구조와 침수 주기를 잇는 다음 지역 ----------
const ESTUARY_SITES=[{id:'ferry',name:'회색 여울 나루',x:70,z:-12},{id:'return',name:'언덕행 나룻배',x:126,z:0},{id:'chart',name:'젖은 조사 지도',x:140,z:-16},{id:'north',name:'북쪽 조사원',x:157,z:-12,bit:1},{id:'south',name:'남쪽 조사원',x:157,z:12,bit:2},{id:'sluice',name:'막힌 여울 수문',x:172,z:0}];
function inEstuary(p=state.player?.position){return !!p&&p.x>105&&p.x<210;}
function onWorld(p){return inArchive(p)||Math.hypot(p.x,p.z)<=78||Math.hypot(p.x-150,p.z)<=30;}
function clampWorld(p){if(p.x>210){p.x=Math.max(231,Math.min(289,p.x));p.z=Math.max(-31,Math.min(31,p.z));return p;}const east=p.x>105,cx=east?150:0,r=east?30:78,d=Math.hypot(p.x-cx,p.z);if(d>r){p.x=cx+(p.x-cx)*r/d;p.z=p.z*r/d;}return p;}
function estuaryReady(){return state.quest.idx>=20&&state.courier===3;}
function estuaryStatus(){const s=state.estuary;return s.stage===5?'회색 여울 구조 기록 인계 완료':s.stage===4?'언덕 나루로 돌아가 구조 기록 인계':s.stage===3?'동쪽 수문 철갑병을 물리치고 수문 열기':s.stage===2?`조사원 구조 ${Number(!!(s.rescued&1))+Number(!!(s.rescued&2))}/2 · 침수 뒤 3초 확보`:s.stage===1?'북서 물가의 젖은 조사 지도 읽기':estuaryReady()?'동쪽 나루에서 회색 여울로 출발':'메인 20개·전령 기록 인계 후 출발';}
function estuaryTarget(){if(state.estuary.stage===5)return null;let id='ferry';if(inEstuary()){id=state.estuary.stage===1?'chart':state.estuary.stage===2?(!(state.estuary.rescued&1)?'north':'south'):state.estuary.stage===3?'sluice':'return';}const d=ESTUARY_SITES.find(d=>d.id===id);return{...d,label:d.name};}
function buildEstuary(){
 const root=new THREE.Group();scene.add(root);state.estuaryRoot=root;
 const stone=new THREE.MeshLambertMaterial({color:0x79858b}),wood=new THREE.MeshLambertMaterial({color:0x91734f});
 const land=new THREE.Mesh(new THREE.CircleGeometry(32,48),new THREE.MeshLambertMaterial({color:0x87958c}));land.rotation.x=-Math.PI/2;land.position.set(150,.005,0);land.receiveShadow=true;root.add(land);
 const water=new THREE.Mesh(new THREE.RingGeometry(32,37,48),new THREE.MeshBasicMaterial({color:0x6099b5,transparent:true,opacity:.7,side:THREE.DoubleSide}));water.rotation.x=-Math.PI/2;water.position.set(150,-.02,0);root.add(water);
 for(const [x,z,w,d]of[[145,-5,36,2.8],[150,-8,2.8,30],[164,0,17,3]]){const m=new THREE.Mesh(new THREE.BoxGeometry(w,.06,d),new THREE.MeshLambertMaterial({color:0xb7b09b}));m.position.set(x,.045,z);root.add(m);}
 state.estuaryProps=ESTUARY_SITES.map(d=>{const g=new THREE.Group();g.position.set(d.x,0,d.z);const base=new THREE.Mesh(new THREE.BoxGeometry(d.bit?.7:1.4,.65,1),d.bit?new THREE.MeshLambertMaterial({color:0x62b8b0}):wood);base.position.y=.4;g.add(base);const gem=new THREE.Mesh(new THREE.OctahedronGeometry(d.bit?.33:.26),new THREE.MeshBasicMaterial({color:d.bit?0x8effd9:0xffd17b}));gem.position.y=1.6;g.add(gem);const label=makeNameSprite(d.name);label.position.y=d.bit?3.4:2.2;g.add(label);root.add(g);if(d.bit&&state.npc){base.visible=false;const person=SkeletonUtils.clone(state.npc.root);person.position.set(0,0,0);person.scale.multiplyScalar(.85);g.add(person);person.name='estuary-surveyor';gem.position.set(0,2.9,0);const tent=new THREE.Mesh(new THREE.ConeGeometry(1.7,2.2,4),new THREE.MeshLambertMaterial({color:0x457e82}));tent.rotation.y=Math.PI/4;tent.position.set(-2,1.1,2.8);g.add(tent);colliders.push({x:d.x-2,z:d.z+2.8,r:1.1,estuaryTent:true});registerTreeFade(tent,d.x-2,d.z+2.8);}if(d.id==='ferry'||d.id==='return'){const hull=new THREE.Mesh(new THREE.BoxGeometry(1.8,.45,3.6),wood);hull.position.set(0,.25,2.6);g.add(hull);const mast=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,3,6),wood);mast.position.set(0,1.7,2.6);g.add(mast);const sail=new THREE.Mesh(new THREE.PlaneGeometry(1.4,1.4),new THREE.MeshLambertMaterial({color:0xdbe5df,side:THREE.DoubleSide}));sail.position.set(.65,2.2,2.6);g.add(sail);}return{...d,root:g,gem,person:g.getObjectByName('estuary-surveyor')};});
 state.estuaryTides=ESTUARY_SITES.filter(d=>d.bit).map(d=>{const disc=new THREE.Mesh(new THREE.CircleGeometry(5.5,48),new THREE.MeshBasicMaterial({color:0x599cb7,transparent:true,opacity:.12,depthWrite:false,side:THREE.DoubleSide}));disc.rotation.x=-Math.PI/2;disc.position.set(d.x,.075,d.z);root.add(disc);const ring=new THREE.Mesh(new THREE.RingGeometry(5.35,5.5,48),new THREE.MeshBasicMaterial({color:0x69cfe9,transparent:true,opacity:.75,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.set(d.x,.085,d.z);root.add(ring);const refuge=new THREE.Mesh(new THREE.CylinderGeometry(1.35,1.5,.35,10),stone);refuge.position.set(d.x+3.8,.18,d.z);root.add(refuge);const safeRing=new THREE.Mesh(new THREE.RingGeometry(1.3,1.45,24),new THREE.MeshBasicMaterial({color:0xa7ffe2,side:THREE.DoubleSide}));safeRing.rotation.x=-Math.PI/2;safeRing.position.set(d.x+3.8,.37,d.z);root.add(safeRing);const label=makeNameSprite('높은 돌 · 침수 안전');label.position.set(d.x+3.8,1.4,d.z);root.add(label);return{...d,disc,ring,refuge,next:0,at:0,hits:0,blocks:0,saves:0};});
 for(const [x,z]of[[131,-9],[139,18],[148,24],[169,16],[177,-6],[151,-24]]){const m=new THREE.Mesh(new THREE.DodecahedronGeometry(1.4,0),stone);m.scale.y=.65;m.position.set(x,.6,z);root.add(m);colliders.push({x,z,r:1.25,estuaryRock:true});registerTreeFade(m,x,z);}
 const gate=new THREE.Mesh(new THREE.BoxGeometry(1.2,2.6,7),stone);gate.position.set(175,1.3,0);root.add(gate);state.estuarySluice=gate;
}
function nearbyEstuary(){if(!state.ready||state.dead)return null;return state.estuaryProps?.find(d=>Math.hypot(state.player.position.x-d.x,state.player.position.z-d.z)<2.2)||null;}
function clearEstuaryFight(){for(const e of state.estuaryFight||[]){cancelWardenPulse(e);cancelFrogSpit(e);cancelArcher(e);e.dead=true;e.despawned=true;if(e.tele)scene.remove(e.tele);scene.remove(e.root);const i=state.enemies.indexOf(e);if(i>=0)state.enemies.splice(i,1)}state.estuaryFight=null;state.estuaryChannel=null;for(const t of state.estuaryTides||[]){t.at=0;t.next=0;t.disc.visible=false;t.ring.visible=false;}}
function estuaryTravel(east){clearArchiveFight();clearMistFight();clearWindPractice();clearBellFight();clearEstuaryFight();clearCourierFight();clearCartRun();clearEchoFight();clearObservatoryFight();clearBeaconFight();if(state.trial?.active)endTrial(false);cancelWindshot('travel');resetMasteryCombat();state.dodgeFrom=null;state.dodgeUntil=0;state.attackUntil=0;state.autoOn=false;document.getElementById('auto').textContent='자동 전투 OFF';document.getElementById('auto').classList.remove('on');state.player.position.set(east?126:70,0,east?0:-12);state.invUntil=Math.max(state.invUntil,clock.elapsedTime+1);state.tracked='estuary';closeDialog();saveGame();toast(east?'회색 여울 도착 · 지도부터 살펴보자.':'언덕 나루로 돌아왔다. 구조 기록은 보존된다.');}
function openEstuary(d){state.dlgFocus=d.root.position;const s=state.estuary;
 if(d.id==='ferry'){const buttons=[];let text=(bellReady()?'수문이 열리며 세 종의 유적이 드러났다. 여울 나루 곁 기록대에서 다음 이야기를 시작할 수 있다.<br><br>':'')+'전령이 지켜 낸 대피 지도는 동쪽 회색 여울로 이어진다. 돌아오지 못한 조사원 둘과 막힌 수문을 찾아보자.<br><br><b>'+estuaryStatus()+'</b><br>배편과 재도전은 무료. 지도·각 조사원·수문 단계는 저장된다. 사망하면 마을에서 부활하며 미완료 전투·구조만 초기화된다.<br>붉은 침수 예고 1.5초 뒤 물가 원에 피해16. 초록 테두리의 높은 돌은 안전하다. 침수 직후 조사원 곁에서 E/터치로 구조 시작, 3초 안에 피격·2m 이탈·회피·공격·메뉴를 열면 취소된다.<br>구조 둘 후 수문 철갑병과 싸우고 수문을 열어 귀환한다. 최종 한 번300XP·180G. 적은 전리품을 주지 않는다.';
  if(s.stage===4)buttons.push(['구조 기록 인계',()=>{if(state.estuary.stage!==4||nearbyEstuary()?.id!=='ferry')return;state.estuary.stage=5;state.gold+=180;gainXp(300);if(state.tracked==='estuary')state.tracked='auto';saveGame();closeDialog();sfx('reward',1);toast('회색 여울의 길잡이 · 300XP · 180G');}]);
  if(estuaryReady())buttons.push([s.stage?'회색 여울로 건너가기':'여울 조사 시작',()=>{if(nearbyEstuary()?.id!=='ferry'||!estuaryReady())return;if(!s.stage)s.stage=1;estuaryTravel(true);}]);
  journeyDialog(d.name,text,buttons);return;
 }
 if(d.id==='return'){journeyDialog(d.name,'언덕 나루로 무료 귀환한다. 완료한 지도·구조·수문 단계는 유지된다.',[['언덕 나루로 귀환',()=>{if(nearbyEstuary()?.id==='return')estuaryTravel(false)}]]);return;}
 if(d.id==='chart'){journeyDialog(d.name,'지도의 파란 선은 물이 차는 곳, 초록 원은 높은 돌이다.<br>북쪽과 남쪽 조사원을 구조한 뒤 동쪽 수문을 열면 대피로가 이어진다.<br>구조 순서는 자유. 3초 동안 곁을 지켜야 하므로 침수가 빠진 직후 시작하자.',s.stage===1?[['대피 경로 기록',()=>{if(s.stage!==1||nearbyEstuary()?.id!=='chart')return;s.stage=2;saveGame();closeDialog();toast('북쪽·남쪽 조사원 구조 0/2 · 순서 자유');}]]:[]);return;}
 if(d.bit){if(s.stage!==2||s.rescued&d.bit){journeyDialog(d.name,s.rescued&d.bit?'조사원은 나루로 대피했다. 구조 기록은 저장되어 있다.':'먼저 젖은 조사 지도에서 대피 경로를 읽자.');return;}state.estuaryChannel={id:d.id,bit:d.bit,x:d.x,z:d.z,start:clock.elapsedTime,hp:state.hp};toast('구조 중 · 3초 동안 2m 안에서 공격·회피 없이 곁을 지키자.');return;}
 if(d.id==='sluice'){if(s.stage===3&&!s.bossWon){journeyDialog(d.name,'철갑병이 수문 손잡이를 막고 있다. 강공격으로 가드를 깨거나 스킬로 빈틈을 만들자.');return;}journeyDialog(d.name,s.stage>=4?'수문이 열려 대피로를 확보했다. 언덕 나루로 돌아가 기록을 인계하자.':s.stage===3?'철갑병이 쓰러졌다. 수문을 열어 남은 물을 흘려보내자.':'조사원 둘을 먼저 구조하자.',s.stage===3?[['수문 개방',()=>{if(s.stage!==3||nearbyEstuary()?.id!=='sluice'||!s.bossWon)return;s.stage=4;clearEstuaryFight();saveGame();closeDialog();sfx('reward',1);toast('회색 여울 수문 개방 · 언덕 나루에 구조 기록 인계');}]]:[]);}
}
function updateEstuary(now){const s=state.estuary,p=state.player.position,inside=inEstuary();state.estuarySluice.position.y=s.stage>=4?-1.8:1.3;for(const d of state.estuaryProps||[])if(d.bit){d.gem.visible=!(s.rescued&d.bit);if(d.person)d.person.visible=!(s.rescued&d.bit);}
 if(state.dead||!inside){if(state.estuaryFight||state.estuaryChannel)clearEstuaryFight();return;}
 if(!estuaryReady()||!s.stage){clearEstuaryFight();state.player.position.set(70,0,-12);return;}
 if((s.stage===2||(s.stage===3&&!s.bossWon))&&!state.estuaryFight&&!state.dialog&&!state.menuOpen){const defs=s.stage===2?ESTUARY_SITES.filter(d=>d.bit&&!(s.rescued&d.bit)).map(d=>({x:d.x-4,z:d.z,stats:{...WARRIOR,hp:90,dmg:12,guard:false,label:'여울 표류병'}})):[{x:169,z:0,stats:{...WARRIOR,hp:260,dmg:18,guard:true,combo:false,label:'수문 철갑병',estuaryBoss:true}}];state.estuaryFight=defs.map(d=>{const e=state.spawn(state.protos.skel,{...d.stats,aggro:11,noElite:true,noRespawn:true},d.x,d.z);e.expedition=true;e.trial=true;e.estuary=true;if(!e.nameSprite){e.nameSprite=makeNameSprite(e.stats.label);e.nameSprite.position.y=2.4;e.root.add(e.nameSprite)}return e;});}
 if(s.stage===3&&!s.bossWon&&state.estuaryFight?.some(e=>e.stats.estuaryBoss)&&state.estuaryFight.every(e=>e.dead)){s.bossWon=true;saveGame();toast('수문 철갑병 격파 · 손잡이에서 수문을 열자.');}
 for(const t of state.estuaryTides||[]){const active=s.stage===2&&!(s.rescued&t.bit);t.disc.visible=t.ring.visible=active;if(!active){t.at=0;t.next=0;continue;}if(state.dialog||state.menuOpen){t.next=now+2;t.at=0;t.disc.material.opacity=.12;t.ring.material.color.setHex(0x69cfe9);continue;}if(!t.next)t.next=now+2;if(!t.at&&now>=t.next){t.at=now+1.5;t.ring.material.color.setHex(0xff665b);t.disc.material.color.setHex(0xff665b);}t.disc.material.opacity=t.at?.18+.18*Math.sin(now*10)**2:.10;
  if(t.at&&now>=t.at){const wet=Math.hypot(p.x-t.x,p.z-t.z)<5.5,safe=Math.hypot(p.x-t.x-3.8,p.z-t.z)<1.5;if(wet){if(safe)t.saves++;else if(now<state.invUntil){t.blocks++;registerDodgeBlock(now);}else{t.hits++;state.hp=Math.max(0,state.hp-Math.max(1,16-GEAR_DEF[state.gear.armor]));state.estuaryChannel=null;hitFlash(state.player);sfx('hurt',.8);toast('여울 침수! 높은 돌로 피하거나 물 빠진 뒤 구조하자.');if(!state.hp)playerDie('여울 침수');}}t.at=0;t.next=now+6.5;t.ring.material.color.setHex(0x69cfe9);t.disc.material.color.setHex(0x599cb7);}
 }
 const ch=state.estuaryChannel;if(ch){if(state.dead||state.dialog||state.menuOpen||state.hp<ch.hp||Math.hypot(p.x-ch.x,p.z-ch.z)>2||now<state.dodgeUntil||now<state.attackUntil){state.estuaryChannel=null;toast('구조 중단 · 완료 기록 손실 없이 다시 시도할 수 있다.');}else if(now-ch.start>=3){s.rescued|=ch.bit;state.estuaryChannel=null;skillFx(p,0x88ffcc,1.6,'heal');if(s.rescued===3){s.stage=3;clearEstuaryFight();toast('조사원 둘 구조! 동쪽 수문을 열어 대피로를 확보하자.');}else toast('조사원 구조 완료 · 반대쪽 조사원에게 이동');saveGame();sfx('reward',.8);}}
}

// ---------- 수문 아래의 종: 단서의 순서와 안/바깥 파동 ----------
const BELL_SITES=[{id:'archive',name:'수문 아래의 종 · 기록대',x:129,z:-5},{id:'dawn',name:'해뜰녘 비석',x:140,z:-22,bit:1,text:'첫 울림은 해가 떠오르는 쪽에서 온다. 동쪽 종에 새긴 해 문양을 보자.'},{id:'flow',name:'물살 비석',x:143,z:21,bit:2,text:'둘째 울림은 물이 흘러가는 쪽. 수문 물길은 남쪽 종을 향한다.'},{id:'dusk',name:'해질녘 비석',x:173,z:11,bit:4,text:'마지막 울림은 해가 지는 쪽. 서쪽 종의 긴 그림자가 길을 닫는다.'},{id:'eastbell',name:'동쪽 · 해의 종',x:168,z:-10,tone:'east'},{id:'southbell',name:'남쪽 · 물의 종',x:151,z:18,tone:'south'},{id:'westbell',name:'서쪽 · 그림자 종',x:137,z:-7,tone:'west'}];
const BELL_ORDER=['east','south','west'];
function bellReady(){return state.estuary.stage===5;}
function bellStatus(){const s=state.bell;return s.stage===5?'수문 아래의 종 기록 완료 · 1P/원풍 조율 해금':s.stage===4?'나루 곁 기록대에서 마지막 기록 인계':s.stage===3?'중앙 파수꾼 · 바람칼날 1회/강공격 2회로 푸른 방어 깨기':s.stage===2?`종 순서 ${s.input}/3 · 비석 기록대로 울리기`:s.stage===1?`여울 비석 기록 ${[1,2,4].filter(b=>s.clues&b).length}/3`:bellReady()?'여울 나루 곁 기록대에서 다음 이야기':'회색 여울 구조 기록 인계 후 시작';}
function bellTarget(){const s=state.bell;if(!bellReady()||s.stage===5)return null;if(!inEstuary())return{...ESTUARY_SITES[0],label:'회색 여울 나루'};let d=BELL_SITES[0];if(s.stage===1)d=BELL_SITES.find(d=>d.bit&&!(s.clues&d.bit));else if(s.stage===2)d=BELL_SITES.filter(d=>d.tone).sort((a,b)=>Math.hypot(state.player.position.x-a.x,state.player.position.z-a.z)-Math.hypot(state.player.position.x-b.x,state.player.position.z-b.z))[0];else if(s.stage===3)return{x:151,z:1,label:'수문 종의 파수꾼'};return{...d,label:d.name};}
function buildBellSites(){state.bellProps=BELL_SITES.map(d=>{const root=new THREE.Group();root.position.set(d.x,0,d.z);const mat=new THREE.MeshLambertMaterial({color:d.tone?0xbba15a:0x657f8a});if(d.tone){const post=new THREE.Mesh(new THREE.BoxGeometry(.18,2.3,.18),mat);post.position.set(-.9,1.15,0);root.add(post);const post2=post.clone();post2.position.x=.9;root.add(post2);const beam=new THREE.Mesh(new THREE.BoxGeometry(2.2,.18,.22),mat);beam.position.y=2.3;root.add(beam);const bell=new THREE.Mesh(new THREE.CylinderGeometry(.28,.6,.8,12,1,true),new THREE.MeshLambertMaterial({color:0xe6c778,side:THREE.DoubleSide}));bell.position.y=1.7;root.add(bell);const lip=new THREE.Mesh(new THREE.TorusGeometry(.6,.065,6,20),mat);lip.rotation.x=Math.PI/2;lip.position.y=1.3;root.add(lip);const clapper=new THREE.Mesh(new THREE.SphereGeometry(.14,8,6),mat);clapper.position.y=1.35;root.add(clapper);}else{const body=new THREE.Mesh(new THREE.BoxGeometry(d.bit?1.4:1.8,d.bit?1.2:.7,.6),mat);body.position.y=d.bit?.65:.4;root.add(body);if(d.bit){const glyph=new THREE.Mesh(new THREE.TorusGeometry(.25,.045,5,12),new THREE.MeshBasicMaterial({color:0x9ce9f0}));glyph.position.set(0,.8,.32);root.add(glyph);}}
const gem=new THREE.Mesh(new THREE.OctahedronGeometry(.2),new THREE.MeshBasicMaterial({color:d.tone?0xffd477:0x93e7ee}));gem.position.y=d.tone?2.7:1.8;root.add(gem);const label=makeNameSprite(d.name);label.position.y=d.tone?3.1:2.2;root.add(label);scene.add(root);return{...d,root,gem};});}
function nearbyBell(){return state.ready&&!state.dead&&bellReady()?(state.bellProps||[]).find(d=>Math.hypot(state.player.position.x-d.x,state.player.position.z-d.z)<2.2)||null:null;}
function clearBellFight(){const e=state.bellEnemy;if(!e)return;if(e.bellDisc)scene.remove(e.bellDisc);if(e.bellRing)scene.remove(e.bellRing);if(e.tele)scene.remove(e.tele);e.dead=true;e.despawned=true;scene.remove(e.root);const i=state.enemies.indexOf(e);if(i>=0)state.enemies.splice(i,1);state.bellEnemy=null;}
function openBell(d){state.dlgFocus=d.root.position;const s=state.bell;
if(d.id==='archive'){const buttons=[];let text='수문이 열리고 물 아래 잠겼던 비석과 종이 드러났다. 세 비석의 단서를 기록하고, 해의 길과 물의 흐름에 맞춰 종을 울리자.<br><br><b>'+bellStatus()+'</b><br>비석은 자유 순서로 조사. 기록 세 개를 모으면 종을 울릴 수 있다. 틀리면 종 순서만 0/3으로 돌아가며 비석 기록은 유지된다.<br><br>세 종 뒤 중앙 파수꾼이 깨어난다. <b>푸른 방어는 바람칼날 1회 또는 강공격/회전베기 2회</b>로 해제된다. 방어 중 피해는 없고, 풀린 뒤 5초 동안 공격할 수 있다. <b>붉은 원은 안쪽 4.5m, 붉은 고리는 3~8m</b>가 위험하다. 1.4초 예고를 보고 영역 밖으로 움직이거나 회피하자. 방어 파괴는 준비 중 파동도 취소한다.<br>사망·섬 이탈은 미완료 전투만 초기화한다. 비석·종 진행·승리는 저장된다. 무료 도전, 적 전리품 없음. 마지막 기록 인계 1회380XP·220G·스킬1P. 완료하면 원풍 조율 해금: 장로 곁 스킬 창의 원풍 조율에서 기존 바람칼날 또는 관통풍을 선택한다. 이 기록대에서 무료 세 표적 연습도 가능.';
if(!s.stage)buttons.push(['잠긴 종 조사 시작',()=>{if(!bellReady()||s.stage||nearbyBell()?.id!=='archive')return;s.stage=1;state.tracked='bell';saveGame();closeDialog();toast('세 비석을 찾아 기록하자 · 순서 자유');}]);if(s.stage===5)buttons.push(['세 표적 연습 시작',startWindPractice],['안개의 항로',()=>openMist()]);if(archiveReady())buttons.push(['침묵의 기록원',openArchiveEntrance]);if(state.windPractice)buttons.push(['표적 연습 마치기',()=>{clearWindPractice();closeDialog();}]);if(s.stage===4)buttons.push(['종의 기록 인계',()=>{if(s.stage!==4||nearbyBell()?.id!=='archive')return;s.stage=5;state.gold+=220;state.skillPts=(state.skillPts||0)+1;gainXp(380);if(state.tracked==='bell')state.tracked='auto';saveGame();closeDialog();sfx('reward',1);toast('여울의 조율자 · 380XP · 220G · 스킬1P');}]);journeyDialog(d.name,text,buttons);return;}
if(d.bit){const text=d.text+'<br><br>'+((s.clues&d.bit)?'이미 수첩에 기록했다.':s.stage===1?'이 비석의 단서를 수첩에 적자.':'먼저 나루 곁 기록대에서 조사를 시작하자.');journeyDialog(d.name,text,s.stage===1&&!(s.clues&d.bit)?[['비석 단서 기록',()=>{if(s.stage!==1||nearbyBell()?.id!==d.id||s.clues&d.bit)return;s.clues|=d.bit;if(s.clues===7)s.stage=2;saveGame();closeDialog();sfx('reward',.5);toast(s.stage===2?'단서 기록 완료 · 해의 길과 물의 흐름대로 종을 울리자':'비석 단서를 기록했다. 다른 비석을 찾아보자.');}]]:[]);return;}
const clues=BELL_SITES.filter(d=>d.bit&&(s.clues&d.bit)).map(d=>d.text).join('<br>');journeyDialog(d.name,s.stage>=3?'세 종의 울림이 수문 아래로 이어졌다.':s.stage===2?`기록한 단서:<br>${clues}<br><br>지금까지 맞춘 울림 ${s.input}/3. 이 종을 울릴까?`:'먼저 세 비석의 단서를 모두 기록하자.',s.stage===2?[['이 종 울리기',()=>{if(s.stage!==2||nearbyBell()?.id!==d.id)return;if(d.tone===BELL_ORDER[s.input]){s.input++;skillFx(d.root.position,0xffd779,1.7,'ready');sfx('reward',.6);if(s.input===3){s.stage=3;toast('세 종의 울림 · 중앙의 파수꾼이 깨어난다.');}else toast(`올바른 울림 · ${s.input}/3`);}else{s.input=0;toast('어긋난 울림 · 단서는 유지, 종 순서만 처음부터');sfx('hurt',.3);}saveGame();closeDialog();}]]:[]);}
function bellShieldHit(e,dmg,heavy,source){if(!e.stats.bellBoss||e.dead)return false;const now=clock.elapsedTime;if(now<(e.bellExposed||0))return false;if(source==='windshot')e.bellCracks=2;else if(heavy)e.bellCracks=(e.bellCracks||0)+1;if(e.bellCracks>=2){e.bellExposed=now+5;e.bellAt=0;e.bellNext=now+6.8;e.bellDisc.visible=e.bellRing.visible=false;e.bellCracks=0;e.bellBreaks++;skillFx(e.root.position,0xffd779,2,'break');toast('종 방어 해제! 5초 동안 접근 공격');sfx('reward',.8);}else{skillFx(e.root.position,0x8edcf5,1.6,'hit');toast(heavy?'방어 균열 1/2 · 강공격 한 번 더!':'푸른 방어! 바람칼날 1회 또는 강공격 2회');}return true;}
function updateBellEnemy(e,dt,now){if(!e.stats.bellBoss)return false;e.anim.update(dt);if(state.dead||state.dialog||state.menuOpen){e.bellAt=0;e.bellNext=now+1.8;e.bellDisc.visible=e.bellRing.visible=false;return true;}const p=state.player.position;const d=Math.hypot(p.x-e.root.position.x,p.z-e.root.position.z);e.root.rotation.y=Math.atan2(p.x-e.root.position.x,p.z-e.root.position.z);const exposed=now<(e.bellExposed||0);e.bellShield.visible=!exposed;e.bellShield.rotation.y=now*.7;e.bellShield.material.opacity=.18+.10*Math.sin(now*4)**2;if(exposed){e.bellDisc.visible=e.bellRing.visible=false;return true;}e.bellExposed=0;if(!e.bellNext)e.bellNext=now+1.8;
if(!e.bellAt&&now>=e.bellNext){e.bellAt=now+1.4;e.bellOuter=!e.bellOuter;e.bellDisc.visible=!e.bellOuter;e.bellRing.visible=e.bellOuter;toast(e.bellOuter?'붉은 고리 예고 · 3m 안쪽 또는 8m 밖으로!':'붉은 원 예고 · 4.5m 밖으로!');}
if(e.bellAt){const opacity=.22+.25*Math.sin(now*10)**2;e.bellDisc.material.opacity=e.bellRing.material.opacity=opacity;if(now>=e.bellAt){const hit=e.bellOuter?(d>=3&&d<8):d<4.5;if(hit){if(now<state.invUntil){e.bellDodges++;registerDodgeBlock(now);}else{e.bellHits++;state.hp=Math.max(0,state.hp-Math.max(1,20-GEAR_DEF[state.gear.armor]));hitFlash(state.player);sfx('hurt',.8);if(state.hp<=0)playerDie('수문 종의 파동');}}e.bellPulses++;e.bellAt=0;e.bellNext=now+2.4;e.bellDisc.visible=e.bellRing.visible=false;}}return true;}
function updateBell(now){for(const d of state.bellProps||[]){d.root.visible=bellReady();if(d.bit)d.gem.visible=!(state.bell.clues&d.bit);else if(d.tone){const i=BELL_ORDER.indexOf(d.tone);d.gem.material.color.setHex(state.bell.stage>=3||i<state.bell.input?0x8affce:0xffd477);}}
if(state.dead||!inEstuary()){clearBellFight();return;}if(!bellReady()||state.bell.stage!==3){if(state.bellEnemy&&state.bell.stage!==4)clearBellFight();return;}
if(state.bellEnemy?.dead){state.bell.stage=4;clearBellFight();saveGame();toast('파수꾼의 울림이 잦아들었다 · 나루 곁 기록대로');return;}
if(!state.bellEnemy&&!state.dialog&&!state.menuOpen&&Math.hypot(state.player.position.x-151,state.player.position.z-1)<13){const e=state.spawn(state.protos.skel,{...WARRIOR,hp:420,dmg:20,guard:false,combo:false,aggro:20,noElite:true,noRespawn:true,label:'수문 종의 파수꾼',bellBoss:true},151,1);e.expedition=true;e.trial=true;e.estuary=true;e.root.scale.multiplyScalar(1.25);if(!e.nameSprite){e.nameSprite=makeNameSprite(e.stats.label);e.nameSprite.position.y=2.8;e.root.add(e.nameSprite);}e.bellShield=new THREE.Mesh(new THREE.CylinderGeometry(1.6,1.6,2.7,16,1,true),new THREE.MeshBasicMaterial({color:0x6edaff,transparent:true,opacity:.24,side:THREE.DoubleSide,depthWrite:false}));e.bellShield.position.y=1.4;e.root.add(e.bellShield);e.bellDisc=new THREE.Mesh(new THREE.CircleGeometry(4.5,48),new THREE.MeshBasicMaterial({color:0xff594f,transparent:true,opacity:.3,side:THREE.DoubleSide,depthWrite:false}));e.bellRing=new THREE.Mesh(new THREE.RingGeometry(3,8,64),e.bellDisc.material.clone());for(const m of[e.bellDisc,e.bellRing]){m.rotation.x=-Math.PI/2;m.position.set(151,.09,1);m.visible=false;scene.add(m);}e.bellCracks=e.bellBreaks=e.bellHits=e.bellDodges=e.bellPulses=0;e.bellOuter=true;e.bellNext=now+2;state.bellEnemy=e;toast('푸른 방어! 바람칼날 1회 또는 강공격/회전베기 2회');}}

// ---------- 안개의 항로: 번갈아 켜지는 빛으로 추적자를 유인 ----------
const MIST_LAMPS=[{id:'westlight',name:'서쪽 항로등',x:137,z:8,bit:1},{id:'eastlight',name:'동쪽 항로등',x:151,z:8,bit:2}];
function mistReady(){return state.bell.stage===5;}
function mistStatus(){const s=state.mist;return s.stage===4?'안개 항로 기록 인계 완료':s.stage===3?'나루 기록대에 돌아가 항로 기록 인계':s.stage===2?'켜진 등불 반경 4m로 추적자를 유인 · 8초마다 빛 교대':s.stage===1?`항로등 복구 ${Number(!!(s.lamps&1))+Number(!!(s.lamps&2))}/2`:mistReady()?'여울 기록대에서 안개의 항로 시작':'수문 아래의 종 기록 인계 후 시작';}
function mistTarget(){const s=state.mist;if(!mistReady()||s.stage===4)return null;if(!inEstuary())return{...ESTUARY_SITES[0],label:'회색 여울 나루'};if(s.stage===1){const d=MIST_LAMPS.find(d=>!(s.lamps&d.bit));return{...d,label:d.name};}if(s.stage===2){const d=MIST_LAMPS[state.mistFight?.active||0];return{...d,label:'빛으로 추적자 유인 · '+d.name};}return{x:129,z:-5,label:'나루 기록대 · 안개의 항로'};}
function buildMist(){state.mistProps=MIST_LAMPS.map(d=>{const root=new THREE.Group();root.position.set(d.x,0,d.z);const stone=new THREE.MeshLambertMaterial({color:0x657786}),bronze=new THREE.MeshLambertMaterial({color:0x9a7a42});const base=new THREE.Mesh(new THREE.CylinderGeometry(.55,.75,.4,8),stone);base.position.y=.2;root.add(base);const post=new THREE.Mesh(new THREE.CylinderGeometry(.12,.18,2.6,8),bronze);post.position.y=1.5;root.add(post);const cage=new THREE.Mesh(new THREE.CylinderGeometry(.5,.6,.7,8,1,true),new THREE.MeshLambertMaterial({color:0xe6bc69,transparent:true,opacity:.45,side:THREE.DoubleSide}));cage.position.y=2.8;root.add(cage);const cap=new THREE.Mesh(new THREE.ConeGeometry(.75,.55,8),bronze);cap.position.y=3.4;root.add(cap);const flame=new THREE.Mesh(new THREE.OctahedronGeometry(.35),new THREE.MeshBasicMaterial({color:0xffd577}));flame.position.y=2.8;root.add(flame);const label=makeNameSprite(d.name);label.position.y=4;root.add(label);const disc=new THREE.Mesh(new THREE.CircleGeometry(4,48),new THREE.MeshBasicMaterial({color:0xffd57b,transparent:true,opacity:.16,depthWrite:false,side:THREE.DoubleSide}));disc.rotation.x=-Math.PI/2;disc.position.y=.095;root.add(disc);const ring=new THREE.Mesh(new THREE.RingGeometry(3.9,4,48),new THREE.MeshBasicMaterial({color:0xffde91,side:THREE.DoubleSide,transparent:true,opacity:.8}));ring.rotation.x=-Math.PI/2;ring.position.y=.1;root.add(ring);scene.add(root);return{...d,root,flame,disc,ring};});}
function nearbyMist(){return state.ready&&!state.dead&&mistReady()?(state.mistProps||[]).find(d=>Math.hypot(state.player.position.x-d.x,state.player.position.z-d.z)<2.2)||null:null;}
function openMist(d=null){const s=state.mist;state.dlgFocus=d?d.root.position:state.player.position;const buttons=[];if(d){journeyDialog(d.name,(s.lamps&d.bit)?'항로등을 복구했다. 두 등불이 모두 켜지면 안개 속 추적자가 모습을 드러낸다.':s.stage===1?'떠내려온 기록에는 두 등불 사이로 돌아오라는 말이 남아 있다. 심지를 바로잡고 등불을 밝히자.':'먼저 나루 기록대에서 안개의 항로 조사를 시작하자.',s.stage===1&&!(s.lamps&d.bit)?[['항로등 밝히기',()=>{if(s.stage!==1||nearbyMist()?.id!==d.id||s.lamps&d.bit)return;s.lamps|=d.bit;if(s.lamps===3)s.stage=2;saveGame();closeDialog();skillFx(d.root.position,0xffd57b,2,'ready');toast(s.stage===2?'두 불빛 사이의 추적자 · 켜진 빛으로 유인하자.':'항로등 복구 · 반대쪽 등불을 찾아보자.');}]]:[]);return;}
const text='<b>'+mistStatus()+'</b><br><br>종의 울림이 사라지자, 오래전 뱃사공이 남긴 항로등 두 개가 드러났다. 그는 안개를 베는 대신 불빛 안으로 이끌었다고 적었다.<br><br>남쪽의 <b>서쪽·동쪽 항로등</b>을 자유 순서로 밝히자. 두 등을 복구하면 추적자가 나타난다. <b>추적자 자신이 금빛 원(반경 4m) 안에 있어야</b> 근접과 원거리 공격 모두 피해를 준다. 내가 원 안에 있는 것만으로는 안 된다. 보랏빛 몸은 무피해, 금빛 몸은 공격 기회다.<br><br><b>빛은 8초마다 반대 등으로 교대</b>한다. 마지막 1.5초 동안 현재 원이 깜박이고 다음 원 테두리가 푸르게 빛난다. 적은 다가오다가 <b>붉은 원 1초 예고 뒤 2.4m 공격</b>을 한다. 준비 중에는 적이 멈추므로 영역 밖으로 움직이거나 Q/회피로 피하자. 공격·피격으로 예고가 취소되지는 않는다.<br><br>대화·메뉴는 공격 예고를 취소하고 빛 교대 시간을 멈춘다. 사망·섬 이탈·전투 중심에서 25m 이탈은 미완료 전투만 초기화한다. 복구한 등·승리 기록은 저장된다. 무료 도전, 적 전리품 없음. 기록 인계는 한 번 <b>420XP·260G</b>.';
if(!s.stage&&mistReady())buttons.push(['안개 항로 조사 시작',()=>{if(!mistReady()||s.stage||nearbyBell()?.id!=='archive')return;clearWindPractice();s.stage=1;state.tracked='mist';saveGame();closeDialog();toast('남쪽 항로등 둘을 찾아 불을 밝히자.');}]);if(s.stage===3)buttons.push(['안개 항로 기록 인계',()=>{if(s.stage!==3||nearbyBell()?.id!=='archive')return;s.stage=4;state.gold+=260;gainXp(420);if(state.tracked==='mist')state.tracked='auto';saveGame();closeDialog();sfx('reward',1);toast('안개 항로의 길잡이 · 420XP · 260G');}]);journeyDialog('안개의 항로',text,buttons);}
function mistLit(e){const f=state.mistFight;if(!f||f.enemy!==e)return false;const d=MIST_LAMPS[f.active];return Math.hypot(e.root.position.x-d.x,e.root.position.z-d.z)<=4;}
function mistDamage(e){if(!e.stats.mistHunter||mistLit(e))return false;const f=state.mistFight;if(f)f.blocks++;skillFx(e.root.position,0xb0a4e8,1.3,'hit');if(!e.mistHint||clock.elapsedTime>e.mistHint){toast('안개를 통과했다 · 적을 켜진 금빛 원 안으로 유인!');e.mistHint=clock.elapsedTime+2;}return true;}
function clearMistFight(){const f=state.mistFight;if(!f)return;const e=f.enemy;for(const m of[e.mistAura,e.mistAttack]){if(m){m.parent?.remove(m);m.geometry.dispose();m.material.dispose();}}if(e.tele)scene.remove(e.tele);e.dead=true;e.despawned=true;scene.remove(e.root);const i=state.enemies.indexOf(e);if(i>=0)state.enemies.splice(i,1);state.mistFight=null;}
function spawnMistFight(now){const e=state.spawn(state.protos.skel,{...WARRIOR,hp:540,dmg:22,guard:false,combo:false,aggro:30,noElite:true,noRespawn:true,label:'안개 추적자',mistHunter:true},144,11);e.expedition=e.trial=e.estuary=true;e.root.scale.multiplyScalar(1.15);e.mistNext=now+2;e.mistAt=0;e.mistHits=e.mistDodges=e.mistStrikes=0;if(!e.nameSprite){e.nameSprite=makeNameSprite(e.stats.label);e.nameSprite.position.y=3;e.root.add(e.nameSprite);}e.mistAura=new THREE.Mesh(new THREE.CylinderGeometry(1.25,1.6,2.5,12,1,true),new THREE.MeshBasicMaterial({color:0x9d87e5,transparent:true,opacity:.30,depthWrite:false,side:THREE.DoubleSide}));e.mistAura.position.y=1.3;e.root.add(e.mistAura);e.mistAttack=new THREE.Mesh(new THREE.CircleGeometry(2.4,40),new THREE.MeshBasicMaterial({color:0xff6257,transparent:true,opacity:.32,depthWrite:false,side:THREE.DoubleSide}));e.mistAttack.rotation.x=-Math.PI/2;e.mistAttack.visible=false;scene.add(e.mistAttack);state.mistFight={enemy:e,active:0,next:now+8,last:now,swaps:0,blocks:0};}
function updateMistEnemy(e,dt,now){if(!e.stats.mistHunter)return false;const f=state.mistFight;if(!f)return true;e.anim.update(dt);if(state.dead||state.dialog||state.menuOpen){e.mistAt=0;e.mistNext=now+1.5;e.mistAttack.visible=false;return true;}const p=state.player.position,to=p.clone().sub(e.root.position);to.y=0;const d=to.length();e.root.rotation.y=Math.atan2(to.x,to.z);e.mistAura.material.color.setHex(mistLit(e)?0xffd477:0x9d87e5);e.mistAura.material.opacity=mistLit(e)?.20:.32;
if(e.mistAt){e.mistAttack.visible=true;e.mistAttack.position.set(e.root.position.x,.12,e.root.position.z);e.mistAttack.material.opacity=.2+.22*Math.sin(now*12)**2;if(now>=e.mistAt){if(d<2.4){if(now<state.invUntil){e.mistDodges++;registerDodgeBlock(now);}else{e.mistHits++;state.hp=Math.max(0,state.hp-Math.max(1,22-GEAR_DEF[state.gear.armor]));hitFlash(state.player);sfx('hurt',.8);if(!state.hp)playerDie('안개 추적자');}}e.mistStrikes++;e.mistAt=0;e.mistNext=now+1.8;e.mistAttack.visible=false;}return true;}
if(now<e.mistNext){e.anim.play('idle');return true;}if(d<2.2){e.mistAt=now+1;e.mistAttack.visible=true;e.mistAttack.position.set(e.root.position.x,.12,e.root.position.z);e.anim.playOnce('unarmed_melee_attack_punch','attack');return true;}if(d>.05){const step=to.normalize().multiplyScalar(Math.min(d,2.9*enemyMoveScale(e,now)*dt));e.root.position.add(step);for(const c of colliders){const dx=e.root.position.x-c.x,dz=e.root.position.z-c.z,cd=Math.hypot(dx,dz),r=c.r+.55;if(cd<r&&cd>.001){e.root.position.x=c.x+dx*r/cd;e.root.position.z=c.z+dz*r/cd;}}clampWorld(e.root.position);e.anim.play('running','run','walking','walk');}return true;}
function updateMist(dt,now){const s=state.mist,p=state.player.position;let f=state.mistFight;if(f&&f.enemy.dead){s.stage=3;clearMistFight();saveGame();toast('항로 등불 아래 남은 이름을 찾았다 · 나루 기록대로');f=null;}if(state.dead||state.windPractice||!inEstuary()||Math.hypot(p.x-144,p.z-8)>25){clearMistFight();f=null;}else if(mistReady()&&s.stage===2&&!f&&!state.dialog&&!state.menuOpen&&Math.hypot(p.x-144,p.z-8)<16){spawnMistFight(now);f=state.mistFight;}
if(f){const elapsed=now-f.last;f.last=now;if(state.dialog||state.menuOpen)f.next+=elapsed;else if(now>=f.next){f.active=1-f.active;f.next=now+8;f.swaps++;sfx('reward',.3);toast(MIST_LAMPS[f.active].name+' 점등 · 적을 이 빛으로 유인!');}}
for(const d of state.mistProps||[]){d.root.visible=mistReady();const lit=!!(s.lamps&d.bit),active=!!f&&MIST_LAMPS[f.active].id===d.id,warn=!!f&&f.next-now<=1.5;d.flame.visible=lit&&(!f||active);d.flame.rotation.y=now;d.flame.scale.setScalar(.9+.12*Math.sin(now*5));d.disc.visible=s.stage>=2&&(active||s.stage>=3);d.ring.visible=lit;d.disc.material.opacity=warn&&active?.08+.18*Math.sin(now*12)**2:.16;d.ring.material.color.setHex(active||s.stage>=3?0xffde91:warn?0x81e5ff:0x687b91);}}

// ---------- 침묵의 기록원: 두 날개와 북쪽 회랑 ----------
const ARCHIVE_SITES=[{id:'desk',name:'기록원 · 귀환 대합실',x:260,z:25},{id:'clue',name:'서가의 사서 수기',x:240,z:12},{id:'moon',name:'달의 서가',x:234,z:-5},{id:'wind',name:'바람의 서가',x:240,z:3},{id:'tide',name:'물결의 서가',x:245,z:-5},{id:'valveN',name:'북쪽 수로 조절기',x:282,z:-6,bit:1},{id:'valveS',name:'남쪽 수로 조절기',x:285,z:12,bit:2},{id:'seal',name:'북쪽 회랑의 잠금문',x:260,z:-7},{id:'core',name:'이름을 간직한 원본',x:260,z:-28}];
function archiveReady(){return state.mist.stage===4;}
function inArchive(p=state.player?.position){return!!p&&p.x>=230&&p.x<=290&&p.z>=-32&&p.z<=32;}
function archiveStatus(){const s=state.archive;if(s.stage===4)return '침묵의 기록원 완료 · '+(s.ending==='keep'?'원본 보존':'길잡이 사본');if(s.stage===3)return '여울 기록대에 원본의 운명을 전하기';if(s.stage===2)return '북쪽 원본대에서 핵심 기록 회수';if(s.stage===1)return `서가 ${s.shelf?'완료':s.read?`${s.input}/3`:'수기 조사'} · 수로 ${Number(!!(s.valves&1))+Number(!!(s.valves&2))}/2 · 회랑 ${s.wave}/2`;return archiveReady()?'여울 기록대에서 침묵의 기록원으로':'안개 항로 기록 인계 후 개방';}
function archiveTarget(){const s=state.archive;if(!archiveReady()||s.stage===4)return null;if(!inArchive())return{x:129,z:-5,label:'여울 기록대 · 침묵의 기록원'};let id='desk';if(s.stage===2)id='core';else if(s.stage===1)id=!s.shelf?(s.read?ARCHIVE_SITES.filter(d=>['moon','wind','tide'].includes(d.id)).sort((a,b)=>Math.hypot(state.player.position.x-a.x,state.player.position.z-a.z)-Math.hypot(state.player.position.x-b.x,state.player.position.z-b.z))[0].id:'clue'):s.valves!==3?(!(s.valves&1)?'valveN':'valveS'):'seal';const d=ARCHIVE_SITES.find(d=>d.id===id);const target=id==='seal'&&s.shelf&&s.valves===3?{x:260,z:-22,label:'북쪽 회랑 경비'}:{...d,label:d.name};return archiveRoute(target);}
function archiveRoute(target){const p=state.player.position;let x,z,label;if(p.z<-12&&target.z>-10&&Math.abs(p.x-260)>2){x=260;z=-16;label='북쪽 회랑 중앙 출구';}else if(p.z>-11&&p.x<249&&target.x>251){x=p.z<6||p.z>10?245:255;z=8;label='서가 중앙 통로';}else if(p.z>-11&&p.x>271&&target.x<269){x=p.z<6||p.z>10?278:265;z=8;label='수로 중앙 통로';}else if(p.z>-11&&p.x>=249&&p.x<=271&&(target.x<249||target.x>271)){x=p.z<6||p.z>10?260:target.x<249?245:278;z=8;label='양 날개 연결 통로';}return label?{x,z,label}:target;}
function archiveWall(root,x,z,w,d,gate=false){const mat=new THREE.MeshLambertMaterial({color:gate?0x8b7561:0x60747c}),m=new THREE.Mesh(new THREE.BoxGeometry(w,gate?2.5:1.3,d),mat);m.position.set(x,gate?1.25:.65,z);root.add(m);registerTreeFade(m,x,z);const cs=[];const n=Math.ceil(Math.max(w,d)/1.3);for(let i=0;i<=n;i++){const c={x:x+(w>d?(i/n-.5)*(w-.3):0),z:z+(d>=w?(i/n-.5)*(d-.3):0),r:.8,archiveWall:true,observatoryWall:true,archiveGate:gate};colliders.push(c);cs.push(c);}return{mesh:m,colliders:cs};}
async function buildArchive(){const root=new THREE.Group();scene.add(root);state.archiveRoot=root;const skirt=new THREE.Mesh(new THREE.BoxGeometry(64,2,68),new THREE.MeshLambertMaterial({color:0x4f626c}));skirt.position.set(260,-1.1,0);root.add(skirt);const sea=new THREE.Mesh(new THREE.PlaneGeometry(86,90),new THREE.MeshBasicMaterial({color:0x6296af,side:THREE.DoubleSide}));sea.rotation.x=-Math.PI/2;sea.position.set(260,-1.5,0);root.add(sea);const floor=new THREE.Mesh(new THREE.BoxGeometry(62,.12,66),new THREE.MeshLambertMaterial({color:0xaaa697}));floor.position.set(260,-.04,0);floor.receiveShadow=true;root.add(floor);const rooms=[[240,0,19,28,0x817d81],[281,0,18,28,0x748f91],[260,-22,56,18,0x8e8695],[260,23,56,16,0xb4ab8f]];for(const[x,z,w,d,c]of rooms){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),new THREE.MeshLambertMaterial({color:c,side:THREE.DoubleSide}));m.rotation.x=-Math.PI/2;m.position.set(x,.04,z);root.add(m);}for(const[x,z,w,d]of[[230,-.5,1,65],[290,-.5,1,65],[260,-32,60,1],[260,32,60,1],[250,-2,1,16],[250,13,1,4],[270,-2,1,16],[270,13,1,4],[243,-11,26,1],[277,-11,26,1]])archiveWall(root,x,z,w,d);state.archiveGate=archiveWall(root,260,-11,7.5,1,true);
for(const[x,z]of[[254,-18],[266,-18]]){const m=new THREE.Mesh(new THREE.BoxGeometry(1.9,2,1.9),new THREE.MeshLambertMaterial({color:0x777d87}));m.position.set(x,1,z);root.add(m);colliders.push({x,z,r:1.25,archiveWall:true,observatoryWall:true});registerTreeFade(m,x,z);}
state.archiveProps=ARCHIVE_SITES.map(d=>{const g=new THREE.Group();g.position.set(d.x,0,d.z);const isShelf=['moon','wind','tide'].includes(d.id),isValve=!!d.bit;const mat=new THREE.MeshLambertMaterial({color:isValve?0x97824d:isShelf?0x735b48:0x687b85});const base=new THREE.Mesh(new THREE.BoxGeometry(isShelf?2:1.6,isShelf?2.1:.7,isShelf?.65:1.2),mat);base.position.y=isShelf?1.05:.35;g.add(base);if(isShelf){const col=d.id==='moon'?0xc1b6e0:d.id==='wind'?0x84c6b0:0x85b8e5;for(let i=0;i<7;i++){const book=new THREE.Mesh(new THREE.BoxGeometry(.16,.65,.4),new THREE.MeshLambertMaterial({color:col}));book.position.set(-.7+i*.23,.9,.42);g.add(book);}const bar=new THREE.Mesh(new THREE.BoxGeometry(2.2,.12,.9),mat);bar.position.y=1.35;g.add(bar);}if(isValve){const wheel=new THREE.Mesh(new THREE.TorusGeometry(.6,.09,6,16),new THREE.MeshLambertMaterial({color:0xe1c783}));wheel.position.y=1.3;g.add(wheel);const spoke=new THREE.Mesh(new THREE.BoxGeometry(1.1,.06,.06),wheel.material);spoke.position.y=1.3;g.add(spoke);}const gem=new THREE.Mesh(new THREE.OctahedronGeometry(.23),new THREE.MeshBasicMaterial({color:0xffd88a}));gem.position.y=isShelf?2.6:2;g.add(gem);const name=makeNameSprite(d.name);name.position.y=isShelf?3.1:2.5;g.add(name);root.add(g);return{...d,root:g,gem};});
state.archiveStreams=[-1,5].map((z,i)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(17,2.6),new THREE.MeshBasicMaterial({color:0x70cadf,transparent:true,opacity:.25,depthWrite:false,side:THREE.DoubleSide}));m.rotation.x=-Math.PI/2;m.position.set(281,.085,z);root.add(m);const arrow=makeNameSprite('수로 · 붉은 띠 밖으로');arrow.position.set(281,1.1,z);root.add(arrow);return{z,i,mesh:m,label:arrow,at:0,next:0,hits:0,dodges:0};});
if(params.get('lite')!=='1'){for(const[file,height,spots]of[['column.gltf.glb',3.2,[[232,18],[248,18],[272,18],[288,18],[232,-29],[288,-29]]]]){try{const p=await load('assets/dungeon/'+file);for(const[x,z]of spots){const o=shadowify(p.scene.clone());const box=new THREE.Box3().setFromObject(o),size=box.getSize(new THREE.Vector3()),h=file.startsWith('shelf')?Math.max(size.x,size.y,size.z)/1.4:size.y;o.scale.multiplyScalar(height/h);o.position.set(x,-box.min.y*height/h,z);root.add(o);registerTreeFade(o,x,z);}}catch(e){console.warn('archive decoration',file,e);}}}
const sign=makeNameSprite('서가 ← 대합실 → 수로');sign.scale.multiplyScalar(1.6);sign.position.set(260,3.5,20);root.add(sign);}
function nearbyArchive(){return state.ready&&!state.dead&&inArchive()?(state.archiveProps||[]).find(d=>Math.hypot(state.player.position.x-d.x,state.player.position.z-d.z)<2.2)||null:null;}
function clearArchiveFight(){for(const e of state.archiveFight||[]){cancelArcher(e);if(e.tele)scene.remove(e.tele);for(const m of e.archerLines||[])scene.remove(m);for(const a of e.arrows||[])scene.remove(a.root);e.dead=true;e.despawned=true;scene.remove(e.root);const i=state.enemies.indexOf(e);if(i>=0)state.enemies.splice(i,1);}state.archiveFight=null;state.archiveChannel=null;}
function archiveTravel(inside){clearArchiveFight();clearMistFight();clearWindPractice();clearBellFight();clearEstuaryFight();clearCourierFight();clearCartRun();clearEchoFight();clearObservatoryFight();clearBeaconFight();if(state.trial?.active)endTrial(false);cancelWindshot('travel');resetMasteryCombat();state.dodgeFrom=null;state.dodgeUntil=0;state.attackUntil=0;state.autoOn=false;document.getElementById('auto').textContent='자동 전투 OFF';document.getElementById('auto').classList.remove('on');state.player.position.set(inside?260:129,0,inside?25:-5);state.invUntil=Math.max(state.invUntil,clock.elapsedTime+1);state.tracked='archive';closeDialog();saveGame();toast(inside?'침묵의 기록원 · 서가와 수로는 자유 순서로 조사':'여울 기록대로 귀환 · 기록원 진행 보존');}
function openArchiveEntrance(){const s=state.archive,bs=[];const text='<b>'+archiveStatus()+'</b><br><br>안개 항로의 끝은 이름을 지우는 기록원으로 이어진다. 같은 적을 더 많이 잡는 곳이 아니라, 두 날개의 기록을 모아 닫힌 회랑을 여는 별도 지역이다.<br><br><b>서쪽 서가</b>에서는 사서의 수기를 읽고 달·바람·물결 서가의 순서를 추론한다. 틀려도 수기는 잃지 않는다. <b>동쪽 수로</b>에서는 번갈아 붉어지는 물길을 건너 조절기 둘을 각각 2.5초 동안 작동한다. 1.8m 이탈·피격·회피·공격·메뉴는 작업을 취소한다.<br><br>둘을 마치면 <b>북쪽 회랑</b> 개방. 첫 경비는 기둥 엄폐와 사격 예고 끊기, 다음 경비는 강공격 가드 파괴로 대응한다. 두 전투 사이 승리는 저장된다. 마지막 원본을 회수해 이곳에 인계하며 기록의 운명을 고른다.<br><br>배편·귀환·재도전 무료. 각 날개·조절기·전투 차수·원본 회수 저장. 사망·지역 이탈·재접속은 미완료 전투와 작업만 초기화한다. 경비별 전리품 없음. 마지막 인계 한 번 <b>600XP·400G·스킬1P</b>. 보존/공유는 이야기 기록만 다르며 능력치 보상은 같다.<br><br><b>인계 후 보법 연마 해금</b>: Lv.10과 잔상 습득 후 장로 곁 스킬 창(K)에서 2P로 짧은/긴 발걸음 중 하나를 배운다. 안전한 장로 곁에서 보법 비용2P를 돌려받아 기본 회피로 돌아갈 수 있다.';
if(archiveReady()){bs.push([s.stage?'기록원으로 다시 건너가기':'침묵의 기록원 조사 시작',()=>{if(!archiveReady()||nearbyBell()?.id!=='archive')return;if(!s.stage)s.stage=1;archiveTravel(true);}]);if(s.stage===3)for(const[id,label]of[['keep','원본을 보존해 인계'],['share','길잡이 사본으로 인계']])bs.push([label,()=>{if(s.stage!==3||nearbyBell()?.id!=='archive')return;s.stage=4;s.ending=id;state.gold+=400;state.skillPts=(state.skillPts||0)+1;gainXp(600);saveGame();closeDialog();sfx('reward',1);toast('침묵을 건넌 기록 · 600XP · 400G · 스킬1P · 보법 연마(K) 해금');}]);}journeyDialog('침묵의 기록원',text,bs);}
function archiveMapHtml(){const s=state.archive;return `<div style="margin:8px 0;padding:10px;background:#1b2a34;border:1px solid #647c8e;border-radius:8px;text-align:center"><div style="padding:10px;background:#494353">북쪽 원본대<br>회랑 ${s.wave}/2 · ${s.stage>=3?'원본 회수':'원본 미회수'}</div><div style="padding:7px">↑ ${s.shelf&&s.valves===3?'문 열림':'서가 + 수로 기록 필요'}</div><div style="display:flex;gap:10px"><div style="flex:1;background:#514d51;padding:8px">서쪽 서가<br>${s.shelf?'복원 완료':s.read?'수기 기록됨':'수기부터 조사'}</div><div style="flex:1;background:#36535b;padding:8px">동쪽 수로<br>조절기 ${Number(!!(s.valves&1))+Number(!!(s.valves&2))}/2</div></div><div style="padding:9px">↖ 자유 순서 ↗</div><div style="padding:9px;background:#665e49">남쪽 대합실 · 언제든 여울로 귀환</div></div>`;}
function openArchive(d){const s=state.archive;state.dlgFocus=d.root.position;if(d.id==='desk'){journeyDialog(d.name,archiveMapHtml()+archiveStatus()+'<br><br>서쪽 서가와 동쪽 수로는 원하는 순서로 진행한다. 북쪽 문은 두 날개의 기록이 있어야 열린다. 귀환은 언제든 무료이며 완료한 기록은 사라지지 않는다.',[['여울 기록대로 귀환',()=>{if(nearbyArchive()?.id==='desk')archiveTravel(false);}]]);return;}if(d.id==='clue'){journeyDialog(d.name,'사서의 수기: "<b>첫 장은 밤하늘을 비추고, 다음 장은 보이지 않는 숨결로 넘긴다. 마지막 장은 바다의 흔들림 속에 묻는다.</b>"<br><br>서가의 이름과 대조해 순서대로 책을 펼치자. 수기를 기록한 뒤부터 시도할 수 있다.',!s.read&&s.stage===1?[['사서 수기 기록',()=>{if(nearbyArchive()?.id!=='clue'||s.read)return;s.read=true;saveGame();closeDialog();toast('서가 수기를 기록했다 · 밤하늘, 숨결, 바다');}]]:[]);return;}if(['moon','wind','tide'].includes(d.id)){journeyDialog(d.name,s.shelf?'서가 기록은 이미 복원했다.':!s.read?'먼저 서가 남쪽의 사서 수기를 읽자.':`첫 장은 밤하늘, 다음 장은 숨결, 마지막 장은 바다.<br>올바른 책 ${s.input}/3 · 이 서가를 펼칠까?`,s.stage===1&&s.read&&!s.shelf?[['서가 펼치기',()=>{if(nearbyArchive()?.id!==d.id||s.shelf||!s.read)return;if(d.id===['moon','wind','tide'][s.input]){s.input++;skillFx(d.root.position,0x94dfdb,1.7,'ready');if(s.input===3){s.shelf=true;toast('서쪽 서가 기록 복원 · 북쪽 잠금 하나 해제');}else toast(`올바른 책 ${s.input}/3`);}else{s.input=0;toast('연결되지 않는 기록 · 책 순서만 처음부터');}saveGame();closeDialog();}]]:[]);return;}if(d.bit){if(s.valves&d.bit){journeyDialog(d.name,'조절기를 고정했다. 이 기록은 저장된다.');return;}if(s.stage!==1)return;state.archiveChannel={id:d.id,bit:d.bit,x:d.x,z:d.z,start:clock.elapsedTime,hp:state.hp};toast('수로 조절 중 · 2.5초, 피격·1.8m 이탈·회피·공격 시 취소');return;}if(d.id==='seal'){journeyDialog(d.name,s.shelf&&s.valves===3?'두 기록이 문을 열었다. 북쪽 회랑의 엄폐물 뒤로 접근하자.':`잠금: 서가 ${s.shelf?'해제':'미해제'}, 수로 ${s.valves===3?'해제':'미해제'}. 둘 다 마치면 문이 열린다.`);return;}if(d.id==='core'){journeyDialog(d.name,s.stage===2?'빈 서가와 물길 끝에 사라지지 않은 이름들이 남아 있다. 이 원본을 회수하면 두 날개의 여정이 끝난다.':s.stage>=3?'원본은 이미 회수했다. 여울 기록대에 인계하자.':'회랑 경비가 남아 있다. 원본은 아직 봉인되어 있다.',s.stage===2?[['기록원 원본 회수',()=>{if(s.stage!==2||nearbyArchive()?.id!=='core')return;s.stage=3;saveGame();closeDialog();sfx('reward',.7);toast('원본 회수 · 대합실로 돌아가 여울 기록대에 인계');}]]:[]);}}
function spawnArchiveWave(){const s=state.archive;if(s.wave>=2||state.archiveFight)return;const defs=s.wave===0?[[254,-26,{...ENEMY,hp:110,dmg:17,speed:2,range:1.7,cd:1.8,label:'기록원 사수',archer:true}],[266,-26,{...ENEMY,hp:110,dmg:17,speed:2,range:1.7,cd:1.8,label:'기록원 사수',archer:true}]]:[[260,-24,{...WARRIOR,hp:460,dmg:24,guard:true,combo:false,aggro:24,label:'기록원 철갑 대장'}]];state.archiveFight=defs.map(([x,z,stats])=>{const e=state.spawn(state.protos.skel,{...stats,aggro:24,noElite:true,noRespawn:true,archiveGuard:true},x,z);e.expedition=e.trial=e.estuary=true;e.archerNext=clock.elapsedTime+2;if(!e.nameSprite){e.nameSprite=makeNameSprite(e.stats.label);e.nameSprite.position.y=2.8;e.root.add(e.nameSprite);}if(stats.archer){const bow=new THREE.Mesh(new THREE.TorusGeometry(.5,.07,5,16,Math.PI),new THREE.MeshLambertMaterial({color:0xc5a05f}));bow.position.set(-.5,1.4,.2);e.root.add(bow);}return e;});toast(s.wave===0?'회랑 사수 · 기둥 뒤로 엄폐하거나 사격 준비 끊기':'회랑 1차 저장 · 철갑 대장은 강공격으로 가드 파괴');}
function updateArchive(now){const s=state.archive,p=state.player.position,inside=inArchive();const open=s.shelf&&s.valves===3;state.archiveGate.mesh.visible=!open;for(const c of state.archiveGate.colliders){const i=colliders.indexOf(c);if(open&&i>=0)colliders.splice(i,1);else if(!open&&i<0)colliders.push(c);}for(const d of state.archiveProps||[]){const done=d.id==='clue'?s.read:['moon','wind','tide'].includes(d.id)?s.shelf:d.bit?!!(s.valves&d.bit):d.id==='core'?s.stage>=3:false;d.gem.visible=!done;}
if(state.dead||!inside){clearArchiveFight();for(const t of state.archiveStreams){t.at=0;t.next=0;t.mesh.material.color.setHex(0x70cadf);}return;}if(state.archiveFight?.every(e=>e.dead)){s.wave++;clearArchiveFight();if(s.wave===2){s.stage=2;toast('회랑의 침묵 · 북쪽 원본대에서 핵심 기록 회수');}else toast('첫 경비 정리 · 차수 저장, 다음 경비에게 접근');saveGame();}if(s.stage===1&&open&&s.wave<2&&!state.archiveFight&&p.z<-13&&!state.dialog&&!state.menuOpen)spawnArchiveWave();
for(const t of state.archiveStreams){t.label.visible=s.stage===1&&s.valves!==3;t.mesh.visible=true;if(s.stage!==1||s.valves===3){t.at=0;t.next=0;t.mesh.material.color.setHex(0x70cadf);continue;}if(state.dialog||state.menuOpen){t.at=0;t.next=now+2+t.i*2;t.mesh.material.color.setHex(0x70cadf);continue;}if(!t.next)t.next=now+2+t.i*2;if(!t.at&&now>=t.next){t.at=now+1.2;t.mesh.material.color.setHex(0xff6b5c);}t.mesh.material.opacity=t.at?.22+.18*Math.sin(now*10)**2:.2;if(t.at&&now>=t.at){if(p.x>=272&&p.x<=289&&Math.abs(p.z-t.z)<1.3){if(now<state.invUntil){t.dodges++;registerDodgeBlock(now);}else{t.hits++;state.hp=Math.max(0,state.hp-Math.max(1,28-GEAR_DEF[state.gear.armor]));state.archiveChannel=null;hitFlash(state.player);sfx('hurt',.7);if(!state.hp)playerDie('기록원 수로');}}t.at=0;t.next=now+5;t.mesh.material.color.setHex(0x70cadf);}}
const ch=state.archiveChannel;if(ch){if(state.dead||state.dialog||state.menuOpen||state.hp<ch.hp||Math.hypot(p.x-ch.x,p.z-ch.z)>1.8||now<state.dodgeUntil||now<state.attackUntil){state.archiveChannel=null;toast('수로 조절 중단 · 완료한 조절기는 보존');}else if(now-ch.start>=2.5){s.valves|=ch.bit;state.archiveChannel=null;saveGame();sfx('reward',.6);toast(s.valves===3?'동쪽 수로 기록 복원 · 북쪽 잠금 하나 해제':'수로 조절기 고정 · 반대쪽으로 이동');}}}

function courierStatus(){if(state.courier===3)return '북서 전령 기록 인계 완료';if(state.courier===2)return '전령길 안내판에 기록 인계';if(state.courier===1)return '길 안쪽 봉인함 회수';if(state.courierFight)return `전령길 궁수 ${(state.courierFight||[]).filter(e=>!e.dead).length}명 · 엄폐/사격 예고 끊기`;return state.quest.idx>=10?'북서 전령길 안내판에서 시작':'메인 의뢰 10개 완료 후 도전';}
function courierTarget(){if(state.courier===3||state.quest.idx<10)return null;const d=state.courier===1?COURIER_BOX:state.courierFight?COURIER_CENTER:COURIER_BOARD;return{x:d.x,z:d.z,label:state.courierFight?'전령길 엄폐 전투':d.name};}
function buildCourierSite(){
 const wood=new THREE.MeshLambertMaterial({color:0x82613e}),stone=new THREE.MeshLambertMaterial({color:0x7a8c99});
 state.courierProps=[COURIER_BOARD,COURIER_BOX].map(d=>{const root=new THREE.Group();root.position.set(d.x,0,d.z);const body=new THREE.Mesh(new THREE.BoxGeometry(d.id==='board'?1.5:1.1,d.id==='board'?.65:.7,.65),wood);body.position.y=d.id==='board'?1.3:.4;root.add(body);if(d.id==='board'){const post=new THREE.Mesh(new THREE.BoxGeometry(.15,1.6,.15),wood);post.position.y=.8;root.add(post)}else{const band=new THREE.Mesh(new THREE.BoxGeometry(1.15,.1,.7),stone);band.position.y=.65;root.add(band)}const gem=new THREE.Mesh(new THREE.OctahedronGeometry(.2),new THREE.MeshBasicMaterial({color:0xf2ce81}));gem.position.y=d.id==='board'?2.05:1.25;root.add(gem);const label=makeNameSprite(d.name);label.position.y=d.id==='board'?2.5:1.8;root.add(label);scene.add(root);return{...d,root,gem}});
 for(const [x,z] of [[-57,-20],[-51,-22],[-54,-26]]){const m=new THREE.Mesh(new THREE.BoxGeometry(1.7,1.7,1.7),stone);m.position.set(x,.85,z);scene.add(m);registerTreeFade(m,x,z);colliders.push({x,z,r:1.1,courierCover:true});const cap=new THREE.Mesh(new THREE.BoxGeometry(1.95,.2,1.95),wood);cap.position.set(x,1.8,z);scene.add(cap);registerTreeFade(cap,x,z);}
}
function nearbyCourier(){if(!state.ready||state.dead)return null;return(state.courierProps||[]).find(d=>Math.hypot(state.player.position.x-d.x,state.player.position.z-d.z)<2.2)||null;}
function cancelArcher(e,result='cancelled'){if(!e.stats.archer)return;if(result==='interrupted'&&(e.archerAt||(e.arrows||[]).some(a=>a.left>0)))e.archerInterrupts=(e.archerInterrupts||0)+1;e.archerAt=0;e.archerRecover=0;if(e.archerLines)for(const m of e.archerLines)m.visible=false;if(e.arrows)for(const a of e.arrows){a.left=0;a.root.visible=false;}e.archerResult=result;}
function clearCourierFight(){const es=state.courierFight;if(!es)return;for(const e of es){cancelArcher(e);e.dead=true;e.despawned=true;if(e.tele)scene.remove(e.tele);if(e.archerLines)for(const m of e.archerLines)scene.remove(m);if(e.arrows)for(const a of e.arrows)scene.remove(a.root);scene.remove(e.root);const i=state.enemies.indexOf(e);if(i>=0)state.enemies.splice(i,1)}state.courierFight=null;}
function startCourierFight(){if(state.quest.idx<10||state.courier||state.courierFight||!state.protos.skel)return;clearCartRun();clearEchoFight();clearObservatoryFight();clearBeaconFight();if(state.trial?.active)endTrial(false);
 state.courierFight=[[-61,-24],[-54,-32],[-46,-26]].map(([x,z])=>{const e=state.spawn(state.protos.skel,{...ENEMY,hp:70,dmg:10,speed:2.2,aggro:17,range:1.7,cd:1.7,label:'전령길 궁수',archer:true,noElite:true,noRespawn:true},x,z);e.expedition=true;e.trial=true;e.archerNext=clock.elapsedTime+1.8;const bow=new THREE.Group(),mat=new THREE.MeshLambertMaterial({color:0xb8864c});const curve=new THREE.Mesh(new THREE.TorusGeometry(.48,.055,5,18,Math.PI),mat);curve.rotation.z=Math.PI/2;bow.add(curve);bow.add(new THREE.Mesh(new THREE.BoxGeometry(.025,.96,.025),new THREE.MeshBasicMaterial({color:0xeee4c9})));bow.position.set(-.48,1.25,.15);e.root.add(bow);return e});state.tracked='courier';closeDialog();toast('궁수의 세 갈래 예고! 기둥 엄폐 또는 바람칼날로 준비 끊기');
}
function openCourier(d){state.dlgFocus=d.root.position;
 if(d.id==='box'){if(state.courier===1){journeyDialog('지켜 낸 봉인함','봉인함에는 다음 마을로 이어지는 대피 경로가 담겨 있다. 화살에 찢기지 않은 기록을 가져가자.',[['봉인함 회수',()=>{if(state.courier!==1||nearbyCourier()?.id!=='box')return;state.courier=2;saveGame();closeDialog();sfx('reward',.7);toast('봉인함 회수 · 전령길 안내판으로 돌아가 기록 인계');}]]);}else journeyDialog(d.name,state.courier>=2?'봉인함의 기록은 이미 회수했다.':'궁수의 사격이 닿는 길이다. 안내판에서 전령길을 확보한 뒤 회수하자.');return;}
 if(state.courier===3){journeyDialog('북서 전령 기록','엄폐물 사이의 길을 다시 열고 대피 경로를 돌려주었다.<br>기록: <b>바람길 전령</b> · 보상은 이미 받았다.<br>발걸음 인장 해금 · 장로 곁 스킬 창에서 장착.');return;}
 if(state.courier===2){journeyDialog('전령 기록 인계','봉인함의 경로를 마을에 전한다. 기록 <b>바람길 전령</b>과 한 번만 <b>180XP · 120G</b>를 받는다.',[['전령 기록 인계',()=>{if(state.courier!==2||nearbyCourier()?.id!=='board')return;state.courier=3;state.gold+=120;gainXp(180);if(state.tracked==='courier')state.tracked='auto';saveGame();closeDialog();sfx('reward',1);toast('바람길 전령 · 180XP · 120G');}]]);return;}
 const text='기록을 나르던 전령이 북서 길에서 봉인함을 남기고 돌아왔다. 세 궁수가 길을 막고 있다.<br><br><b>메인 의뢰 10개 완료 후 시작</b><br>궁수는 마지막으로 본 방향에 <b>세 갈래 붉은 사격 예고</b>를 남긴 뒤 화살을 쏜다. 옆으로 피하거나 <b>기둥 뒤</b>에 숨자. 화살과 바람칼날 모두 기둥에 막힌다.<br>바람칼날·근접 적중으로 사격 준비를 끊을 수 있다. 발사 후 잠깐의 빈틈에 접근하자. 가까이 붙으면 근접 공격도 한다.<br><br>궁수 3명을 처치한 뒤 안쪽 봉인함을 회수해 이 안내판에 인계한다. 궁수별 전리품은 없다. <b>도전료 없음</b>. 사망·중앙에서20m 이탈·재접속은 이번 전투만 초기화하며 기존 진행은 보존한다. 전투 승리와 봉인함 회수는 각각 저장된다.<br>최종 1회180XP·120G.';
 journeyDialog('북서 전령길',courierStatus()+'<br><br>'+text,state.quest.idx>=10&&!state.courier&&!state.courierFight?[["전령길 확보 시작",()=>{if(nearbyCourier()?.id==='board')startCourierFight();}]]:[]);
}
function updateCourier(){const es=state.courierFight;if(!es)return;if(state.dead||Math.hypot(state.player.position.x+54,state.player.position.z+23)>20){clearCourierFight();toast('전령길 전투 중단 · 안내판에서 무료 재도전');return;}if(es.every(e=>e.dead)){clearCourierFight();state.courier=1;saveGame();sfx('reward',.8);toast('사격이 멎었다! 안쪽 전령의 봉인함을 회수하자.');}}
let archerResources=null;
function makeArcherShots(e){if(e.arrows)return;if(!archerResources)archerResources={line:new THREE.PlaneGeometry(.32,14),shaft:new THREE.BoxGeometry(.065,.065,1.1),tip:new THREE.ConeGeometry(.12,.3,5),lineMat:new THREE.MeshBasicMaterial({color:0xff735c,transparent:true,opacity:.4,depthWrite:false,side:THREE.DoubleSide}),arrowMat:new THREE.MeshBasicMaterial({color:0xffe8b2})};const r=archerResources;e.archerLines=[];e.arrows=[];for(let i=0;i<3;i++){const line=new THREE.Mesh(r.line,r.lineMat);line.rotation.x=-Math.PI/2;line.visible=false;scene.add(line);e.archerLines.push(line);const root=new THREE.Group(),shaft=new THREE.Mesh(r.shaft,r.arrowMat),tip=new THREE.Mesh(r.tip,r.arrowMat);tip.rotation.x=Math.PI/2;tip.position.z=.65;root.add(shaft,tip);root.visible=false;scene.add(root);e.arrows.push({root,left:0,dir:new THREE.Vector3()});}}
function archerAimLength(from,dir){let length=14;for(const c of colliders){const dx=c.x-from.x,dz=c.z-from.z,t=dx*dir.x+dz*dir.z,r=c.r+.15,perp=dx*dx+dz*dz-t*t;if(t>0&&perp<r*r)length=Math.min(length,Math.max(0,t-Math.sqrt(r*r-perp)));}return length;}
function updateArcher(e,dt,now){if(!e.stats.archer)return false;
 if(state.dead||state.dialog||state.menuOpen||e.dead){cancelArcher(e);e.archerNext=now+1.6;e.anim.update(dt);return true;}
 if(now<(e.hitUntil||0)||now<(e.staggerUntil||0)){cancelArcher(e,'interrupted');e.archerNext=now+1.6;e.anim.update(dt);return true;}
 makeArcherShots(e);const p=state.player.position;let flying=false;
 for(const a of e.arrows){if(a.left<=0)continue;flying=true;const from=a.root.position.clone(),step=Math.min(a.left,10*dt),to=from.clone().addScaledVector(a.dir,step);if(colliders.some(c=>segmentDistance(c,from,to)<c.r+.15)){a.left=0;a.root.visible=false;e.archerWalls=(e.archerWalls||0)+1;e.archerResult='wall';}else if(segmentDistance(p,from,to)<.65){a.left=0;a.root.visible=false;if(!e.archerBatchHit){e.archerBatchHit=true;if(now<state.invUntil){registerDodgeBlock(now);e.archerDodges=(e.archerDodges||0)+1;e.archerResult='dodge';}else if(now>=(state.arrowSafeUntil||0)){state.arrowSafeUntil=now+.35;state.hp=Math.max(0,state.hp-Math.max(1,e.stats.dmg-GEAR_DEF[state.gear.armor]));hitFlash(state.player);sfx('hurt',.7);e.archerHits=(e.archerHits||0)+1;e.archerResult='hit';if(state.hp<=0)playerDie(e.stats.label);}}}else{a.root.position.copy(to);a.left-=step;if(a.left<=0){a.root.visible=false;e.archerResult='miss';}}}
 if(e.archerAt){e.mode='archerAim';if(now>=e.archerAt){e.archerAt=0;for(const l of e.archerLines)l.visible=false;for(let i=0;i<3;i++){const a=e.arrows[i];a.root.position.copy(e.archerFrom);a.root.position.y=.8;a.dir.copy(e.archerDirs[i]);a.root.rotation.y=Math.atan2(a.dir.x,a.dir.z);a.root.visible=true;a.left=14;}e.archerBatchHit=false;e.archerRecover=now+2;e.archerNext=now+5;e.archerFired=(e.archerFired||0)+1;e.archerResult='flying';e.anim.playOnce('attack');}e.anim.update(dt);return true;}
 if(flying||now<(e.archerRecover||0)){e.mode='archerRecover';e.anim.update(dt);return true;}
 const dir=p.clone().sub(e.root.position);dir.y=0;const d=dir.length();if(d<2.4)return false;e.anim.play('idle');e.mode='archerWait';if(d<17&&now>=(e.archerNext||0)){dir.normalize();e.root.rotation.y=Math.atan2(dir.x,dir.z);e.archerFrom=e.root.position.clone();e.archerDirs=[-.25,0,.25].map(a=>dir.clone().applyAxisAngle(new THREE.Vector3(0,1,0),a));e.archerAt=now+1.2;e.archerResult='aim';e.pendingHit=0;e.combo2=0;if(e.tele)e.tele.visible=false;for(let i=0;i<3;i++){const l=e.archerLines[i],v=e.archerDirs[i],length=archerAimLength(e.archerFrom,v);l.scale.y=length/14;l.position.copy(e.archerFrom).addScaledVector(v,length/2);l.position.y=.075;l.rotation.z=Math.atan2(v.x,v.z);l.visible=length>.05;}}e.anim.update(dt);return true;
}

// ---------- 관측 기록 운반: 수레를 노리는 습격자 호위 ----------
const CART_ROUTE=[{x:48,z:-7,name:'관측소 앞 출발지'},{x:34,z:1,name:'들판 중간 쉼터'},{x:18,z:5,name:'마을 앞 인계소'}];
function cartPoint(){return CART_ROUTE[state.cartStage===1?1:state.cartStage>=2?2:0]}
function cartStatus(){const f=state.cartRun;if(state.cartStage===3)return '관측 기록 인계 완료';if(state.cartStage===2)return '마을 앞 인계소에서 기록 인계';if(!f)return state.observatory===4?'수레에서 현재 구간 출발':'관측소 기록 회수 후 시작';return f.raiders.some(e=>!e.dead)?`수레 내구도 ${f.hp}/100 · 수레를 노리는 습격자 먼저 저지`:`수레 내구도 ${f.hp}/100 · 5m 안에서 함께 이동`;}
function cartTarget(){if(state.observatory!==4||state.cartStage===3)return null;const p=state.cartModel?.root.position||cartPoint();return{x:p.x,z:p.z,label:state.cartStage===2?'기록 인계':state.cartRun?'운반 수레 호위':'기록 운반 수레'};}
function buildCart(){const root=new THREE.Group(),wood=new THREE.MeshLambertMaterial({color:0x9e713e});const deck=new THREE.Mesh(new THREE.BoxGeometry(1.5,.3,1.7),wood);deck.position.y=.65;root.add(deck);for(const x of[-.9,.9])for(const z of[-.55,.55]){const w=new THREE.Mesh(new THREE.CylinderGeometry(.4,.4,.18,12),new THREE.MeshLambertMaterial({color:0x454c5b}));w.rotation.z=Math.PI/2;w.position.set(x,.4,z);root.add(w)}for(const x of[-.9,.9]){const b=new THREE.Mesh(new THREE.BoxGeometry(.12,.12,1.8),wood);b.position.set(x,.7,1.4);root.add(b)}for(let i=0;i<2;i++){const box=new THREE.Mesh(new THREE.BoxGeometry(.85,.55,.6),new THREE.MeshLambertMaterial({color:i?0x3c747f:0x6d8394}));box.position.set(0,1+i*.55,0);root.add(box)}const label=makeNameSprite('관측 기록 운반 수레');label.position.y=2.5;root.add(label);const beam=new THREE.Mesh(new THREE.CylinderGeometry(.1,.1,3.5,6),new THREE.MeshBasicMaterial({color:0x79e6e4,transparent:true,opacity:.35}));beam.position.y=1.7;root.add(beam);scene.add(root);state.cartModel={root,beam};root.position.set(cartPoint().x,0,cartPoint().z);}
function nearbyCart(){return state.ready&&!state.dead&&state.cartModel&&Math.hypot(state.player.position.x-state.cartModel.root.position.x,state.player.position.z-state.cartModel.root.position.z)<2.8;}
function clearCartRun(){const f=state.cartRun;if(!f)return;for(const e of f.raiders){e.dead=true;e.despawned=true;e.mode='dead';if(e.tele)scene.remove(e.tele);scene.remove(e.root);const i=state.enemies.indexOf(e);if(i>=0)state.enemies.splice(i,1)}state.cartRun=null;const p=cartPoint();state.cartModel.root.position.set(p.x,0,p.z);}
function startCartRun(){if(state.observatory!==4||state.cartStage>=2||state.cartRun)return;const p=cartPoint();state.cartModel.root.position.set(p.x,0,p.z);state.cartRun={hp:100,raiders:[],wave:0,moved:0,total:Math.hypot(CART_ROUTE[(state.cartStage||0)+1].x-p.x,CART_ROUTE[(state.cartStage||0)+1].z-p.z)};state.tracked='cart';closeDialog();toast('수레 5m 안에서 함께 이동 · 습격자는 수레를 공격한다!');}
function openCart(){const ready=state.observatory===4,f=state.cartRun;state.dlgFocus=state.cartModel.root.position;
 if(state.cartStage===3){journeyDialog('안전하게 돌아온 기록','관측소의 바람 기록을 마을 앞 인계소에 전했다. 기록은 다음 여행자의 안전한 길을 찾는 데 쓰일 것이다.<br>기록: <b>기록 운반자</b> · 보상은 이미 받았다.<br>수호 인장 해금 · 장로 곁 스킬 창에서 장착.');return;}
 if(state.cartStage===2){journeyDialog('기록 인계소','봉인된 관측 기록이 모두 무사하다. 한 번만 <b>150XP · 100G</b>와 기록 운반자 기록을 받는다.',[['관측 기록 인계',()=>{if(state.cartStage!==2||!nearbyCart())return;state.cartStage=3;state.gold+=100;gainXp(150);if(state.tracked==='cart')state.tracked='auto';saveGame();closeDialog();sfx('reward',1);toast('기록 운반자 · 150XP · 100G');}]]);return;}
 const text='<b>관측소 기록 회수 후 시작</b><br>수레를 마을 앞 인계소(18, 5)까지 호위한다. 수레의 <b>5m 안</b>에서만 움직이며 멀어지면 기다린다.<br>습격자는 플레이어가 아니라 <b>수레를 공격</b>한다. 나타나면 공격·강공격·스킬로 먼저 막자. 습격자가 남아 있으면 수레는 멈춘다.<br><br>내구도100 · 붕괴/플레이어 사망/수레20m 이탈/재접속 시 <b>현재 구간만 재시도</b>. 중간 쉼터(34, 1) 도착은 저장되고 다음 구간은 내구도100으로 출발한다.<br>물약은 수레를 수리하지 않는다. 도전료는 없고 재시도 때 기존 진행·골드·스킬을 잃지 않는다. 습격자 전리품은 없으며 최종 보상은1회150XP·100G.';
 journeyDialog('관측 기록 운반',cartStatus()+'<br><br>'+text,ready&&!f?[[state.cartStage===1?'쉼터에서 다음 구간 출발':'기록 운반 출발',()=>{if(nearbyCart())startCartRun()}]]:[]);
}
function updateCartRaider(e,dt,now){if(!e.cartRaider)return false;const f=state.cartRun;if(!f||e.dead||state.dead||state.dialog||state.menuOpen){e.cartHit=0;e.anim.update(dt);return true;}if(now<(e.hitUntil||0)||now<(e.staggerUntil||0)){e.cartHit=0;if(e.tele)e.tele.visible=false;e.anim.update(dt);return true;}const to=state.cartModel.root.position.clone().sub(e.root.position);to.y=0;const d=to.length();e.root.rotation.y=Math.atan2(to.x,to.z);if(e.cartHit){if(now>=e.cartHit){e.cartHit=0;if(e.tele)e.tele.visible=false;if(d<2){f.hp=Math.max(0,f.hp-8);hitFlash(state.cartModel.root);sfx('hurt',.5);toast(`수레 피격! 내구도 ${f.hp}/100`);}}e.anim.update(dt);return true;}if(d>1.5){e.root.position.addScaledVector(to.normalize(),e.stats.speed*dt);e.anim.play('running','walking');}else if(now>=(e.cartAttack||0)){e.cartAttack=now+2.4;e.cartHit=now+.8;showTelegraph(e,.8);e.anim.playOnce('attack');}e.anim.update(dt);return true;}
function updateCart(dt,now){if(!state.cartModel)return;state.cartModel.beam.visible=state.cartStage!==3;const f=state.cartRun;if(!f)return;const pos=state.cartModel.root.position;
 if(state.dead||f.hp<=0||state.player.position.distanceTo(pos)>20){clearCartRun();toast(f.hp<=0?'수레가 부서졌다. 저장된 출발지에서 재도전하자.':'기록 운반 중단 · 현재 구간 출발지에서 재도전');return;}
 if(state.dialog||state.menuOpen)return;
 const stage=state.cartStage||0,target=CART_ROUTE[stage+1],alive=f.raiders.some(e=>!e.dead);
 if(!alive&&f.wave<2&&f.moved/f.total>=(f.wave?.62:.22)){f.wave++;const count=stage===1?2:1;for(let i=0;i<count;i++){const e=state.spawn(state.protos.skel,{...ENEMY,hp:stage===1?44:36,dmg:0,speed:3.6,label:'기록 약탈자',noElite:true,noRespawn:true},pos.x+(i?5:-5),pos.z+4);e.expedition=true;e.trial=true;e.cartRaider=true;e.cartAttack=now+2;if(!e.nameSprite){e.nameSprite=makeNameSprite('기록 약탈자');e.nameSprite.position.y=2.3;e.root.add(e.nameSprite)}f.raiders.push(e)}toast('기록 약탈자가 수레를 노린다! 먼저 막자.');return;}
 if(alive||state.player.position.distanceTo(pos)>5)return;
 const dx=target.x-pos.x,dz=target.z-pos.z,d=Math.hypot(dx,dz),step=Math.min(d,2.2*dt);if(d>0){pos.x+=dx/d*step;pos.z+=dz/d*step;}f.moved+=step;state.cartModel.root.rotation.y=Math.atan2(dx,dz);
 if(d<.15){clearCartRun();state.cartStage=stage+1;pos.set(target.x,0,target.z);state.tracked='cart';saveGame();sfx('reward',.7);toast(stage===0?'중간 쉼터 도착! 기록 저장 · 수레에서 다음 구간 출발':'마을 앞 인계소 도착! 수레에서 E/터치로 기록을 인계하자.');}
}

// ---------- 유적 잔향 봉인: 후반 2단계 봉인석 전투 ----------
const ECHO_CENTER={x:-8,z:-58};
const ECHO_NODES=[{x:-15,z:-58,name:'서쪽 봉인석'},{x:-1,z:-58,name:'동쪽 봉인석'},{x:-8,z:-65,name:'북쪽 봉인석'}];
const ECHO_BOARD={x:-8,z:-48,name:'잔향 원정 비문',id:'board'};
function echoOrder(){return state.echoFight?.phase===1?[2,1,0]:[0,1,2]}
function echoStatus(){const f=state.echoFight;if(state.echo===2)return '잔향 봉인 완료';if(state.echo===1)return '비문에서 봉인 기록 받기';if(!f)return state.quest.idx>=20?'비문에서 후반 원정 시작':'메인 의뢰 20개 완료 후 도전';return f.shield?`${f.phase+1}단계 · ${ECHO_NODES[echoOrder()[f.sequence]].name} · 봉인 ${f.sequence}/3`:`${f.phase+1}단계 · 보호막 해제, 잔향 감시자에게 반격`;}
function echoTarget(){const f=state.echoFight;if(f){const d=f.shield?ECHO_NODES[echoOrder()[f.sequence]]:{x:f.boss.root.position.x,z:f.boss.root.position.z,name:'잔향 감시자'};return{x:d.x,z:d.z,label:d.name};}return state.echo!==2&&state.quest.idx>=20?{...ECHO_BOARD,label:state.echo===1?'잔향 봉인 기록':ECHO_BOARD.name}:null;}
function buildEchoSite(){
 const floor=new THREE.Mesh(new THREE.RingGeometry(8.5,8.85,64),new THREE.MeshBasicMaterial({color:0x8794b5,side:THREE.DoubleSide,transparent:true,opacity:.7}));floor.rotation.x=-Math.PI/2;floor.position.set(-8,.045,-58);scene.add(floor);
 state.echoProps=[ECHO_BOARD,...ECHO_NODES.map((d,i)=>({...d,id:i}))].map(d=>{const root=new THREE.Group();root.position.set(d.x,0,d.z);const stone=new THREE.Mesh(new THREE.BoxGeometry(d.id==='board'?1.8:.65,d.id==='board'?.7:1.5,.65),new THREE.MeshLambertMaterial({color:0x687084}));stone.position.y=d.id==='board'?.4:.75;root.add(stone);const gem=new THREE.Mesh(new THREE.OctahedronGeometry(.3),new THREE.MeshBasicMaterial({color:0x8c94a6}));gem.position.y=2;root.add(gem);const label=makeNameSprite(d.name);label.position.y=2.6;root.add(label);scene.add(root);return{...d,root,gem}});
}
function nearbyEcho(){if(!state.ready||state.dead)return null;return(state.echoProps||[]).find(d=>Math.hypot(state.player.position.x-d.x,state.player.position.z-d.z)<2)||null;}
function clearEchoFight(){const f=state.echoFight;if(!f)return;const e=f.boss;cancelWardenPulse(e);cancelFrogSpit(e);cancelStormCharge(e);if(e.tele)scene.remove(e.tele);if(e.pulseRing)scene.remove(e.pulseRing);if(e.pulseDisc)scene.remove(e.pulseDisc);scene.remove(e.root);scene.remove(f.aura);const i=state.enemies.indexOf(e);if(i>=0)state.enemies.splice(i,1);state.echoFight=null;}
function startEchoFight(){if(state.echo||state.quest.idx<20||state.echoFight||!state.protos.skel)return;clearBeaconFight();if(state.trial?.active)endTrial(false);clearObservatoryFight();const boss=state.spawn(state.protos.skel,{...WARDEN,hp:360,dmg:22,aggro:22,speed:2.7,label:'잔향 감시자',gold:0,echoBoss:true},-8,-58);boss.expedition=true;boss.trial=true;boss.root.scale.multiplyScalar(1.2);if(!boss.nameSprite){boss.nameSprite=makeNameSprite('잔향 감시자');boss.nameSprite.position.y=3.2;boss.root.add(boss.nameSprite)}const aura=new THREE.Mesh(new THREE.SphereGeometry(1.7,16,12),new THREE.MeshBasicMaterial({color:0x9c7fff,transparent:true,opacity:.22,depthWrite:false,wireframe:true}));scene.add(aura);state.echoFight={boss,aura,phase:0,sequence:0,shield:true};state.tracked='echo';closeDialog();toast('서쪽 → 동쪽 → 북쪽 봉인석을 E/터치로 해제!');}
function openEcho(d){
 const f=state.echoFight;
 if(d.id!=='board'){
  if(!f){journeyDialog(d.name,'북쪽 언덕의 잔향 원정 비문(-8, -48)에서 규칙을 읽고 시작하자.');return;}
  if(!f.shield){toast('보호막이 풀렸다. 감시자에게 반격하자.');return;}
  const expected=echoOrder()[f.sequence];if(d.id!==expected){f.sequence=0;toast('순서가 어긋났다. '+ECHO_NODES[echoOrder()[0]].name+'부터 다시.');return;}
  f.sequence++;skillFx(d.root.position,0x75f1de,1.4,'cast');sfx('reward',.5);if(f.sequence===3){f.shield=false;f.aura.visible=false;toast('보호막 해제! 감시자에게 반격하자.');}else toast(echoStatus());return;
 }
 state.dlgFocus=d.root.position;
 if(state.echo===2){journeyDialog('잔향 봉인 기록','서쪽·동쪽·북쪽 봉인석에 얽힌 잔향을 풀었다. 힘으로만 깨뜨릴 수 없는 보호막도 길을 읽으면 풀린다.<br><br>기록: <b>잔향 봉인자</b> · 최종 보상은 이미 받았다. 반복 보상은 없다.');return;}
 if(state.echo===1){journeyDialog('고요해진 북쪽 언덕','마지막 잔향이 사라졌다. 비문에 이번 봉인의 순서를 남기자.<br>한 번만 <b>200XP · 200G</b>와 <b>잔향 봉인자 기록</b>을 얻는다.',[['봉인 기록 받기',()=>{if(state.echo!==1||nearbyEcho()?.id!=='board')return;state.echo=2;state.gold+=200;gainXp(200);if(state.tracked==='echo')state.tracked='auto';saveGame();closeDialog();sfx('reward',1);toast('잔향 봉인자 · 200XP · 200G');}]]);return;}
 const rule='<b>후반 원정 · 메인 의뢰 20개 완료 필요</b><br>범위 안에서 감시자의 붉은 지면파를 피하면서 봉인석에 접근해 <b>E 또는 화면 버튼</b>을 누른다.<br><br><b>1단계: 서쪽 → 동쪽 → 북쪽</b><br>세 봉인을 차례로 해제하면 보라색 보호막이 풀리고 공격이 통한다. 잘못된 순서는 현재 순서만 초기화된다.<br><br>체력이 절반이 되면 보호막이 다시 생긴다.<br><b>2단계: 북쪽 → 동쪽 → 서쪽</b><br>다시 풀고 감시자를 쓰러뜨리자. 보호막은 강공격·원거리로도 부술 수 없다.<br><br>사망·현장18m 이탈·재접속은 이 전투만 처음부터. 기존 진행과 재화는 유지된다. 쓰러뜨린 기록은 저장되며 비문에서 1회 200XP·200G를 받는다. 도전료는 없다.';
 journeyDialog('유적 잔향 봉인',f?echoStatus()+'<br><br>'+rule:rule,state.quest.idx>=20&&!f?[[ '잔향 원정 시작',()=>{if(nearbyEcho()?.id==='board')startEchoFight()}]]:[]);
}
function echoDamage(e,dmg){const f=state.echoFight;if(!e.stats.echoBoss||!f||f.boss!==e)return false;if(f.shield){if(clock.elapsedTime>(f.blockToast||0)){toast('봉인석 순서를 풀어 보호막을 해제하자.');f.blockToast=clock.elapsedTime+2;}skillFx(e.root.position,0xbfa7ff,.8,'hit');return true;}
 if(f.phase===0&&e.hp-dmg<=180){e.hp=180;f.phase=1;f.shield=true;f.sequence=0;f.aura.visible=true;cancelWardenPulse(e);e.pendingHit=0;e.pulseNext=clock.elapsedTime+1.5;toast('보호막 재생! 북쪽 → 동쪽 → 서쪽으로 역순 해제');return true;}return false;}
function updateEcho(){const f=state.echoFight;for(const d of state.echoProps||[]){let color=state.echo===2?0xd8c47c:0x8c94a6;if(f&&d.id!=='board'){const order=echoOrder(),idx=order.indexOf(d.id);color=!f.shield||idx<f.sequence?0x68dfce:idx===f.sequence?0xffd363:0x9c7fff;}d.gem.material.color.setHex(color);}
 if(!f)return;if(state.dead||Math.hypot(state.player.position.x+8,state.player.position.z+58)>18){clearEchoFight();toast('잔향 원정 초기화 · 비문에서 다시 시작할 수 있다.');return;}
 f.aura.position.copy(f.boss.root.position);f.aura.position.y=1.6;
 if(f.boss.dead){clearEchoFight();state.echo=1;state.tracked='echo';saveGame();toast('잔향을 봉인했다! 비문에서 기록을 받자.');}
}

// ---------- 끊어진 순례길: 지역을 잇는 독립 탐험 이야기 ----------
const JOURNEY_SITES = [
  {step:1,x:-32,z:18,name:'숲의 낡은 배낭',hint:'마을 서쪽, 바람꽃 숲으로 가는 길 가장자리의 낡은 배낭을 찾자.',
   title:'첫째 날 - 빈 배낭',story:'낡은 천 사이에 작은 편지가 남아 있다.<br>"약초를 팔아 돌아가려던 날, 늪의 다리가 무너졌다. 짐을 버리면 빨리 갈 수 있었겠지만, 건너편에는 아이가 기다리고 있었다. 나는 돌아서서 얕은 여울을 찾았다."<br>배낭에는 돈도 약초도 없다. 대신 누군가를 업을 때 쓰는 넓은 끈이 매여 있다.',
   next:'다음 쪽지에는 <b>독 늪 동쪽 가장자리</b>의 마른 징검돌을 가리키는 그림이 있다.'},
  {step:2,x:-17,z:44,name:'여울의 낡은 끈',hint:'독 늪의 동쪽 가장자리로 돌아가 마른 여울의 끈을 살피자. 독 웅덩이 한가운데로 들어갈 필요는 없다.',
   title:'둘째 날 - 돌아간 길',story:'진흙 위에 같은 모양의 발자국이 여러 번 겹쳤다. 물가의 끈은 작은 손이 잡기 좋게 매듭지어져 있다.<br>"한 사람을 건너게 하면 끝일 줄 알았다. 그런데 뒤에서 다른 이들이 왔다. 마지막 사람이 건널 때까지 나는 건너편으로 가지 못했다. 해는 졌지만 아무도 길을 잃지 않았다."<br>늦어진 여행은 실패가 아니었다. 누군가가 안전하게 돌아갈 수 있는 길이 되었다.',
   next:'젖지 않은 종이에는 <b>벌집 숲 서쪽 입구</b>의 오래된 이정표가 그려져 있다.'},
  {step:3,x:43,z:29,name:'순례자의 이정표',hint:'벌집 숲 서쪽 입구의 이정표로 가자. 벌집의 여왕을 쓰러뜨릴 필요는 없다.',
   title:'셋째 날 - 남겨진 이름',story:'이정표 뒤에 짧은 글이 새겨져 있다.<br>"이름을 남겨 달라는 부탁을 받았다. 하지만 내 이름보다 여울의 위치를 적는 편이 낫겠다. 나를 기억하지 않아도 괜찮다. 다음 여행자가 돌아갈 길을 알면 된다."<br>아래에는 마을을 향한 화살표와 삐뚤빼뚤한 작은 글씨가 있다.<br>"덕분에 집에 왔어요."',
   next:'세 기록을 연결했다. <b>마을 장로</b>에게 돌아가 순례자의 이야기를 전하자.'},
];
function journeyClearing(x,z) { if(Math.hypot(x+54,z+23)<14)return true; if((x>31&&x<51&&Math.abs(z-(-7+(48-x)*8/14))<3.2)||(x>15&&x<37&&Math.abs(z-(1+(34-x)/4))<3.2))return true; if(Math.hypot(x+8,z+58)<12)return true; if(x>48&&x<73&&z>-13&&z<16)return true; return [[10,10],[0,28],[-20,18],[18,40],[8,60],[-32,18],[-17,44],[43,29]].some(([a,b])=>Math.hypot(x-a,z-b)<8); }
function buildJourneySites() {
  state.journeySites=JOURNEY_SITES.map(d=>{
    const root=new THREE.Group();root.position.set(d.x,0,d.z);
    const post=new THREE.Mesh(new THREE.BoxGeometry(0.18,1.3,0.18),new THREE.MeshLambertMaterial({color:0x80603d}));post.position.y=.65;root.add(post);
    const board=new THREE.Mesh(new THREE.BoxGeometry(1.2,.55,.16),new THREE.MeshLambertMaterial({color:0xd9bb82}));board.position.y=1.1;root.add(board);
    if(d.step===1){const bag=new THREE.Mesh(new THREE.BoxGeometry(.65,.65,.4),new THREE.MeshLambertMaterial({color:0x846342}));bag.position.set(.65,.33,.2);root.add(bag);const strap=new THREE.Mesh(new THREE.TorusGeometry(.25,.035,6,20),new THREE.MeshBasicMaterial({color:0xd9b178}));strap.position.set(.65,.65,.2);root.add(strap);}
    if(d.step===2){const rope=new THREE.Mesh(new THREE.TorusGeometry(.5,.055,6,24),new THREE.MeshLambertMaterial({color:0xc8a767}));rope.rotation.x=-Math.PI/2;rope.position.set(.8,.07,.3);root.add(rope);}
    const gem=new THREE.Mesh(new THREE.OctahedronGeometry(.2),new THREE.MeshBasicMaterial({color:0x8be1e5}));gem.position.y=1.85;root.add(gem);
    const label=makeNameSprite(d.name);label.position.y=2.35;root.add(label);scene.add(root);return{...d,root};
  });
}
function nearbyJourneySite() {
  if(!state.ready || state.dead)return null;
  return(state.journeySites||[]).find(d=>Math.hypot(state.player.position.x-d.x,state.player.position.z-d.z)<=2.2)||null;
}
function journeyTarget(){
  if(!state.journey || state.journey>=5)return null;
  if(state.journey===4)return state.npc?{x:state.npc.pos.x,z:state.npc.pos.z,label:'순례길 이야기 전하기'}:null;
  const d=JOURNEY_SITES[state.journey-1];return{x:d.x,z:d.z,label:d.name};
}
function journeyDialog(title,html,buttons=[]) {
  state.dialog=true;dlgEl().classList.add('journey-dialog');document.getElementById('dlg-name').textContent=title;
  document.getElementById('dlg-text').innerHTML=html;document.getElementById('dlg-list').innerHTML='';
  const btns=document.getElementById('dlg-btns');btns.innerHTML='';
  for(const[label,fn]of[...buttons,['닫기',closeDialog]]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{if(!state.dialog||state.dead)return;b.disabled=true;fn()};btns.appendChild(b)}
  dlgEl().style.display='block';document.getElementById('dlgback').style.display='block';
}
function openJourneySite(d){
  state.dlgFocus=d.root.position;
  if(!state.journey || state.journey<d.step){journeyDialog(d.name,'아직 이 흔적을 해석할 단서가 없다.<br>마을 장로의 <b>여행 수첩</b>에서 끊어진 순례길을 시작하고 이전 기록을 먼저 찾아보자.');return;}
  const fresh=state.journey===d.step;
  journeyDialog(d.title,d.story+'<br><br>'+d.next,fresh?[[ '수첩에 기록하기',()=>{
    if(state.journey!==d.step || nearbyJourneySite()?.step!==d.step)return;
    state.journey=d.step+1;state.tracked='journey';saveGame();closeDialog();toast(`순례길 기록 ${d.step}/3 · 수첩(J)에서 다시 읽기`);
  }]]:[]);
}
function openJourneyJournal(){
  if(!state.ready||state.dead)return;
  const nearElder=state.npc && state.player.position.distanceTo(state.npc.pos)<=2.6;
  const step=state.journey||0;let html='';const buttons=[];
  if(!step){
    html='장로가 펼친 낡은 지도에는 세 지역을 잇는 선이 끊겨 있다.<br>"이 길을 만든 사람은 영웅도 왕도 아니었네. 이름 없는 여행자였지. 숲의 배낭과 늪의 여울, 벌집 숲의 이정표에 그의 기록이 남아 있다더군. 그가 왜 돌아오지 않았는지 알아봐 주겠나?"<br><br>전투 의뢰와 별도로 진행되는 탐험 이야기다. 기록은 직접 읽어야 남으며 수첩에서 언제든 다시 볼 수 있다.';
    if(nearElder)buttons.push(['순례길을 찾아본다',()=>{if(state.journey || !state.npc || state.player.position.distanceTo(state.npc.pos)>2.6)return;state.journey=1;state.tracked='journey';saveGame();closeDialog();toast('탐험 시작: 끊어진 순례길')}]);
    else html+='<br><br><b>마을 장로 곁에서 시작할 수 있다.</b>';
  }else if(step<4){html=`기록 ${step-1}/3<br><b>다음 단서</b>: ${JOURNEY_SITES[step-1].hint}`;}
  else if(step===4){
    html='세 기록을 모았다. 순례자가 사라진 이유를 알게 되었다. 그는 혼자 빨리 돌아가는 대신, 모두가 돌아올 수 있는 길을 남겼다.<br><br>'+(nearElder?'장로가 고개를 끄덕인다.<br>"그래서 우리 마을에는 그의 무덤이 없었군. 그 사람이 남긴 것은 길이었어. 자네는 이 기록을 어떻게 남기겠나?"':'마을 장로에게 돌아가 이야기를 전하자.');
    if(nearElder)for(const[id,label]of[['remember','이름 없는 여행자의 기억으로 남긴다'],['share','다음 여행자를 위한 길 안내로 남긴다']])buttons.push([label,()=>{if(state.journey!==4 || !state.npc || state.player.position.distanceTo(state.npc.pos)>2.6)return;state.journey=5;state.journeyEnding=id;if(state.tracked==='journey')state.tracked='auto';saveGame();openJourneyJournal();sfx('reward',.7)}]);
  }else html='장로와 함께 끊어진 순례길을 지도에 다시 이었다.<br>'+ (state.journeyEnding==='share'?'기록은 다음 여행자를 위한 길 안내가 되었다. 이름을 몰라도 누군가가 남긴 배려는 길 위에 남는다.':'기록은 이름 없는 여행자를 기억하는 이야기가 되었다. 가장 늦게 돌아온 사람도 누군가에게는 길을 밝혀 준 사람이었다.')+'<br><br><b>탐험 이야기 완결</b> · 기록은 아래에서 다시 읽을 수 있다. 이 선택은 이야기의 기록 방식만 바꾸며 능력치나 전투 보상을 바꾸지 않는다.';
  for(let i=0;i<Math.min(3,Math.max(0,step-1));i++)html+=`<details style="margin-top:10px;border-top:1px solid #445;padding-top:6px"><summary>${JOURNEY_SITES[i].title}</summary>${JOURNEY_SITES[i].story}</details>`;
  if(step>0&&step<5)buttons.unshift([state.tracked==='journey'?'탐험 추적 끄기':'탐험 목표 추적',()=>{state.tracked=state.tracked==='journey'?'auto':'journey';saveGame();closeDialog()}]);
  journeyDialog('여행 수첩 · 끊어진 순례길',html,buttons);
}

// ---------- 유적의 세 문양: 단서 해독으로 여는 왕복 탐험 지름길 ----------
const SEALS = [
  { id: 'sun', name: '해 문양', x: -30, z: -36, color: 0xffc85b },
  { id: 'hill', name: '언덕 문양', x: -34, z: -35, color: 0x9acb70 },
  { id: 'wind', name: '바람 문양', x: -30, z: -31, color: 0x83dcff },
  { id: 'clue', name: '바람길 비문', x: -34, z: -30, color: 0xe6d6b0 },
  { id: 'ruinsGate', name: '유적 바람길', x: -30, z: -27, color: 0x83dcff },
  { id: 'villageGate', name: '마을 바람길', x: -8, z: -4, color: 0x83dcff },
];
function buildSeals() {
  state.sealInput = [];
  state.sealObjects = SEALS.map(d => {
    const root = new THREE.Group(); root.position.set(d.x, 0, d.z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, 0.35, 8), new THREE.MeshLambertMaterial({ color: 0x586576 }));
    base.position.y = 0.18; root.add(base);
    const mat = new THREE.MeshBasicMaterial({ color: d.color });
    const line = (points) => { const g = new THREE.BufferGeometry().setFromPoints(points.map(([x,z]) => new THREE.Vector3(x,0.39,z))); root.add(new THREE.Line(g, new THREE.LineBasicMaterial({color:d.color}))); };
    let glyph;
    if (d.id === 'sun') { glyph = new THREE.Mesh(new THREE.TorusGeometry(0.42,0.09,8,24), mat); glyph.rotation.x = -Math.PI/2; }
    else if (d.id === 'hill') { line([[-0.55,0.35],[0,-0.45],[0.55,0.35],[-0.55,0.35]]); }
    else if (d.id === 'wind') { for (const z of [-0.25,0,0.25]) line([[-0.55,z],[0.15,z],[0.5,z-0.2]]); }
    else { glyph = new THREE.Mesh(d.id === 'clue' ? new THREE.BoxGeometry(0.65,0.9,0.24) : new THREE.TorusGeometry(1.25,0.1,8,36), mat); if (d.id !== 'clue') glyph.rotation.x = -Math.PI/2; }
    if (glyph) { glyph.position.y = d.id === 'clue' ? 0.75 : 0.4; root.add(glyph); }
    const label = makeNameSprite(d.name); label.position.y = d.id === 'clue' ? 1.65 : 1.3; root.add(label);
    scene.add(root); return { ...d, root, mat, glyph };
  });
  updateSealVisuals();
}
function updateSealVisuals() {
  for (const d of state.sealObjects || []) {
    if (d.id.endsWith('Gate')) d.mat.color.setHex(state.sealSolved ? 0x83dcff : 0x737b87);
    d.root.scale.setScalar((state.sealInput || []).includes(d.id) ? 1.12 : 1);
  }
}
function nearbySeal() {
  if (!state.ready || state.dead || !state.player) return null;
  return (state.sealObjects || []).filter(d => Math.hypot(state.player.position.x-d.x,state.player.position.z-d.z) <= 2.1).sort((a,b) => state.player.position.distanceTo(a.root.position)-state.player.position.distanceTo(b.root.position))[0] || null;
}
function openSealDialog(d, notice = '') {
  state.dialog = true; state.dlgFocus = d.root.position;
  document.getElementById('dlg-name').textContent = d.name;
  document.getElementById('dlg-list').innerHTML = '';
  const text = document.getElementById('dlg-text'), btns = document.getElementById('dlg-btns'); btns.innerHTML = '';
  const button = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { if (!state.dialog || state.dead || nearbySeal()?.id !== d.id) return; b.disabled = true; fn(); }; btns.appendChild(b); };
  if (d.id.endsWith('Gate')) {
    text.innerHTML = state.sealSolved ? '세 문양이 이어져 바람길이 열렸다.<br>비용 없이 마을과 유적 남쪽을 오갈 수 있다. 이동해도 체력과 적의 상태는 그대로다.' : '희미한 문양이 길을 막고 있다.<br>유적 남쪽의 <b>바람길 비문</b>을 읽고 세 문양을 순서대로 깨워야 한다.';
    if (state.sealSolved) {
      const dest = SEALS.find(x => x.id === (d.id === 'villageGate' ? 'ruinsGate' : 'villageGate'));
      button(dest.id === 'villageGate' ? '마을로 이동 (무료)' : '유적 남쪽으로 이동 (무료)', () => {
        if (!state.sealSolved || state.trial?.active) { toast('시련을 마친 뒤 바람길을 이용하세요.'); closeDialog(); return; }
        state.player.position.set(dest.x,0,dest.z+1.6); if (state.autoOn) toggleAuto();
        closeDialog(); saveGame(); toast(dest.id === 'villageGate' ? '바람길을 따라 마을에 도착했다.' : '바람길을 따라 유적 남쪽에 도착했다.');
      });
    }
  } else if (d.id === 'clue') {
    text.innerHTML = '옛 순례자의 비문:<br><b>"아침의 둥근 빛이 눈을 뜨고,<br>땅은 뾰족한 등을 일으킨다.<br>마지막엔 세 줄기 숨결이 길을 잇는다."</b><br>주변의 세 받침에 문양이 새겨져 있다. 서로 다른 문양을 차례로 깨우자.<br>틀려도 비용 없이 현재 입력만 지워진다. 입력 중에는 저장되지 않는다.';
  } else {
    const names = (state.sealInput || []).map(id => SEALS.find(x=>x.id===id).name).join(' → ') || '없음';
    text.innerHTML = notice || (state.sealSolved ? '이미 바람길에 힘을 보태고 있다. 마을과 유적 남쪽의 바람길을 이용할 수 있다.' : `현재 울림: <b>${names}</b> (${(state.sealInput || []).length}/3)<br>이 문양을 깨울까? 비문의 순서를 떠올리자.`);
    if (!state.sealSolved) button('문양 깨우기', () => {
      if (state.sealSolved) { closeDialog(); return; }
      const order = ['sun','hill','wind'];
      if (d.id !== order[(state.sealInput || []).length]) {
        state.sealInput = []; updateSealVisuals(); openSealDialog(d, '울림이 흩어졌다. 입력만 초기화되었다.<br>비문을 다시 읽고 첫 문양부터 시작하자. 비용과 진행 손실은 없다.');
      } else {
        state.sealInput.push(d.id);
        if (state.sealInput.length === 3) { state.sealSolved = true; state.sealInput = []; saveGame(); sfx('reward',1); toast('세 문양 공명! 마을 ↔ 유적 바람길 개통'); }
        updateSealVisuals(); closeDialog();
      }
    });
  }
  button('닫기', closeDialog);
  dlgEl().style.display = 'block'; document.getElementById('dlgback').style.display = 'block';
}

// 잊힌 유적: 발견(16m 접근) 1회성
function updateRuins() {
  if (!state.ruinsPos || state.dead || state.ruinsFound) return;
  if (Math.hypot(state.player.position.x - state.ruinsPos.x, state.player.position.z - state.ruinsPos.z) < 16) {
    state.ruinsFound = true;
    toast('잊힌 유적 발견! 오래된 수호자들이 잠들어 있다…');
    sfx('dialog', 0.7);
    gainXp(15);
    saveGame();
  }
}
function updateWatch() {
  const w = state.watch;
  if (!w || state.dead) return;
  if (!state.watchFound && state.player.position.distanceTo(w.root.position) < 30) {
    state.watchFound = true;
    toast('버려진 망루 발견! 강한 기척이 지키고 있다…');
    sfx('dialog', 0.7);
    gainXp(15);
    saveGame();
  }
}

// ---------- 황금 쥐: 희귀 출현 · 도망형 · 60초 한정 보상 ----------
function updateGolden(now) {
  if (!state.golden) state.golden = { nextAt: now + 100 + Math.random() * 60, active: null, until: 0 };
  const g = state.golden;
  if (g.active) {
    const e = g.active;
    if (e.dead && !e.despawned) { g.active = null; g.nextAt = now + 120 + Math.random() * 90; }
    else if (!e.dead && now > g.until) {
      e.dead = true; e.despawned = true; e.mode = 'dead'; e.root.visible = false; e.respawnAt = 1e12;
      g.active = null; g.nextAt = now + 90 + Math.random() * 90;
      toast('황금 쥐가 도망쳐 버렸다…');
    }
    return;
  }
  if (state.dead || now < g.nextAt) return;
  if (!state.protos || !state.protos.Rat) return;
  const a = Math.random() * Math.PI * 2, r = 22 + Math.random() * 28;
  const e = state.spawn(state.protos.Rat, GOLDEN, Math.cos(a) * r, Math.sin(a) * r);
  e.home.set(e.root.position.x, 0, e.root.position.z);
  g.active = e; g.until = now + 60;
  toast('황금 쥐가 나타났다! 60초 안에 잡으면 50G');
  sfx('reward', 0.8);
}

// ---------- 바람의 고리 5곳: 통과하는 탐험 요소 (1회성, XP·보상) ----------
const RINGS = [
  { x: 0, z: -25, name: '마을 외곽' },
  { x: 28, z: 18, name: '숲' },
  { x: -42, z: 16, name: '호숫가' },
  { x: 30, z: -38, name: '묘지 외곽' },
  { x: -8, z: 60, name: '언덕 북쪽' },
];
const RING_XP = 8, RING_ALL_GOLD = 80;
function spawnRings() {
  if (state.rings) return;
  state.rings = RINGS.map((r, i) => {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.12, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    m.position.set(r.x, 1.5, r.z);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.4, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.15, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    halo.position.copy(m.position);
    scene.add(m); scene.add(halo);
    const passed = state.ringsPassed.includes(i);
    m.visible = !passed; halo.visible = !passed;
    return { mesh: m, halo, x: r.x, z: r.z, name: r.name, passed };
  });
}
function updateRings(dt) {
  if (!state.rings || state.dead) return;
  for (let i = 0; i < state.rings.length; i++) {
    const r = state.rings[i];
    if (r.passed) continue;
    r.mesh.rotation.z += dt * 0.8; r.halo.rotation.z -= dt * 0.5;
    const dx = state.player.position.x - r.x, dz = state.player.position.z - r.z;
    if (dx * dx + dz * dz < 1.8 * 1.8) {
      r.passed = true; r.mesh.visible = false; r.halo.visible = false;
      state.ringsPassed.push(i);
      gainXp(RING_XP);
      sfx('reward', 0.6);
      const n = state.ringsPassed.length;
      if (n >= RINGS.length) {
        state.gold += RING_ALL_GOLD;
        toast(`바람의 고리 모두 통과! +${RING_ALL_GOLD} 골드`);
      } else {
        toast(`바람의 고리 (${n}/${RINGS.length}) +${RING_XP} XP`);
      }
      checkAch();
      saveGame();
    }
  }
}

// ---------- 시련의 돌: 3연속 웨이브 도전 (전투 콘텐츠) ----------
const TRIAL_POS = { x: -26, z: 6 };
const TRIAL_WAVES = [
  { mobs: [[ENEMY, 3]], label: '스켈레톤 3마리' },
  { mobs: [[ENEMY, 2], [FSKEL, 2]], label: '스켈레톤 2 + 서리 스켈레톤 2' },
  { mobs: [[{ ...ENEMY, hp: 60, dmg: 10, gold: 20, label: '시련 수호자', tint: 0xd4a017, emis: 0x2a1f00, guard: true }, 1]], label: '시련 수호자' },
];
function buildTrialStone() {
  const root = new THREE.Group();
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.0), new THREE.MeshLambertMaterial({ color: 0x6b7280 }));
  rock.scale.set(1, 1.7, 1); rock.position.y = 1.5; rock.castShadow = true; root.add(rock);
  const rune = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.1, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffc84a }));
  rune.rotation.x = -Math.PI / 2; rune.position.y = 0.06; root.add(rune);
  const glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), new THREE.MeshBasicMaterial({ color: 0xffc84a }));
  glow.position.y = 3.6; root.add(glow);
  root.position.set(TRIAL_POS.x, 0, TRIAL_POS.z);
  scene.add(root);
  state.trialStone = { root, rune, glow };
}
function openTrialDialog() {
  state.dialog = true;
  state.dlgFocus = new THREE.Vector3(TRIAL_POS.x, 0, TRIAL_POS.z);
  sfx('dialog', 0.7);
  document.getElementById('dlg-name').textContent = '시련의 돌';
  const text = document.getElementById('dlg-text');
  const btns = document.getElementById('dlg-btns');
  btns.innerHTML = '';
  const mk = (label, cls, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', fn);
    btns.appendChild(b);
  };
  const t = state.trial;
  if (t && t.active) {
    text.innerHTML = `시련이 진행 중일세. <b>웨이브 ${t.wave} / ${TRIAL_WAVES.length}</b> — 남은 적을 모두 쓰러뜨리게.`;
    mk('계속', '', closeDialog);
  } else {
    const first = !(state.trialDone > 0);
    text.innerHTML = `오래된 수호자의 돌일세. 세 번의 웨이브를 견디면 수호자의 증표를 내리겠네.<br>${TRIAL_WAVES.map((w, i) => `웨이브 ${i + 1}: ${w.label}`).join('<br>')}<br>사례: <b>골드 ${first ? 50 : 25}G</b>${first ? ' · 수호자의 증표(업적)' : ''}.`;
    mk('시련을 시작한다', '', () => { startTrial(); closeDialog(); });
    mk('닫기', 'sub', closeDialog);
  }
  document.getElementById('dlg-list').innerHTML = '';
  dlgEl().style.display = 'block';
  document.getElementById('dlgback').style.display = 'block';
}
function startTrial() {
  clearBeaconFight();
  state.trial = { active: true, wave: 0, enemies: [] };
  nextTrialWave();
}
function nextTrialWave() {
  const t = state.trial;
  t.wave++;
  const w = TRIAL_WAVES[t.wave - 1];
  let i = 0;
  for (const [stats, n] of w.mobs) {
    for (let k = 0; k < n; k++) {
      const a = (i / 6) * Math.PI * 2;
      const e = state.spawnTrial(stats, TRIAL_POS.x + Math.cos(a) * 7, TRIAL_POS.z + Math.sin(a) * 7);
      if (stats.guard && !e.nameSprite) { e.nameSprite = makeNameSprite(stats.label); e.nameSprite.position.y = 2.9; e.root.add(e.nameSprite); }
      t.enemies.push(e);
      i++;
    }
  }
  sfx('dialog', 1);
  toast(`시련 웨이브 ${t.wave} / ${TRIAL_WAVES.length}: ${w.label}`);
}
function endTrial(win) {
  const t = state.trial;
  if (!t) return;
  for (const e of t.enemies) {
    if (!e.dead) { e.dead = true; e.mode = 'dead'; e.root.visible = false; if (e.tele) e.tele.visible = false; }
    const idx = state.enemies.indexOf(e);
    if (idx >= 0) state.enemies.splice(idx, 1);
    scene.remove(e.root);
  }
  t.active = false;
  if (win) {
    const first = !(state.trialDone > 0);
    state.trialDone = (state.trialDone || 0) + 1;
    state.gold += first ? 50 : 25;
    sfx('reward', 1);
    toast(first ? '시련 완료! 수호자의 증표를 얻었습니다 (+50G)' : '시련 완료! (+25G)');
    checkAch();
    saveGame();
  }
}
function updateTrial(now) {
  const st = state.trialStone;
  if (st) {
    st.glow.rotation.y = now * 2;
    st.glow.position.y = 3.6 + Math.sin(now * 2.6) * 0.15;
    st.rune.material.color.setHex(state.trial && state.trial.active ? 0xff5544 : 0xffc84a);
  }
  const t = state.trial;
  if (!t || !t.active) return;
  if (state.dead) { endTrial(false); return; }
  if (t.enemies.every((e) => e.dead)) {
    if (t.wave >= TRIAL_WAVES.length) { endTrial(true); return; }
    nextTrialWave();
  }
}

// ---------- 바람 제단 (탐험 요소): 외곽 3곳, 근접 시 기도 → 최대 체력 +5·물약 1·골드 10 ----------
const SHRINES = [ // 섬(반경 80) 안쪽, 외곽 탐험 유도 지점
  { x: -56, z: 38, name: '서쪽 바람 제단' },
  { x: 52, z: -44, name: '남동 바람 제단' },
  { x: -8, z: 66, name: '북쪽 바람 제단' },
];
function buildShrines() {
  state.shrines = [];
  SHRINES.forEach((s, i) => {
    const root = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.35, 0.5, 8), new THREE.MeshLambertMaterial({ color: 0x9aa3ad }));
    base.position.y = 0.25; base.castShadow = true; root.add(base);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.8, 8), new THREE.MeshLambertMaterial({ color: 0x8b95a1 }));
    pillar.position.y = 1.3; pillar.castShadow = true; root.add(pillar);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), new THREE.MeshBasicMaterial({ color: 0x7fd4ff }));
    gem.position.y = 2.6; root.add(gem);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.5, 5.5, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    beam.position.y = 3; root.add(beam);
    root.position.set(s.x, 0, s.z);
    scene.add(root);
    const prayed = (state.shrinesPrayed || []).includes(i);
    beam.visible = !prayed;
    gem.material.color.set(prayed ? 0x5a6b7a : 0x7fd4ff);
    state.shrines.push({ root, beam, gem, x: s.x, z: s.z, name: s.name, prayed });
  });
}
function updateShrines(now) {
  if (!state.shrines || state.dead) return;
  for (let i = 0; i < state.shrines.length; i++) {
    const s = state.shrines[i];
    if (!s.prayed) {
      s.gem.rotation.y = now * 1.6;
      s.gem.position.y = 2.6 + Math.sin(now * 2.2 + i) * 0.12;
      if (state.player.position.distanceTo(s.root.position) < 1.8) {
        s.prayed = true;
        s.beam.visible = false;
        s.gem.material.color.set(0x5a6b7a);
        state.shrinesPrayed = state.shrines.map((o, j) => (o.prayed ? j : -1)).filter((j) => j >= 0);
        applyProgression();
        state.hp = state.maxHp;
        state.potions = Math.min(SHOP.potionMax, state.potions + 1);
        state.gold += 10;
        sfx('reward', 1);
        toast(`${s.name}의 축복! 최대 체력 +5 · 물약 +1 · +10G (${state.shrinesPrayed.length}/${SHRINES.length})`);
        state.anim.playOnce('pick_up', 'pick');
        checkAch();
        saveGame();
      }
    }
  }
}

// ---------- 업적 ----------
const ACH = [
  { id: 'firstKill', name: '첫 사냥', cond: () => state.kills >= 1 },
  { id: 'hunter25', name: '언덕의 사냥꾼 (25마리)', cond: () => state.kills >= 25 },
  { id: 'flowers8', name: '바람꽃 수집가 (8송이)', cond: () => state.flowerCount >= 8 },
  { id: 'treasure5', name: '보물 사냥꾼 (상자 5개)', cond: () => (state.chestsOpened || []).length >= 5 },
  { id: 'boss1', name: '묘지 정복자', cond: () => state.bossKills >= 1 },
  { id: 'elite3', name: '엘리트 사냥꾼 (엘리트 3마리)', cond: () => (state.eliteKills || 0) >= 3 },
  { id: 'lvl5', name: '모험가 (레벨 5)', cond: () => (state.level || 1) >= 5 },
  { id: 'geared', name: '무장한 유랑자 (장비 3종)', cond: () => state.gear.sword >= 1 && state.gear.armor >= 1 && state.gear.boots >= 1 },
  { id: 'legend', name: '전설의 유랑자 (최고 등급 3종)', cond: () => state.gear.sword >= 3 && state.gear.armor >= 3 && state.gear.boots >= 3 },
  { id: 'rich300', name: '부유한 유랑자 (300G)', cond: () => state.gold >= 300 },
  { id: 'variant3', name: '변종 사냥꾼 (새 몬스터 3종)', cond: () => ['독 개구리', '그림자 쥐', '서리 스켈레톤'].every((l) => (state.dex[l] || 0) >= 1 || (state.dex['엘리트 ' + l] || 0) >= 1) },
  { id: 'order3', name: '단골 납품꾼 (특별 주문 3회)', cond: () => (state.orderDone || 0) >= 3 },
  { id: 'bounty5', name: '언덕의 해결사 (반복 의뢰 5회)', cond: () => (state.bounty && state.bounty.count || 0) >= 5 },
  { id: 'shrine3', name: '바람 제단 순례 (제단 3곳)', cond: () => (state.shrinesPrayed || []).length >= 3 },
  { id: 'trial1', name: '시련의 돌 정복 (웨이브 3 클리어)', cond: () => (state.trialDone || 0) >= 1 },
  { id: 'treasureHidden', name: '숨겨진 보물 (지도 완성)', cond: () => !!state.treasureDone },
  { id: 'den3', name: '소굴 정리 (몬스터 소굴 3곳)', cond: () => (state.densCleared || []).length >= 3 },
  { id: 'denAll', name: '소굴 정복자 (모든 소굴 정리)', cond: () => (state.densCleared || []).length >= DENS.length },
  { id: 'golden1', name: '황금 쥐를 잡아라', cond: () => (state.dex['황금 쥐'] || 0) >= 1 },
  { id: 'wind5', name: '바람의 고리 (5곳 통과)', cond: () => (state.ringsPassed || []).length >= 5 },
  { id: 'elite5', name: '엘리트 사냥꾼 (엘리트 5마리)', cond: () => (state.eliteKills || 0) >= 5 },
  { id: 'watch1', name: '망루 해방 (수호대장 격파)', cond: () => !!state.watchCleared },
  { id: 'named3', name: '현상금 사냥꾼 (지명 수배 3종)', cond: () => (state.bloodRatKills || 0) >= 1 && (state.stormWaspKills || 0) >= 1 && (state.rockSpiderKills || 0) >= 1 },
  { id: 'warden', name: '유적 해방 (유적의 감시자 격파)', cond: () => (state.ruinWardenKills || 0) >= 1 },
];
function checkAch() {
  let changed = false;
  for (const a of ACH) {
    if (state.ach[a.id] || !a.cond()) continue;
    state.ach[a.id] = true;
    changed = true;
    sfx('reward', 1);
    toast(`업적 달성: ${a.name}`);
  }
  if (changed) saveGame();
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 카메라 충돌 보정 ----------
// 플레이어 머리→카메라 선분이 원형 충돌체/던전 벽을 지나면 그 앞까지 당긴다.
// 실기기 관찰 전 코드 수준 대응: 물리 충돌 모델(원+던전 사각형)과 동일한 기준 사용
function cameraClampT(from, to) {
  let t = 1;
  const dx = to.x - from.x, dz = to.z - from.z;
  const a = dx * dx + dz * dz;
  if (a < 1e-6) return t;
  for (const c of colliders) {
    const r = c.r + 0.35;
    const mx = from.x - c.x, mz = from.z - c.z;
    const cc = mx * mx + mz * mz - r * r;
    if (cc < 0) continue; // 시작점이 원 안이면(플레이어 위치) 무시
    const b = 2 * (mx * dx + mz * dz);
    const disc = b * b - 4 * a * cc;
    if (disc <= 0) continue;
    const tt = (-b - Math.sqrt(disc)) / (2 * a);
    if (tt > 0.02 && tt < t) t = tt;
  }
  // 던전 벽: 플레이어가 밖에 있으면 사각형 진입 전까지, 안에 있으면 벽 안쪽으로 제한
  const { cx, cz, half } = DUNGEON;
  if (half) {
    const m = 0.5;
    const inRect = (x, z, pad) => Math.abs(x - cx) < half + pad && Math.abs(z - cz) < half + pad;
    const fromIn = inRect(from.x, from.z, -0.2);
    if (fromIn) {
      // 카메라를 벽 안쪽에 유지 (남문 띠는 열어둠)
      const lim = half - m;
      const tx = Math.max(cx - lim, Math.min(cx + lim, from.x + dx * t));
      let tz = Math.max(cz - lim, Math.min(cz + lim, from.z + dz * t));
      const inDoorX = Math.abs(tx - (DUNGEON.doorX ?? cx)) < DUNGEON.doorHalf;
      if (tz > cz + lim && !inDoorX) tz = cz + lim;
      const dd = Math.hypot(tx - from.x, tz - from.z);
      t = Math.min(t, dd / Math.sqrt(a));
    } else if (inRect(from.x + dx * t, from.z + dz * t, m * 0.4)) {
      // 슬랩 교차: 확장 사각형에 들어가는 최초 t
      let tEnter = 1;
      const bounds = [cx - half - 0.2, cx + half + 0.2, cz - half - 0.2, cz + half + 0.2];
      if (Math.abs(dx) > 1e-6) {
        for (const bx of bounds.slice(0, 2)) {
          const tt = (bx - from.x) / dx;
          if (tt > 0 && tt < 1) {
            const zAt = from.z + dz * tt;
            if (zAt > bounds[2] && zAt < bounds[3] && tt < tEnter) tEnter = tt;
          }
        }
      }
      if (Math.abs(dz) > 1e-6) {
        for (const bz of bounds.slice(2)) {
          const tt = (bz - from.z) / dz;
          if (tt > 0 && tt < 1) {
            const xAt = from.x + dx * tt;
            if (xAt > bounds[0] && xAt < bounds[1] && tt < tEnter) tEnter = tt;
          }
        }
      }
      // 남문 접근은 허용
      const xAtE = from.x + dx * tEnter;
      const zAtE = from.z + dz * tEnter;
      const atDoor = Math.abs(xAtE - (DUNGEON.doorX ?? cx)) < DUNGEON.doorHalf && zAtE > cz;
      if (!atDoor) t = Math.min(t, Math.max(0.05, tEnter - 0.04));
    }
  }
  return t;
}

// ---------- 목표 안내 (HUD 화살표 + 3D 표지) ----------
const marker = new THREE.Group();
{
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.85, 9, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  beam.position.y = 4.5;
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.34),
    new THREE.MeshBasicMaterial({ color: 0xffe08a })
  );
  gem.position.y = 3.4;
  marker.add(beam, gem);
  marker.userData.gem = gem;
  marker.visible = false;
  scene.add(marker);
}
function nearestEnemyPos(filter) {
  let best = null, bd = 1e9;
  for (const e of state.enemies) {
    if (e.dead || !filter(e)) continue;
    const d = e.root.position.distanceTo(state.player.position);
    if (d < bd) { bd = d; best = e.root.position; }
  }
  return best;
}
// 현재 목표 지점: 수락/완료 보고는 장로, 진행 중이면 대상 적/수집물/보스 위치
function objectiveTarget() {
  if (!state.npc) return null;
  const mode = state.tracked || 'auto';
  if (mode === 'none') return null;
  if (mode === 'archive') return archiveTarget() || autoObjective();
  if (mode === 'mist') return mistTarget() || autoObjective();
  if (mode === 'bell') return bellTarget() || autoObjective();
  if (mode === 'estuary') return estuaryTarget() || autoObjective();
  if (mode === 'courier') return courierTarget() || autoObjective();
  if (mode === 'cart') return cartTarget() || autoObjective();
  if (mode === 'echo') return echoTarget() || autoObjective();
  if (mode === 'observatory') return observatoryTarget() || autoObjective();
  if (mode === 'beacon') return beaconTarget() || autoObjective();
  if (mode === 'journey') return journeyTarget() || autoObjective();
  if (mode === 'quest') return questTargetInner() || autoObjective();
  if (mode === 'bounty') return bountyTarget() || autoObjective();
  return autoObjective();
}
// 기존 동작: 진행 중인 메인 의뢰 우선, 체인이 끝났으면 반복 의뢰
function autoObjective() {
  const qd = QUESTS[state.quest.idx];
  if (qd) return questTargetInner();
  return bountyTarget();
}
function cycleTrack() {
  const opts = ['auto'];
  if (QUESTS[state.quest.idx]) opts.push('quest');
  if (state.bounty && state.bounty.active) opts.push('bounty');
  if (journeyTarget()) opts.push('journey');
  if (beaconTarget()) opts.push('beacon');
  if (observatoryTarget()) opts.push('observatory');
  if (echoTarget()) opts.push('echo');
  if(archiveTarget())opts.push('archive');
  if(mistTarget())opts.push('mist');
  if(bellTarget())opts.push('bell');
  if(estuaryReady()&&state.estuary.stage<5)opts.push('estuary');
  if (courierTarget()) opts.push('courier');
  if (cartTarget()) opts.push('cart');
  opts.push('none');
  const cur = opts.indexOf(state.tracked || 'auto');
  state.tracked = opts[(cur + 1) % opts.length];
  const t = objectiveTarget();
  toast(state.tracked === 'none' ? '의뢰 추적을 껐습니다' : `추적: ${t ? t.label : '의뢰'}`);
  saveGame();
}
function questTargetInner() {
  if (!state.npc) return null;
  const q = state.quest, d = QUESTS[q.idx];
  const npcPos = { x: state.npc.pos.x, z: state.npc.pos.z, label: '마을 장로' };
  if (!d) return null;
  if (q.state !== 'active') return npcPos;
  if (questProgress() >= d.goal) return { ...npcPos, label: '장로에게 보고' };
  let pos = null;
  if (d.counter === 'skKills') pos = nearestEnemyPos((e) => e.stats.skel && !e.stats.warrior);
  else if (d.counter === 'fieldKills') pos = nearestEnemyPos((e) => !e.stats.skel);
  else if (d.counter === 'wKills') pos = nearestEnemyPos((e) => e.stats.warrior);
  else if (d.counter === 'flowers') pos = nearestFlowerPos();
  else if (d.counter === 'bossKills') pos = state.boss && !state.boss.dead ? state.boss.root.position : null;
  else if (d.counter === 'variantKills') pos = nearestEnemyPos((e) => ['독 개구리', '그림자 쥐', '서리 스켈레톤'].some((l) => e.stats.label === l || e.stats.label === '엘리트 ' + l));
  else if (d.counter === 'snakeKills' || d.counter === 'vials') pos = nearestEnemyPos((e) => e.stats.snake && !e.stats.kingSnake);
  else if (d.counter === 'kingSnakeKills') pos = nearestEnemyPos((e) => e.stats.kingSnake);
  else if (d.counter === 'waspKills') pos = nearestEnemyPos((e) => e.stats.wasp && !e.stats.queenWasp);
  else if (d.counter === 'queenWaspKills') pos = nearestEnemyPos((e) => e.stats.queenWasp);
  else if (d.counter === 'bogVials') pos = nearestEnemyPos((e) => e.stats.bogSnake);
  else if (d.counter === 'bogSpiderKills') pos = nearestEnemyPos((e) => e.stats.bogSpider);
  else if (d.counter === 'bogLordKills') pos = nearestEnemyPos((e) => e.stats.bogLord);
  else if (d.counter === 'bloodRatKills') pos = nearestEnemyPos((e) => e.stats.bloodRat);
  else if (d.counter === 'stormWaspKills') pos = nearestEnemyPos((e) => e.stats.stormWasp);
  else if (d.counter === 'rockSpiderKills') pos = nearestEnemyPos((e) => e.stats.rockSpider);
  else if (d.counter === 'ruinSkelKills') pos = nearestEnemyPos((e) => e.stats.ruinSkel);
  else if (d.counter === 'ruinWarKills') pos = nearestEnemyPos((e) => e.stats.ruinWar);
  else if (d.counter === 'ruinWardenKills') pos = nearestEnemyPos((e) => e.stats.ruinWarden);
  if (!pos) return null;
  return { x: pos.x, z: pos.z, label: d.name };
}
function bountyTarget() {
  if (!state.npc) return null;
  const npcPos = { x: state.npc.pos.x, z: state.npc.pos.z, label: '마을 장로' };
  const b = state.bounty;
  if (!b || !b.active) return null;
  const goal = bountyGoal(b);
  const prog = bountyProg(b);
  if (prog >= goal) return { ...npcPos, label: '장로에게 보고' };
  if (b.kind === 'mats') {
    const labels = Object.keys(MATS).filter((l) => MATS[l].name === b.mat);
    const mp = nearestEnemyPos((e) => labels.some((l) => e.stats.label === l || e.stats.label === '엘리트 ' + l));
    return mp ? { x: mp.x, z: mp.z, label: b.mat + ' 사냥' } : null;
  }
  if (b.kind === 'elite') {
    const ep = nearestEnemyPos((e) => e.stats.elite);
    return ep ? { x: ep.x, z: ep.z, label: '엘리트 토벌' } : null;
  }
  if (b.kind === 'flowers') {
    const fp = nearestFlowerPos();
    return fp ? { x: fp.x, z: fp.z, label: '바람꽃 수집' } : null;
  }
  if (b.kind === 'variants') {
    const vp = nearestEnemyPos((e) => ['독 개구리', '그림자 쥐', '서리 스켈레톤'].some((l) => e.stats.label === l || e.stats.label === '엘리트 ' + l));
    return vp ? { x: vp.x, z: vp.z, label: '변종 사냥' } : null;
  }
  const bp = nearestEnemyPos(() => true);
  return bp ? { x: bp.x, z: bp.z, label: '현상금 사냥' } : null;
}
function nearestFlowerPos() {
  if (!state.flowers) return null;
  let best = null, bd = 1e9;
  for (const f of state.flowers) {
    if (f.taken) continue;
    const d = f.root.position.distanceTo(state.player.position);
    if (d < bd) { bd = d; best = f.root.position; }
  }
  return best;
}
function updateGuidance(now) {
  const nav = document.getElementById('nav');
  let t = state.tutDone || state.quest.idx > 0 || state.quest.state === 'active' ? objectiveTarget() : (state.npc ? { x: state.npc.pos.x, z: state.npc.pos.z, label: '마을 장로' } : null);
  if (!t && state.treasure && !state.treasureDone) t = { x: state.treasure.x, z: state.treasure.z, label: '숨겨진 보물' };
  if (!t || state.dead) { marker.visible = false; nav.style.display = 'none'; return; }
  marker.visible = true;
  marker.position.set(t.x, 0, t.z);
  marker.userData.gem.position.y = 3.4 + Math.sin(now * 2.4) * 0.25;
  marker.userData.gem.rotation.y = now * 1.8;
  const dx = t.x - state.player.position.x, dz = t.z - state.player.position.z;
  const dist = Math.hypot(dx, dz);
  // 플레이어가 목표 바로 위면 화살표는 숨기고 표지만
  if (dist < 3) { nav.style.display = 'none'; return; }
  nav.style.display = 'block';
  const bearing = Math.atan2(dx, dz) - camYaw;
  document.getElementById('navarrow').style.transform = `rotate(${(-bearing * 180 / Math.PI + 360) % 360}deg)`;
  document.getElementById('navtext').textContent = `${t.label} ${Math.round(dist)}m`;
}

// ---------- 튜토리얼 (첫 플레이 단계별 안내) ----------
const TUT_STEPS = [
  '① 이동: WASD(모바일은 왼쪽 스틱)로 움직여 보세요',
  '② 시점: 화면을 드래그해 주위를 둘러보세요',
  '③ 공격: Space 또는 공격 버튼으로 검을 휘둘러 보세요',
  '④ 표지를 따라 마을 장로에게 가서 대화하세요 (E 또는 대화 버튼)',
];
const tut = { step: 0, sx: 0, sz: 0, syaw: Math.PI, init: false };
function tutVisible() {
  return state.ready && !state.tutDone && state.quest.idx === 0 && state.quest.state === 'none';
}
function updateTutorial() {
  const el = document.getElementById('tut');
  if (!tutVisible()) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const p = state.player.position;
  if (!tut.init) { tut.init = true; tut.sx = p.x; tut.sz = p.z; tut.syaw = camYaw; }
  if (tut.step === 0 && Math.hypot(p.x - tut.sx, p.z - tut.sz) > 3) tut.step = 1;
  if (tut.step === 1 && Math.abs(camYaw - tut.syaw) > 0.6) tut.step = 2;
  if (tut.step === 2 && state.attacksDone > 0) tut.step = 3;
  if (tut.step >= 3 && state.dialog) {
    state.tutDone = true; el.style.display = 'none'; saveGame();
    return;
  }
  document.getElementById('tuttext').textContent = TUT_STEPS[Math.min(tut.step, 3)];
}
document.getElementById('tutskip').addEventListener('click', (e) => {
  e.stopPropagation();
  state.tutDone = true;
  document.getElementById('tut').style.display = 'none';
  saveGame();
});

// ---------- 전투 판정 ----------
function killEnemy(e) {
  e.dead = true; e.mode = 'dead';
  cancelWardenPulse(e);
  cancelStormCharge(e);
  cancelFrogSpit(e);
  cancelArcher(e);
  e.anim.playOnce('death_a', 'death');
  sfx('death', 0.9);
  e.respawnAt = clock.elapsedTime + (e.stats.boss ? 60 : 6);
  if(e.expedition){e.respawnAt=1e12;if(e.tele)e.tele.visible=false;setTimeout(()=>{e.root.visible=false},1600);return;}
  state.kills++;
  state.dex[e.stats.label] = (state.dex[e.stats.label] || 0) + 1;
  gainXp(e.stats.gold || 3);
  if (e.stats.skel) state.skKills++;
  if (e.stats.warrior) state.wKills++;
  if (e.stats.snake) state.snakeKills = (state.snakeKills || 0) + 1;
  if (e.stats.kingSnake) state.kingSnakeKills = (state.kingSnakeKills || 0) + 1;
  if (e.stats.wasp) state.waspKills = (state.waspKills || 0) + 1;
  if (e.stats.queenWasp) state.queenWaspKills = (state.queenWaspKills || 0) + 1;
  if (e.stats.bogSpider) state.bogSpiderKills = (state.bogSpiderKills || 0) + 1;
  if (e.stats.bogLord) state.bogLordKills = (state.bogLordKills || 0) + 1;
  if (e.stats.bloodRat) state.bloodRatKills = (state.bloodRatKills || 0) + 1;
  if (e.stats.stormWasp) state.stormWaspKills = (state.stormWaspKills || 0) + 1;
  if (e.stats.rockSpider) state.rockSpiderKills = (state.rockSpiderKills || 0) + 1;
  if (e.stats.ruinSkel) state.ruinSkelKills = (state.ruinSkelKills || 0) + 1;
  if (e.stats.ruinWar) state.ruinWarKills = (state.ruinWarKills || 0) + 1;
  if (e.stats.ruinWarden) state.ruinWardenKills = (state.ruinWardenKills || 0) + 1;
  if (e.stats.boss) state.bossKills++;
  if (e.stats.elite) state.eliteKills = (state.eliteKills || 0) + 1;
  const g = e.stats.gold || 3;
  state.gold += g;
  const mat = MATS[(e.stats.label || '').replace(/^엘리트 /, '')];
  if (mat) {
    const dn = e.stats.boss ? 3 : e.stats.elite ? 2 : (e.stats.guard || e.stats.noRespawn) ? 1 : (Math.random() < 0.45 ? 1 : 0); // 가드 미니보스는 재료 확정 드롭 (1회성이라 미드롭 시 영구 상실 방지)
    if (dn > 0) { state.mats[mat.name] = (state.mats[mat.name] || 0) + dn; toast(`재료 획득: ${mat.name}${dn > 1 ? ' ×' + dn : ''}`); if (mat.name === '독니') state.vials = (state.vials || 0) + dn; }
  }
  if (e.stats.watch && !state.watchCleared) {
    state.watchCleared = true;
    state.mats['수호대장 투구'] = (state.mats['수호대장 투구'] || 0) + 2;
    state.potions = Math.min(SHOP.potionMax, state.potions + 1);
    sfx('reward', 1);
    toast('망루 수호대장 격파! 수호대장 투구 ×2 · 물약 +1');
    checkAch();
    saveGame();
  }
  toast(e.stats.elite ? `엘리트 처치! +${g} 골드` : `처치! +${g} 골드`);
  if (e.tele) e.tele.visible = false;
  setTimeout(() => { e.root.visible = false; }, 1600);
}
// heavy = 강공격·회전베기 (가드 파괴 가능). 가드 중인 적은 일반 공격을 30%만 받음
function damageEnemy(e, dmg, heavy, source='melee') {
  if(e.stats.windPractice){e.windPracticeHits++;e.hp=Math.max(1,e.hp-dmg);e.nameSprite.material.map.dispose();e.nameSprite.material.dispose();e.root.remove(e.nameSprite);e.nameSprite=makeNameSprite(`표적${e.windPracticeIndex} · ${e.windPracticeHits}회 · ${dmg}`);e.nameSprite.position.y=2.8;e.root.add(e.nameSprite);hitFlash(e.root);return;}
  if(mistDamage(e))return;
  if(bellShieldHit(e,dmg,heavy,source))return;
  if(echoDamage(e,dmg))return;
  const now = clock.elapsedTime;
  const staggering = e.staggerUntil && now < e.staggerUntil;
  if (e.stats.guard && !staggering) {
    if (!heavy) {
      dmg = Math.max(1, Math.round(dmg * 0.3));
      e.hp -= dmg;
      hitFlash(e.root);
      sfx(Math.random() < 0.5 ? 'hit1' : 'hit2', 0.5);
      if (e.hp <= 0) killEnemy(e);
      return;
    }
    e.staggerUntil = now + (hasSkill('crush') ? 2.5 : 1.2);
    if (hasSkill('crush')) dmg = Math.round(dmg * 1.3);
    toast(`${e.stats.label} 가드 파괴!`);
    sfx('reward', 0.5);
  }
  e.hp -= dmg;
  window.__dbgDmg = (window.__dbgDmg || 0) + 1;
  hitFlash(e.root);
  sfx(Math.random() < 0.5 ? 'hit1' : 'hit2', 0.9);
  if (heavy && state.attackStrong && !e.stats.bellBoss && !e.stats.mistHunter) {
    // 강공격 넉백
    const push = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
    e.root.position.addScaledVector(push, 1.4);
    const d0 = Math.hypot(e.root.position.x, e.root.position.z);
    clampWorld(e.root.position);
  }
  if (e.hp <= 0) killEnemy(e);
  else { e.anim.playOnce('hit_a', 'hit'); e.hitUntil = now + 0.4; }
}
function playerAttackHit() {
  window.__dbgHit = (window.__dbgHit || 0) + 1;
  const p = state.player.position;
  const fwd = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
  const strong = state.attackStrong;
  const mult = strong ? (hasSkill('smash') ? 3.0 : 2.2) : 1;
  const range = strong && hasSkill('smash') ? PLAYER.range * 1.4 : PLAYER.range;
  const now = clock.elapsedTime;
  let bladeUsed = false;
  const chainTarget = !strong && activeMastery('chain') ? state.enemies.filter(e => {
    if (e.dead) return false;
    const to = e.root.position.clone().sub(p);
    return to.length() <= range && fwd.angleTo(to.normalize()) <= PLAYER.arc / 2;
  }).sort((a,b)=>a.root.position.distanceTo(p)-b.root.position.distanceTo(p))[0] : null;
  const chainBreak = chainTarget ? chainStrike(chainTarget, now) : false;
  if (!chainTarget) state.masteryChain = null;
  for (const e of state.enemies) {
    if (e.dead) continue;
    const to = e.root.position.clone().sub(p);
    const d = to.length();
    if (d > range || observatoryBlocked(p,e.root.position)) continue;
    if (fwd.angleTo(to.normalize()) > PLAYER.arc / 2) continue;
    const guardNow=(e.stats.echoBoss&&state.echoFight?.shield)||(e.stats.guard&&!(e.staggerUntil&&now<e.staggerUntil));
    const pursuitHit=!strong&&!guardNow&&pursuitReady(e,now);
    let dmg = Math.round((PLAYER.dmg + GEAR_ATK[state.gear.sword]) * mult * (pursuitHit?1.5:1));
    let bladeHit=false;
    if (!bladeUsed && state.bladeUntil && now < state.bladeUntil) { bladeHit=true; dmg = Math.round(dmg * 1.6); bladeUsed = true; state.bladeUntil = 0; } // 칼바람
    const guardHeld = e.stats.guard && !(e.staggerUntil && now < e.staggerUntil) && !strong;
    const beforeHp = e.hp;
    damageEnemy(e, dmg, strong || (chainBreak && e === chainTarget));
    if(pursuitHit&&e.hp<beforeHp){state.pursuit=null;state.windCdUntil=Math.max(now,state.windCdUntil-2);window.__dbgPursuit=(window.__dbgPursuit||0)+1;skillFx(e.root.position,0xffc862,1.5,'hit');sfx('reward',.55);toast('추격 성공! 일반 타격1.5배 · 바람칼날 쿨 -2초');}
    if(strong) skillFx(e.root.position,0xffd68b,1.15,'hit');
    else if(bladeHit) skillFx(e.root.position,0xc5a1ff,.85,'hit');
    consumeRiposte(e, now, guardHeld && !(chainBreak && e === chainTarget), beforeHp);
  }
}

// ---------- 회전베기 (선풍 스킬, F키 / 회전베기 버튼): 주위 360° 범위 공격, 가드 파괴 가능 ----------
function tryWhirl() {
  if (!state.ready || state.dead || state.dialog) return;
  if (!hasSkill('whirl')) { toggleSkillTree(); return; }
  const now = clock.elapsedTime;
  if (now < state.whirlCdUntil || now < state.dodgeUntil || now < state.attackCdUntil) return;
  state.masteryChain = null;
  state.whirlCdUntil = now + (hasSkill('storm') ? 6 : 8);
  state.didHit = true; // 회전베기는 아래에서 즉시 판정. 일반 공격 지연 판정이 덧붙지 않게 함
  state.attackUntil = now + 0.5;
  state.attackCdUntil = now + 0.6;
  state.attackStrong = false;
  state.anim.playOnce('slice_diagonal');
  sfx('swing2', 1);
  window.__dbgWhirl = (window.__dbgWhirl || 0) + 1;
  const dmg = Math.round((PLAYER.dmg + GEAR_ATK[state.gear.sword]) * (hasSkill('storm') ? 2.0 : 1.4));
  const p = state.player.position;
  for (const e of state.enemies) {
    if (e.dead) continue;
    if (e.root.position.distanceTo(p) > 2.8 || observatoryBlocked(p,e.root.position)) continue;
    damageEnemy(e, dmg, true);
    skillFx(e.root.position,0xd5f4ff,1,'hit');
    if (activeMastery('gale') && galeEligible(e)) e.galeUntil = now + 3;
  }
  skillFx(p,activeMastery('gale')?0x91ffd5:0x91dbff,2.8,'whirl');
  updateWhirlBtn();
}


// ---------- 스킬 시전/명중 이펙트: 풀 재사용, 화면 전체 섬광 없음 ----------
const skillFxPool=[];
let skillRingGeo=null, skillRayGeo=null;
function skillFx(pos,color,size,kind='cast',heading=0){
  if(!skillRingGeo){skillRingGeo=new THREE.TorusGeometry(1,.085,6,40);skillRayGeo=new THREE.BoxGeometry(.045,.045,.6);}
  let f=skillFxPool.find(f=>!f.root.visible);
  if(!f){
    if(skillFxPool.length>=24)f=skillFxPool.reduce((a,b)=>a.start<b.start?a:b);
    else{const root=new THREE.Group(),mat=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9,depthWrite:false});
      const ring=new THREE.Mesh(skillRingGeo,mat);ring.rotation.x=Math.PI/2;root.add(ring);
      const rays=[];for(let i=0;i<8;i++){const r=new THREE.Mesh(skillRayGeo,mat);const a=i*Math.PI/4;r.position.set(Math.sin(a),0,Math.cos(a));r.rotation.y=a;rays.push(r);root.add(r)}
      scene.add(root);f={root,mat,ring,rays};skillFxPool.push(f);
    }
  }
  Object.assign(f,{kind,start:clock.elapsedTime,size,duration:kind==='whirl'?.8:kind==='hit'?.5:.6});
  f.mat.color.setHex(color);f.mat.opacity=.95;f.root.position.copy(pos);f.root.position.y=.7;f.root.rotation.y=heading;f.root.scale.setScalar(kind==='hit'?size*.65:.2);f.root.visible=true;
  f.ring.visible=true;for(const r of f.rays)r.visible=kind!=='dodge';
  if(kind==='dodge'){f.root.scale.set(.65,.65,1.4);f.root.position.addScaledVector(new THREE.Vector3(Math.sin(heading),0,Math.cos(heading)),-.4)}
}
function updateSkillFx(now){for(const f of skillFxPool){if(!f.root.visible)continue;const k=(now-f.start)/f.duration;if(k>=1){f.root.visible=false;continue}const v=f.size*(f.kind==='hit'?.65+k*.55:.25+k*.75);f.root.scale.set(v,kindVertical(f.kind)?v*.7:v,v);f.root.rotation.y+=.05;f.mat.opacity=.95*(1-k*.8);if(kindVertical(f.kind))f.root.position.y+=.015;}}
function kindVertical(k){return k==='heal'||k==='ready'}
let windVisual=null;
function makeWindVisual(){if(windVisual)return;const root=new THREE.Group();const mat=new THREE.MeshBasicMaterial({color:0x7de7ff,transparent:true,opacity:.95,depthWrite:false});
  const arc=new THREE.Mesh(new THREE.TorusGeometry(.48,.095,6,20,Math.PI*1.5),mat);arc.rotation.x=Math.PI/2;root.add(arc);
  const core=new THREE.Mesh(new THREE.OctahedronGeometry(.24),new THREE.MeshBasicMaterial({color:0xecffff}));root.add(core);
  const tail=new THREE.Mesh(new THREE.ConeGeometry(.2,1.7,5),new THREE.MeshBasicMaterial({color:0x45c5ff,transparent:true,opacity:.45,depthWrite:false}));tail.rotation.x=-Math.PI/2;tail.position.z=-.85;root.add(tail);scene.add(root);root.visible=false;windVisual=root;
}
function cancelWindshot(result){if(state.windshot){state.windshot=null;state.windResult=result;}if(windVisual)windVisual.visible=false;}
function windWall(p){
  if(!onWorld(p))return true;
  if(colliders.some(c=>Math.hypot(p.x-c.x,p.z-c.z)<c.r+.22))return true;
  const {cx,cz,half,doorHalf}=DUNGEON;if(!half)return false;
  const dx=Math.abs(p.x-cx),dz=Math.abs(p.z-cz),band=.85;
  if(dx>half+band||dz>half+band)return false;
  const door=Math.abs(p.x-(DUNGEON.doorX??cx))<doorHalf&&p.z>cz+half-band;
  return !door&&(Math.abs(dx-half)<band||Math.abs(dz-half)<band);
}
function tryWindshot(){
  if(!state.ready||state.dead||state.dialog||state.menuOpen)return;
  if(!hasSkill('windshot')){toggleSkillTree();return;}
  const now=clock.elapsedTime;if(now<state.windCdUntil||now<state.attackCdUntil||now<state.dodgeUntil)return;
  state.windCdUntil=now+5;state.attackCdUntil=now+.6;state.attackUntil=now+.45;state.didHit=true;state.attackStrong=false;state.masteryChain=null;
  const dir=new THREE.Vector3(Math.sin(state.heading),0,Math.cos(state.heading));const pos=state.player.position.clone();pos.y=.8;
  const pierce=piercingWind();state.lastWindHits=0;state.windshot={pos,origin:pos.clone(),dir,left:10,dmg:Math.round((PLAYER.dmg+GEAR_ATK[state.gear.sword])*(pierce?.9:1.2)),pierce,hits:new Set()};state.windResult='flying';
  state.anim.playOnce('slice_diagonal');skillFx(pos,0x66dfff,1.15,'cast',state.heading);makeWindVisual();windVisual.children[0].scale.set(pierce?.55:1,pierce?1.7:1,1);windVisual.children[0].material.color.setHex(pierce?0xffd36c:0x7de7ff);windVisual.children[1].material.color.setHex(pierce?0xfff2b2:0xecffff);windVisual.children[2].material.color.setHex(pierce?0xffb34e:0x45c5ff);windVisual.position.copy(pos);windVisual.rotation.y=state.heading;windVisual.visible=true;sfx('swing2',.8);window.__dbgWind=(window.__dbgWind||0)+1;
}
function updateWindshot(dt,now){
  const w=state.windshot;if(!w)return;if(state.dead||state.dialog||state.menuOpen){cancelWindshot('cancelled');return}
  let remaining=Math.min(w.left,14*dt);
  while(remaining>.0001&&state.windshot){const step=Math.min(.15,remaining),next=w.pos.clone().addScaledVector(w.dir,step);
    if(windWall(next)){skillFx(next,0xa4b5c0,.7,'hit');cancelWindshot('wall');break;}
    let target=null,best=Infinity;for(const e of state.enemies){if(e.dead||w.hits.has(e)||e.root.position.clone().sub(w.origin).dot(w.dir)<0)continue;const d=segmentDistance(e.root.position,w.pos,next);if(d<.7){const t=e.root.position.clone().sub(w.pos).dot(w.dir);if(t<best){best=t;target=e}}}
    if(!target&&hitObservatoryBell(w,next)){cancelWindshot('bell');break;}
    w.pos.copy(next);w.left-=step;remaining-=step;
    if(target){const guard=(target.stats.echoBoss&&state.echoFight?.shield)||(target.stats.guard&&!(target.staggerUntil&&now<target.staggerUntil)),before=target.hp;damageEnemy(target,w.dmg,false,'windshot');if(activeMastery('pursuit')&&!guard&&!target.dead&&target.hp<before){state.pursuit={target,until:now+4};skillFx(target.root.position,0xffc862,1,'ready');toast('추격 표식! 4초 안에 같은 적을 일반 근접 타격');}const blocked=guard||target.hp===before;w.hits.add(target);state.lastWindHits=w.hits.size;skillFx(target.root.position,blocked?0xa4b5c0:w.pierce?0xffd36c:0xffe29b,1.2,'hit');if(!w.pierce||blocked||w.hits.size>=3){cancelWindshot(blocked?'guard':w.pierce?'pierce':'hit');break;}continue;}
    if(w.left<=.0001){cancelWindshot('range');break;}
  }
  if(state.windshot&&windVisual){windVisual.position.copy(w.pos);windVisual.rotation.y=Math.atan2(w.dir.x,w.dir.z);}
}

let pursuitVisual=null;
function updatePursuit(now){
 const m=state.pursuit;if(m&&!pursuitReady(m.target,now))state.pursuit=null;
 const show=state.pursuit&&!state.dead&&!state.dialog&&!state.menuOpen;
 if(show&&!pursuitVisual){const root=new THREE.Group(),mat=new THREE.MeshBasicMaterial({color:0xffcf68,transparent:true,opacity:.85,depthWrite:false});const ring=new THREE.Mesh(new THREE.TorusGeometry(.85,.055,6,32),mat);ring.rotation.x=Math.PI/2;ring.position.y=.15;root.add(ring);const gem=new THREE.Mesh(new THREE.OctahedronGeometry(.16),mat);gem.position.y=2.7;root.add(gem);const label=makeNameSprite('추격 표식');label.position.y=3.1;root.add(label);scene.add(root);pursuitVisual={root,ring,gem};}
 if(!pursuitVisual)return;pursuitVisual.root.visible=!!show;if(show){pursuitVisual.root.position.copy(state.pursuit.target.root.position);pursuitVisual.ring.scale.setScalar(1+.08*Math.sin(now*8));pursuitVisual.gem.rotation.y=now*2;}
}

// 감시자 고유 패턴: 고정된 붉은 원 예고 -> 지면파 -> 푸른 반격 시간.
function cancelWardenPulse(e) {
  e.pulseAt = 0; e.pulseRecover = 0;
  if (e.pulseRing) e.pulseRing.visible = false;
  if (e.pulseDisc) e.pulseDisc.visible = false;
}
function updateWardenPulse(e, dt, now) {
  if (!e.stats.ruinWarden) return false;
  if (state.dead || state.dialog) {
    cancelWardenPulse(e); e.pulseNext = now + 2;
    return false;
  }
  if (e.pulseRecover && now < e.pulseRecover) {
    e.mode = 'recover'; e.anim.play('idle'); e.anim.update(dt);
    return true;
  }
  if (e.pulseRecover) { cancelWardenPulse(e); }
  if (e.pulseAt) {
    e.mode = 'pulse'; e.anim.update(dt);
    if (now < e.pulseAt) {
      const k = Math.max(0, 1 - (e.pulseAt - now) / 1.5);
      e.pulseDisc.scale.setScalar(Math.max(0.05, k));
      e.pulseRing.material.opacity = 0.6 + 0.35 * Math.sin(now * 12) ** 2;
      return true;
    }
    const d = Math.hypot(state.player.position.x - e.pulseCenter.x, state.player.position.z - e.pulseCenter.z);
    const blocked = now < state.invUntil;
    const beforeHp = state.hp;
    if (d <= 4) {
      if (blocked) registerDodgeBlock(now);
      else {
        state.hp = Math.max(0, state.hp - Math.max(1, 28 - GEAR_DEF[state.gear.armor]));
        hitFlash(state.player); sfx('hurt', 0.9);
        if (state.hp <= 0) playerDie('감시자의 지면파');
      }
    }
    e.pulseResult = { inside: d <= 4, blocked, d: +d.toFixed(2), damage: beforeHp - state.hp, at: now };
    e.mode = 'recover'; e.pulseAt = 0; e.pulseRecover = now + 1.8; e.pulseNext = now + 5.5;
    e.pulseRing.material.color.setHex(0x5ee7ff); e.pulseRing.material.opacity = 0.9;
    e.pulseDisc.visible = false; e.pendingHit = 0; e.combo2 = 0;
    sfx('swing2', 0.8); toast(e.stats.echoBoss&&state.echoFight?.shield?'지면파 끝! 틈에 다음 봉인석으로 이동':'지면파 끝! 푸른 원이 보일 때 반격');
    return true;
  }
  const dist = e.root.position.distanceTo(state.player.position);
  if (dist < 8 && now >= (e.pulseNext || 0)) {
    if (!e.pulseRing) {
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xff5a42, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
      e.pulseRing = new THREE.Mesh(new THREE.RingGeometry(3.88, 4, 64), ringMat);
      e.pulseRing.rotation.x = -Math.PI / 2; scene.add(e.pulseRing);
      e.pulseDisc = new THREE.Mesh(new THREE.CircleGeometry(3.88, 64), new THREE.MeshBasicMaterial({color: 0xff7a43, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide}));
      e.pulseDisc.rotation.x = -Math.PI / 2; scene.add(e.pulseDisc);
    }
    e.pulseCenter = e.root.position.clone(); e.pulseCenter.y = 0.08;
    e.pulseRing.position.copy(e.pulseCenter); e.pulseDisc.position.copy(e.pulseCenter); e.pulseDisc.position.y = 0.07;
    e.pulseRing.material.color.setHex(0xff5a42); e.pulseRing.visible = true;
    e.pulseDisc.visible = true; e.pulseDisc.scale.setScalar(0.05);
    e.pulseAt = now + 1.5; e.pendingHit = 0; e.combo2 = 0; e.leapFrom = null;
    e.mode = 'pulse'; e.anim.playOnce('unarmed_melee_attack_punch', 'attack');
    toast('감시자 지면파! 붉은 원 밖으로 회피');
    return true;
  }
  return false;
}
// 칼날 말벌: 조준 고정 직선 돌진. 원형 지면파와 달리 옆으로 피한 뒤 추격 반격.
function cancelStormCharge(e) {
  e.stormAt = 0; e.stormRun = 0; e.stormRecover = 0;
  if (e.stormLine) e.stormLine.visible = false;
}
function segmentDistance(p, a, b) {
  const dx=b.x-a.x, dz=b.z-a.z, ll=dx*dx+dz*dz;
  const t=ll ? THREE.MathUtils.clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/ll,0,1) : 0;
  return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);
}
function updateStormCharge(e, dt, now) {
  if (!e.stats.stormWasp) return false;
  if (state.dead || state.dialog) { cancelStormCharge(e); e.stormNext=now+2; return false; }
  if (e.stormRecover && now < e.stormRecover) { e.mode='recover'; e.anim.play('idle'); e.anim.update(dt); return true; }
  if (e.stormRecover) cancelStormCharge(e);
  if (e.stormAt) {
    e.mode='aim'; e.anim.update(dt); e.stormLine.material.opacity=0.32+0.18*Math.sin(now*13)**2;
    if(now < e.stormAt) return true;
    e.stormAt=0; e.stormRun=now; e.stormHit=false; e.stormLine.material.opacity=0.65;
  }
  if (e.stormRun) {
    const prev=e.root.position.clone();
    const k=THREE.MathUtils.clamp((now-e.stormRun)/0.55,0,1);
    e.root.position.lerpVectors(e.stormFrom,e.stormTo,k); e.mode='charge';
    e.anim.play('running','run','walking','walk'); e.anim.update(dt);
    if (!e.stormHit && segmentDistance(state.player.position,prev,e.root.position)<=1.05) {
      e.stormHit=true; const blocked=now<state.invUntil, before=state.hp;
      if(blocked) registerDodgeBlock(now);
      else { state.hp=Math.max(0,state.hp-Math.max(1,25-GEAR_DEF[state.gear.armor])); hitFlash(state.player); sfx('hurt',0.9); if(state.hp<=0) playerDie('칼날 말벌의 돌진'); }
      e.stormResult={hit:true,blocked,damage:before-state.hp,at:now};
    }
    if(k>=1) {
      if(!e.stormHit) e.stormResult={hit:false,blocked:false,damage:0,at:now};
      e.stormRun=0; e.stormRecover=now+1.6; e.stormNext=now+6.5; e.mode='recover';
      e.stormLine.material.color.setHex(0x5ee7ff); e.stormLine.material.opacity=0.4;
      toast('칼날 돌진 끝! 푸른 띠가 보일 때 반격');
    }
    return true;
  }
  const p=state.player.position, dist=e.root.position.distanceTo(p);
  if(dist<10 && now>=(e.stormNext||0)) {
    const dir=p.clone().sub(e.root.position); dir.y=0;
    if(dir.lengthSq()<0.001) dir.set(0,0,1); dir.normalize();
    e.stormFrom=e.root.position.clone(); let length=Math.min(8,dist+2);
    // 예고 경로와 실제 경로 일치: 기존 충돌물 앞에서 끝나도록 사전 절단.
    for(let step=0.25;step<=length;step+=0.25) {
      const x=e.stormFrom.x+dir.x*step,z=e.stormFrom.z+dir.z*step;
      if(!onWorld({x,z}) || colliders.some(c=>Math.hypot(x-c.x,z-c.z)<c.r+0.8)) { length=Math.max(0,step-0.25); break; }
    }
    if(length<1) { e.stormNext=now+2; return false; }
    e.stormTo=e.stormFrom.clone().addScaledVector(dir,length);
    if(!e.stormLine) { e.stormLine=new THREE.Mesh(new THREE.PlaneGeometry(2.1,1),new THREE.MeshBasicMaterial({color:0xff4c4c,transparent:true,opacity:0.45,depthWrite:false,side:THREE.DoubleSide}));e.stormLine.rotation.x=-Math.PI/2;scene.add(e.stormLine); }
    e.stormLine.scale.set(1,length,1); e.stormLine.rotation.z=Math.atan2(dir.x,dir.z);
    e.stormLine.position.copy(e.stormFrom).addScaledVector(dir,length/2); e.stormLine.position.y=0.09;
    e.stormLine.material.color.setHex(0xff4c4c);e.stormLine.visible=true;
    e.root.rotation.y=Math.atan2(dir.x,dir.z);e.stormAt=now+1.2;e.pendingHit=0;e.combo2=0;e.leapFrom=null;
    if(e.tele) e.tele.visible=false;
    e.mode='aim';e.anim.play('idle');toast('칼날 말벌 돌진! 붉은 띠에서 옆으로 회피');return true;
  }
  return false;
}

// 독 개구리: 거리 유지 → 고정 조준 → 비유도 독침. 실제 이동 선분으로 피격/장애물 검사.
function cancelFrogSpit(e) {
  e.spitAt=0;e.spitLeft=0;e.spitRecover=0;
  if(e.spitLine)e.spitLine.visible=false;
  if(e.spitOrb)e.spitOrb.visible=false;
}
function updateFrogSpit(e,dt,now) {
  if(!e.stats.rangedSpit)return false;
  if(state.dead||state.dialog||state.menuOpen||e.dead){cancelFrogSpit(e);e.spitNext=now+1.5;e.mode='spitWait';e.anim.update(dt);return true;}
  if((e.hitUntil&&now<e.hitUntil)||(e.staggerUntil&&now<e.staggerUntil)){cancelFrogSpit(e);e.spitNext=now+1.5;return false;}
  const p=state.player.position;
  if(e.spitLeft>0){
    const from=e.spitOrb.position.clone(),step=Math.min(e.spitLeft,8*dt),to=from.clone().addScaledVector(e.spitDir,step);
    const wall=colliders.some(c=>segmentDistance(c,from,to)<c.r+.2);
    if(wall){e.spitLeft=0;e.spitOrb.visible=false;e.spitResult='wall';}
    else if(segmentDistance(p,from,to)<.65){
      e.spitLeft=0;e.spitOrb.visible=false;
      if(now<state.invUntil){registerDodgeBlock(now);e.spitResult='dodge';}
      else {const dmg=Math.max(1,e.stats.dmg-GEAR_DEF[state.gear.armor]);state.hp=Math.max(0,state.hp-dmg);hitFlash(state.player);sfx('hurt',.7);e.spitResult='hit';
        if(state.hp>0){state.poisonUntil=Math.max(state.poisonUntil,now+4);state.poisonTickAt=now+1;toast('독침에 맞았습니다! 물약(R)으로 해독');}else playerDie(e.stats.label);}
    }else {e.spitOrb.position.copy(to);e.spitLeft-=step;if(e.spitLeft<=0){e.spitOrb.visible=false;e.spitResult='miss';}}
  }
  if(e.spitAt){
    e.mode='spitAim';e.anim.play('idle');
    if(now>=e.spitAt){e.spitAt=0;e.spitLine.visible=false;
      if(!e.spitOrb){e.spitOrb=new THREE.Mesh(new THREE.SphereGeometry(.22,10,8),new THREE.MeshBasicMaterial({color:0xc3ff47}));scene.add(e.spitOrb);}
      e.spitOrb.position.copy(e.spitFrom);e.spitOrb.position.y=.65;e.spitOrb.visible=true;e.spitLeft=10;e.spitResult='flying';e.spitRecover=now+1.3;e.spitNext=now+4;e.anim.playOnce('attack');e.mode='spitRecover';
    }
    e.anim.update(dt);return true;
  }
  if(e.spitLeft>0){e.mode='spitRecover';e.anim.update(dt);return true;}
  if(now<(e.spitRecover||0)){e.mode='spitRecover';e.anim.update(dt);return true;}
  const dir=p.clone().sub(e.root.position);dir.y=0;const d=dir.length();if(d>=e.stats.aggro)return false;
  dir.normalize();e.root.rotation.y=Math.atan2(dir.x,dir.z);
  if(now>=(e.spitNext||0)&&d>1){
    e.spitDir=dir.clone();e.spitFrom=e.root.position.clone();e.spitAt=now+.9;e.pendingHit=0;e.combo2=0;e.mode='spitAim';
    if(e.tele)e.tele.visible=false;
    if(!e.spitLine){e.spitLine=new THREE.Mesh(new THREE.PlaneGeometry(1.3,10),new THREE.MeshBasicMaterial({color:0xc2ed54,transparent:true,opacity:.3,depthWrite:false,side:THREE.DoubleSide}));e.spitLine.rotation.x=-Math.PI/2;scene.add(e.spitLine);}
    e.spitLine.position.copy(e.spitFrom).addScaledVector(dir,5);e.spitLine.position.y=.08;e.spitLine.rotation.z=Math.atan2(dir.x,dir.z);e.spitLine.visible=true;e.anim.play('idle');e.anim.update(dt);return true;
  }
  if(d<3||d>6){const step=(d<3?-1:1)*e.stats.speed*dt*enemyMoveScale(e,now);const pos=e.root.position.clone().addScaledVector(dir,step);
    if(Math.abs(pos.x)<77&&Math.abs(pos.z)<77&&!colliders.some(c=>Math.hypot(pos.x-c.x,pos.z-c.z)<c.r+.55))e.root.position.copy(pos);
    e.mode=d<3?'spitRetreat':'chase';e.anim.play('jump','walking','walk');
  }else{e.mode='spitWait';e.anim.play('idle');}
  e.anim.update(dt);return true;
}

function updateEnemy(e, dt, now) {
  if (e.dead) {
    if (!e.trial && !e.denMob && !e.stats.noRespawn && now > e.respawnAt) respawnEnemy(e);
    e.anim.update(dt);
    return;
  }
  if(e.stats.windPractice){e.anim.update(dt);return;}
  if (updateMistEnemy(e,dt,now))return;
  if (updateBellEnemy(e,dt,now))return;
  if (updateArcher(e,dt,now))return;
  if (updateCartRaider(e,dt,now))return;
  if (updateFrogSpit(e, dt, now)) return;
  if (updateWardenPulse(e, dt, now)) return;
  if (updateStormCharge(e, dt, now)) return;
  if (e.hitUntil && now < e.hitUntil) { e.anim.update(dt); return; }
  if (e.staggerUntil && now < e.staggerUntil) { e.anim.update(dt); return; } // 가드 파괴 경직
  const p = state.player.position;
  const to = p.clone().sub(e.root.position); to.y = 0;
  const d = to.length();

  if (e.tele && e.tele.visible && e.teleUntil && now > e.teleUntil) e.tele.visible = false;
  if (e.stats.flee) {
    if (state.dead || state.dialog || d >= 14) { e.mode = 'wander'; }
    else {
      e.mode = 'flee';
      const away = e.root.position.clone().sub(p); away.y = 0;
      if (away.lengthSq() > 0.001) {
        away.normalize();
        e.root.position.addScaledVector(away, e.stats.speed * dt * enemyMoveScale(e, now));
        e.root.rotation.y = Math.atan2(away.x, away.z);
        e.anim.play('running', 'run', 'walking', 'walk', 'jump');
      }
      e.anim.update(dt);
      return;
    }
  }
  if (state.dead || state.dialog) {
    e.mode = 'wander';
    // 대화 중에는 공격 중단: 예고·예약 피격·돌진 취소 (닫히면 재추적)
    if (state.dialog && (e.pendingHit || e.combo2 || e.leapFrom)) { e.pendingHit = 0; e.combo2 = 0; e.leapFrom = null; if (e.tele) e.tele.visible = false; }
  }
  else if (d < e.stats.range && !observatoryBlocked(e.root.position,p)) {
    e.mode = 'attack';
    if (now >= e.cdUntil) {
      const dur = e.anim.clipDuration('unarmed_melee_attack_punch', 'attack') || 0.8;
      e.anim.playOnce('unarmed_melee_attack_punch', 'attack');
      e.atkUntil = now + Math.min(dur * 0.75, 0.7);
      e.cdUntil = now + e.stats.cd;
      const windup = e.stats.windup ?? dur * 0.45;
      e.pendingHit = now + windup;
      showTelegraph(e, windup); // 공격 예고: 회피할 틈을 줌
      if (e.stats.leap) {
        e.leapFrom = e.root.position.clone();
        e.leapTo = e.root.position.clone().addScaledVector(to.clone().normalize(), Math.min(e.stats.leap, Math.max(0, d - e.stats.range * 0.5)));
      }
      if (e.stats.combo) e.combo2 = now + windup + 0.35;
    }
    e.root.rotation.y = Math.atan2(to.x, to.z);
    if (e.leapFrom && e.pendingHit) {
      const windup = e.stats.windup ?? 0.5;
      const k = THREE.MathUtils.clamp(1 - (e.pendingHit - now) / windup, 0, 1);
      e.root.position.lerpVectors(e.leapFrom, e.leapTo, k);
      if (k >= 1) e.leapFrom = null;
    }
    if (e.pendingHit && now >= e.pendingHit) {
      e.pendingHit = 0;
      if (!state.dead && now >= state.invUntil && e.root.position.distanceTo(p) < e.stats.range + 0.4) {
        state.hp = Math.max(0, state.hp - Math.max(1, e.stats.dmg - GEAR_DEF[state.gear.armor]));
        (window.__dbgEnemyHits = window.__dbgEnemyHits || []).push({ t: +now.toFixed(2), invU: +state.invUntil.toFixed(2), d: +e.root.position.distanceTo(p).toFixed(2), blocked: 0, dmg: e.stats.dmg });
        hitFlash(state.player);
        sfx('hurt', 0.9);
        if (e.stats.poison && state.hp > 0) {
          const fresh = now >= state.poisonUntil;
          state.poisonUntil = now + 6; state.poisonTickAt = now + 1;
          if (fresh) toast('독에 중독되었습니다! 물약(R)으로 해독');
        }
        if (state.hp <= 0) playerDie(e.stats.label);
      } else if (!state.dead && now < state.invUntil && e.root.position.distanceTo(p) < e.stats.range + 0.4) {
        registerDodgeBlock(now); // 무적 중 피해 방지 확인용
        (window.__dbgEnemyHits = window.__dbgEnemyHits || []).push({ t: +now.toFixed(2), invU: +state.invUntil.toFixed(2), d: +e.root.position.distanceTo(p).toFixed(2), blocked: 1, dmg: 0 });
      }
    }
    if (e.combo2 && now >= e.combo2) {
      e.combo2 = 0;
      showTelegraph(e, 0.2);
      if (!state.dead && now >= state.invUntil && e.root.position.distanceTo(p) < e.stats.range + 0.5) {
        state.hp = Math.max(0, state.hp - Math.max(1, Math.ceil(e.stats.dmg / 2) - GEAR_DEF[state.gear.armor]));
        hitFlash(state.player);
        sfx('hurt', 0.7);
        if (state.hp <= 0) playerDie(e.stats.label);
      } else if (!state.dead && now < state.invUntil && e.root.position.distanceTo(p) < e.stats.range + 0.5) {
        registerDodgeBlock(now);
      }
    }
    e.anim.update(dt);
    return;
  } else if (d < e.stats.aggro) {
    e.mode = 'chase';
  } else {
    e.mode = 'wander';
  }

  if (e.mode === 'chase') {
    to.normalize();
    e.root.position.addScaledVector(to, e.stats.speed * dt * enemyMoveScale(e, now));
    e.root.rotation.y = Math.atan2(to.x, to.z);
    e.anim.play('running', 'run', 'walking', 'walk', 'jump');
  } else {
    e.angle += dt * 0.25;
    const wx = e.home.x + Math.cos(e.angle) * 6, wz = e.home.z + Math.sin(e.angle) * 6;
    const wdir = new THREE.Vector3(wx - e.root.position.x, 0, wz - e.root.position.z);
    if (wdir.length() > 0.3) {
      wdir.normalize();
      e.root.position.addScaledVector(wdir, 1.2 * dt * enemyMoveScale(e, now));
      e.root.rotation.y = Math.atan2(wdir.x, wdir.z);
    }
    e.anim.play('walking', 'walk', 'jump', 'idle');
  }
  e.anim.update(dt);
}

function playerDie(killerLabel) {
  state.dead = true;
  clearArchiveFight();
  clearCartRun();
  clearCourierFight();
  clearEstuaryFight();
  clearEchoFight();
  clearObservatoryFight();
  cancelWindshot('death');
  resetMasteryCombat();
  state.riposteUntil = 0;
  state.anim.playOnce('death_a');
  const over = document.getElementById('over');
  over.innerHTML = `쓰러졌습니다<br><span style="font-size:14px;font-weight:400">${killerLabel ? killerLabel + '의 공격이었습니다<br>' : ''}탭하면 마을에서 다시 일어납니다</span>`;
  over.style.display = 'flex';
}
function respawn() {
  state.dead = false; state.hp = state.maxHp;
  state.player.position.set(0, 0, 8);
  state.anim.play('Idle');
  document.getElementById('over').style.display = 'none';
}
document.getElementById('over').addEventListener('click', respawn);
document.getElementById('over').addEventListener('touchstart', respawn);

// ---------- 메인 루프 ----------
const clock = new THREE.Clock();
const hud = document.getElementById('hud');
const hpbar = document.getElementById('hpfill');
let fpsAcc = 0, fpsN = 0, fps = 0, fpsTimer = 0;
const WALK = 3.2, RUN = 6.5;

function tick() {
  requestAnimationFrame(tick);
  const frameElapsed = clock.getDelta(); // 제한 전 실제 프레임 간 경과 초
  const dt = Math.min(frameElapsed, 0.05); // 움직임 안정화용 시뮬레이션 dt
  const now = clock.elapsedTime;

  if (state.ready) {
    state.playTime = (state.playTime || 0) + dt;
    // 중독 DoT: 초당 2, 중독만으로는 쓰러지지 않음(최소 1HP)
    if (!state.dead && now < state.poisonUntil && now >= state.poisonTickAt) {
      state.poisonTickAt = now + 1;
      state.hp = Math.max(1, state.hp - 2);state.estuaryChannel=null;
    }
    let ix = 0, iz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    ix += stick.x; iz += stick.y;
    const manualMove = Math.hypot(ix, iz) > 0.05;
    if (state.dialog || state.menuOpen) { ix = 0; iz = 0; }
    // 공격 판정은 신규 공격 입력 처리보다 먼저: 초저FPS(프레임>재입력 간격)에서
    // 다음 tryAttack이 didHit을 리셋하기 전에 직전 공격의 판정을 반드시 해소한다
    if (!state.didHit && state.attackUntil > 0 && now > state.attackUntil - 0.35) {
      state.didHit = true;
      playerAttackHit();
    }
    // 자동 전투: 수동 이동 입력이 없을 때만 조향/공격 (수동이 항상 우선)
    if (state.autoOn && !state.dead && !state.dialog && !manualMove && now >= state.dodgeUntil) {
      const t = autoTarget();
      if (t) {
        const toT = t.root.position.clone().sub(state.player.position); toT.y = 0;
        const dT = toT.length();
        if (dT > PLAYER.range * 0.85) {
          const local = toT.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), -(camYaw + Math.PI));
          ix = local.x; iz = local.z;
        } else {
          state.heading = Math.atan2(toT.x, toT.z);
          state.player.rotation.y = state.heading;
          if (now >= state.attackCdUntil) {
            let near = 0;
            for (const e2 of state.enemies) { if (!e2.dead && e2.root.position.distanceTo(state.player.position) <= 2.8) near++; }
            if (hasSkill('whirl') && now >= state.whirlCdUntil && near >= 2) tryWhirl();
            else tryAttack(!!(t.stats.guard && !(t.staggerUntil && now < t.staggerUntil)));
          }
        }
        if (state.hp < state.maxHp * 0.35 && state.potions > 0) usePotion();
      }
    }
    const attacking = now < state.attackUntil;
    const m = Math.hypot(ix, iz);
    if (m > 1) { ix /= m; iz /= m; }

    const running = keys.has('ShiftLeft') || keys.has('ShiftRight') || (stick.active && m > 0.92);
    let speed = (!state.dead && !attacking && m > 0.05) ? (running ? RUN : WALK) * GEAR_SPD[state.gear.boots] * ((state.runes || []).includes('gale') ? 1.08 : 1) : 0; // 질주 룬 +8%
    // 회피 구르기 중: 구르기 방향으로 빠르게 이동, 다른 조작/공격 불가
    if (!state.dead && state.dodgeFrom && now < state.dodgeUntil + 0.5) {
      // 시전 순간의 보법으로 고정. 0.2m 이하로 나누어 벽/기둥을 뚫지 않고 이동한다.
      const form=state.dodgeFormAtCast||{duration:.45,distance:4};
      const k=Math.min(1,Math.max(0,(now-state.dodgeStart)/form.duration));
      const target=form.distance*k,delta=Math.max(0,target-(state.dodgeTravel||0)),steps=Math.max(1,Math.ceil(delta/.2));
      for(let i=0;i<steps;i++){state.player.position.addScaledVector(state.dodgeDir,delta/steps);resolveCollisions(state.player.position);clampWorld(state.player.position);}
      state.dodgeTravel=target;
      if (now >= state.dodgeUntil) state.dodgeFrom = null; // 창이 지난 첫 프레임에 최종 위치 확정
      speed = 0;
    }

    if (speed > 0) {
      const dir = new THREE.Vector3(ix, 0, iz).applyAxisAngle(new THREE.Vector3(0, 1, 0), camYaw + Math.PI);
      const targetHeading = Math.atan2(dir.x, dir.z);
      let dh = targetHeading - state.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      state.heading += dh * Math.min(1, dt * 12);
      state.player.rotation.y = state.heading;
      state.player.position.addScaledVector(dir, speed * dt * Math.min(1, m * 1.2));
      resolveCollisions(state.player.position);
      const d = Math.hypot(state.player.position.x, state.player.position.z);
      clampWorld(state.player.position);
      state.anim.play(running ? 'running' : 'walking');
      if (now >= audio.stepAt) {
        audio.stepAt = now + (running ? 0.27 : 0.36);
        audio.stepN = (audio.stepN + 1) % 4;
        sfx('step' + (audio.stepN + 1), running ? 0.35 : 0.28);
      }
    } else if (!attacking && !state.dead) {
      state.anim.play('Idle');
    }
    state.anim.update(dt);

    for (const e of state.enemies) {
      const ep=e.root.position;const old=ep.x>49&&ep.x<71&&ep.z>-5&&ep.z<15?ep.clone():null;updateEnemy(e, dt, now);
      if(e.estuary)clampWorld(e.root.position);
      if(e.stats.archiveGuard){resolveCollisions(e.root.position);e.root.position.x=Math.max(232,Math.min(288,e.root.position.x));e.root.position.z=Math.max(-30,Math.min(-13,e.root.position.z));}
      if(old&&colliders.some(c=>c.observatoryWall&&Math.hypot(e.root.position.x-c.x,e.root.position.z-c.z)<c.r+.5))e.root.position.copy(old);
    }
    updateFlowers(dt, now);
    updateChests();
    updateTreasure();
    updateDens();
    updateSwamp(now);
    updateWindshot(dt,now);
    updateSkillFx(now);
    updatePursuit(now);
    updateGolden(now);
    updateRings(dt);
    updateShrines(now);
    updateWatch();
    updateRuins();
    updateBossPlate();
    updateTrial(now);
    updateBeaconTrail();
    updateObservatory();
    updateEcho();
    updateCart(dt,now);
    updateCourier();
    updateEstuary(now);
    updateBell(now);
    updateMist(dt,now);
    updateArchive(now);
    updateWindPractice();
    checkAch();
    updateWeather(dt, now);

    // NPC들: 대기 애니메이션 + 근접 시 대화 프롬프트
    let npcNear = false;
    for (const n of [state.npc, state.npc2]) {
      if (!n) continue;
      n.anim.update(dt);
      const near = state.player.position.distanceTo(n.pos) < 2.6 && !state.dead;
      if (near) {
        npcNear = true;
        const to = state.player.position.clone().sub(n.pos);
        n.root.rotation.y = Math.atan2(to.x, to.z);
      }
    }
    const trialNear = state.trialStone && state.player.position.distanceTo(state.trialStone.root.position) <= 2.8 && !state.dead;
    const promptEl = document.getElementById('prompt');
    const arcNear=nearbyArchive();
    const mistNear=nearbyMist();
    const bellNear=nearbyBell();
    const estNear=nearbyEstuary();
    const courierNear=nearbyCourier();
    const cartNear=nearbyCart();
    const echoNear=nearbyEcho();
    const obsNear=nearbyObservatory();
    const sealNear = nearbySeal();
    const journeyNear = nearbyJourneySite();
    const beaconNear = nearbyBeacon();
    promptEl.textContent = npcNear ? 'E · 대화하기' : trialNear ? 'E · 시련의 돌' : arcNear ? `E · ${arcNear.name}` : mistNear ? `E · ${mistNear.name}` : bellNear ? `E · ${bellNear.name}` : estNear ? `E · ${estNear.name}` : courierNear ? `E · ${courierNear.name}` : cartNear ? 'E · 기록 운반 수레' : echoNear ? `E · ${echoNear.name}` : obsNear ? `E · ${obsNear.name}` : sealNear ? `E · ${sealNear.name}` : beaconNear ? `E · ${beaconNear.name}` : journeyNear ? `E · ${journeyNear.name}` : '';
    promptEl.style.display = (npcNear || trialNear || sealNear || journeyNear || beaconNear || obsNear || echoNear || cartNear || courierNear || estNear || bellNear || mistNear || arcNear) && !state.dialog ? 'block' : 'none';

    // 의뢰 HUD
    const qEl = document.getElementById('quest');
    const tr = state.trial;
    if (tr && tr.active) {
      qEl.style.display = 'block';
      qEl.innerHTML = `시련 · 웨이브 ${tr.wave} / ${TRIAL_WAVES.length} · 남은 적 ${tr.enemies.filter((e) => !e.dead).length}`;
    }
    else {
    // 추적 패널: 활성 의뢰를 모두 나열하고 추적 대상(내비 화살표)을 ▸로 표시. 패널 탭/N 키로 전환.
    const qd = QUESTS[state.quest.idx];
    const b = state.bounty;
    const pp2 = state.player.position;
    const lines = [];
    const distTo = (t) => t ? Math.round(Math.hypot(t.x - pp2.x, t.z - pp2.z)) + 'm' : '';
    const resolved = state.tracked === 'none' ? null : (state.tracked === 'quest' || state.tracked === 'bounty' || state.tracked === 'journey' || state.tracked === 'beacon') ? state.tracked : (qd ? 'quest' : (b && b.active ? 'bounty' : null));
    if (qd && state.quest.state === 'active') {
      const t = questTargetInner();
      lines.push(`${resolved === 'quest' ? '▸ ' : ''}의뢰 · ${qd.name} ${questProgress()} / ${qd.goal}${questProgress() >= qd.goal ? ' · 장로에게 보고 ' + distTo(t) : (t ? ' · ' + distTo(t) : '')}`);
    }
    if (b && b.active) {
      const goal = bountyGoal(b);
      const bp = Math.min(bountyProg(b), goal);
      const t = bountyTarget();
      lines.push(`${resolved === 'bounty' ? '▸ ' : ''}반복 의뢰 · ${b.kind === 'flowers' ? '바람꽃' : b.kind === 'variants' ? '변종 처치' : b.kind === 'elite' ? '엘리트 토벌' : b.kind === 'mats' ? b.mat + ' 납품' : '몬스터 처치'} ${bp} / ${goal}${bp >= goal ? ' · 장로에게 보고 ' + distTo(t) : (t ? ' · ' + distTo(t) : '')}`);
    }
    const bt=beaconTarget();if(bt)lines.push(`${state.tracked==='beacon'?'▸ ':''}원정 · ${bt.label} ${distTo(bt)}<br><span style="font-size:.85em">${beaconStatus()}</span>`);
    const arcNav=archiveTarget();if(arcNav)lines.push(`${state.tracked==='archive'?'▸ ':''}기록원 · ${state.archiveChannel?`조절 중 ${Math.max(0,2.5-(now-state.archiveChannel.start)).toFixed(1)}초`:archiveStatus()} ${distTo(arcNav)}`);
    const mistNav=mistTarget();if(mistNav)lines.push(`${state.tracked==='mist'?'▸ ':''}항로 · ${mistStatus()} ${distTo(mistNav)}`);
    const bellNav=bellTarget();if(bellNav)lines.push(`${state.tracked==='bell'?'▸ ':''}종 · ${bellStatus()} ${distTo(bellNav)}`);
    const est=estuaryTarget();if(est&&estuaryReady()&&state.estuary.stage<5)lines.push(`${state.tracked==='estuary'?'▸ ':''}여울 · ${state.estuaryChannel?`구조 중 ${Math.max(0,3-(now-state.estuaryChannel.start)).toFixed(1)}초`:estuaryStatus()} ${distTo(est)}`);
    const crt=courierTarget();if(crt)lines.push(`${state.tracked==='courier'?'▸ ':''}전령길 · ${courierStatus()} ${distTo(crt)}`);
    const ct=cartTarget();if(ct)lines.push(`${state.tracked==='cart'?'▸ ':''}호위 · ${cartStatus()} ${distTo(ct)}`);
    const et=echoTarget();if(et)lines.push(`${state.tracked==='echo'?'▸ ':''}잔향 · ${echoStatus()} ${distTo(et)}`);
    const ot=observatoryTarget();if(ot)lines.push(`${state.tracked==='observatory'?'▸ ':''}관측소 · ${ot.label} ${distTo(ot)}`);
    const jt = journeyTarget();
    if (jt) lines.push(`${state.tracked === 'journey' ? '▸ ' : ''}탐험 · 순례길 기록 ${Math.min(3,state.journey-1)}/3 · ${jt.label} ${distTo(jt)}`);
    if (lines.length) {
      qEl.style.display = 'block';
      const compactTargets=window.innerWidth>=560&&window.innerHeight<=500;
      const shown=compactTargets?[lines.find(line=>line.startsWith('▸ '))||lines[0]]:lines;
      qEl.innerHTML = shown.join('<br>') + `<br><span style="opacity:.65;font-size:.85em">${compactTargets&&lines.length>1?`다른 목표 ${lines.length-1}개 · `:''}탭·N: 추적 전환</span>`;
    } else if (!qd) {
      qEl.style.display = 'block';
      qEl.textContent = '모든 의뢰 완료';
    } else {
      qEl.style.display = 'none';
    }
    }

    // 카메라 (?cam=px,py,pz 고정 시점 — 촬영용)
    const p = state.player.position;
    if (fixedCam) {
      camera.position.set(fixedCam[0], fixedCam[1], fixedCam[2]);
      camera.lookAt(fixedCam[3] ?? p.x, fixedCam[4] ?? 1, fixedCam[5] ?? p.z);
    } else if (state.dialog && state.dlgFocus) {
      // 대화 구도: 플레이어와 NPC가 나란히 보이게 측면 카메라 (정면 접근 시 가려짐 방지)
      const f = state.dlgFocus;
      const mx = (p.x + f.x) / 2, mz = (p.z + f.z) / 2;
      const ddx = f.x - p.x, ddz = f.z - p.z;
      const dl = Math.hypot(ddx, ddz) || 1;
      const px = -ddz / dl, pz = ddx / dl;
      const side = (camera.position.x - mx) * px + (camera.position.z - mz) * pz >= 0 ? 1 : -1;
      const want = new THREE.Vector3(mx + px * 4.2 * side, 2.5, mz + pz * 4.2 * side);
      camera.position.lerp(want, Math.min(1, dt * 3.5));
      camera.lookAt(mx, 1.1, mz);
    } else {
      const portrait = innerWidth / innerHeight < 0.9;
      const dist = portrait ? 7.8 : 5.2;
      const h = (portrait ? 2.3 : 1.6) + Math.sin(camPitch) * (portrait ? 4.2 : 3.2);
      const head = new THREE.Vector3(p.x, 1.4, p.z);
      const want = new THREE.Vector3(
        p.x - Math.sin(camYaw) * Math.cos(camPitch) * dist, h,
        p.z - Math.cos(camYaw) * Math.cos(camPitch) * dist
      );
      // 장애물이 시야를 가리면 카메라를 앞으로 당김
      const full = want.distanceTo(head);
      const t = cameraClampT(head, want);
      const wantClamped = head.clone().addScaledVector(want.clone().sub(head), Math.max(t, Math.min(1, 1.3 / full)));
      camera.position.lerp(wantClamped, Math.min(1, dt * 8));
      // 러프 후 위치도 충돌체 안이면 다시 당김 (빠른 회전 시 관통 방지)
      const t2 = cameraClampT(head, camera.position);
      if (t2 < 1) camera.position.copy(head.clone().addScaledVector(camera.position.clone().sub(head), Math.max(t2, Math.min(1, 1.2 / Math.max(0.1, camera.position.distanceTo(head))))));
      camera.lookAt(p.x, p.y + (portrait ? 1.0 : 1.4), p.z);
      updateTreeFades(dt);
      updatePlayerFade(dt);
    }
    updateGuidance(now);
    updateTutorial();
    sun.position.set(p.x + 20, 30, p.z + 12);
    sun.target.position.copy(p);
    sun.target.updateMatrixWorld();

    const riposteLeft = Math.max(0, (state.riposteUntil || 0) - now);
    const pursuit=state.pursuit;
    const chain = state.masteryChain;
    const chainLive = chain && now <= chain.until && !chain.target.dead;
    const slowCount = state.enemies.filter(e=>!e.dead&&enemyMoveScale(e,now)<1).length;
    riposteHud.style.whiteSpace = 'pre-line';
    riposteHud.style.textAlign = 'center';
    riposteHud.style.display = (riposteLeft > 0 || chainLive || slowCount > 0 || pursuit) && !state.dead && !state.dialog && !state.menuOpen ? 'block' : 'none';
    riposteHud.textContent = [pursuit?`추격 · ${pursuit.target.stats.label} · ${Math.ceil(pursuit.until-now)}초 내 일반 타격`: '', riposteLeft > 0 ? `역풍 ${Math.ceil(riposteLeft)}초 · 근접 반격 시 체력+12` : '', chainLive ? `연격 ${chain.count}/3 · ${Math.ceil(chain.until-now)}초 내 같은 적` : '', slowCount ? `돌풍 · 일반 적 ${slowCount}마리 이동 감속` : ''].filter(Boolean).join('\n');
    hpbar.style.width = `${(state.hp / state.maxHp) * 100}%`;
    hpbar.style.background = now < state.poisonUntil ? '#a05ad0' : (state.hp > 40 ? '#5ad06a' : '#e05252');
    drawMinimap();
    // 골드/물약 표시
    const goldEl = document.getElementById('gold');
    goldEl.style.display = 'block';
    goldEl.textContent = `Lv ${state.level || 1} · 골드 ${state.gold}G` + (state.chestsOpened && state.chestsOpened.length ? ` · 보물 ${state.chestsOpened.length}/${CHESTS.length}` : '') + (state.mapFrags > 0 && !state.treasureDone ? ` · 지도 ${state.mapFrags}/3` : '') + (Object.keys(state.ach).length ? ` · 업적 ${Object.keys(state.ach).length}/${ACH.length}` : '');
    const potBtn = document.getElementById('pot');
    const potLabel = `물약 ${state.potions}`;
    if (potBtn.textContent !== potLabel) potBtn.textContent = potLabel;
    if(hasSkill('windshot')){windBtn.style.display='flex';const left=state.windCdUntil-now;windBtn.textContent=left>0?`${Math.ceil(left)}`:windTuneName();}
    const wh = document.getElementById('whirl');
    if (wh && hasSkill('whirl')) {
      wh.style.display = 'flex';
      const left = state.whirlCdUntil - now;
      const whLabel = left > 0 ? `${Math.ceil(left)}` : '회전베기';
      if (wh.textContent !== whLabel) wh.textContent = whLabel;
    }
  }

  renderer.render(scene, camera);

  fpsAcc += frameElapsed; fpsN++; fpsTimer += frameElapsed;
  if (fpsTimer > 0.5) {
    fps = fpsN / fpsAcc;
    window.__frameTiming = { frames: fpsN, elapsedSeconds: fpsAcc, fps, lastFrameMs: frameElapsed * 1000, simulationStepMs: dt * 1000 };
    fpsAcc = 0; fpsN = 0; fpsTimer = 0;
    hud.textContent = `실제 FPS ${fps < 1 ? '<1' : Math.round(fps)} · 드로콜 ${renderer.info.render.calls} · 삼각형 ${(renderer.info.render.triangles / 1000).toFixed(0)}k · 처치 ${state.kills}`;
    window.__fps = fps;
    window.__drawCalls = renderer.info.render.calls;
  }
  // 검증용 프로브
  window.__probe = state.ready ? {
    pos: state.player.position.toArray().map((v) => +v.toFixed(2)),
    anim: state.anim.current,
    hp: state.hp, maxHp: state.maxHp, dead: state.dead, kills: state.kills, dmg: PLAYER.dmg,
    quest: state.quest.state, qidx: state.quest.idx, qprog: questProgress(), dialog: state.dialog,
    tutDone: state.tutDone, tutStep: tut.step, markerOn: marker.visible, camDist: +camera.position.distanceTo(state.player.position).toFixed(2),
    gold: state.gold, potions: state.potions, level: state.level || 1, xp: state.xp || 0, xpNeed: xpNeed(state.level || 1), autoOn: state.autoOn, minimap: !mmap.classList.contains('off'), inv: now < state.invUntil, dodging: now < state.dodgeUntil, dodgeCount: state.dodgeCount, dodgeBlocks: state.dodgeBlocks || 0, order: state.order, orderDone: state.orderDone || 0,
    bossKills: state.bossKills, flowerCount: state.flowerCount, flowersSold: state.flowersSold || 0, mats: { ...state.mats }, weather: weather.mode, sky: scene.background.getHexString(), npc2: state.npc2 ? { x: state.npc2.pos.x, z: state.npc2.pos.z } : null,
    snakeKills: state.snakeKills || 0, kingSnakeKills: state.kingSnakeKills || 0, vials: state.vials || 0, waspKills: state.waspKills || 0, queenWaspKills: state.queenWaspKills || 0, bogSpiderKills: state.bogSpiderKills || 0, bogLordKills: state.bogLordKills || 0, bloodRatKills: state.bloodRatKills || 0, stormWaspKills: state.stormWaspKills || 0, rockSpiderKills: state.rockSpiderKills || 0, ruinSkelKills: state.ruinSkelKills || 0, ruinWarKills: state.ruinWarKills || 0, ruinWardenKills: state.ruinWardenKills || 0, ruinsFound: !!state.ruinsFound,
    chestsOpened: state.chestsOpened ? state.chestsOpened.length : 0, shrinesPrayed: state.shrinesPrayed ? state.shrinesPrayed.length : 0, trial: state.trial ? { active: state.trial.active, wave: state.trial.wave, alive: state.trial.enemies.filter((e) => !e.dead).length } : null, trialDone: state.trialDone || 0, bounty: state.bounty ? { ...state.bounty } : null,
    journey: { step: state.journey || 0, ending: state.journeyEnding || null, target: journeyTarget() },
    observatory: { step:state.observatory||0, fight:!!state.observatoryFight, alive:(state.observatoryFight||[]).filter(e=>!e.dead).length, target:observatoryTarget() },
    seal: { solved: !!state.sealSolved, input: [...(state.sealInput || [])] },
    runes: [...(state.runes || [])],
    mapFrags: state.mapFrags || 0, treasureDone: !!state.treasureDone, treasure: state.treasure ? { x: state.treasure.x, z: state.treasure.z } : null,
    dens: state.dens ? state.dens.map((d) => ({ name: d.name, cleared: d.cleared, spawned: d.spawned, alive: d.mobs.filter((e) => !e.dead).length })) : null, densCleared: (state.densCleared || []).length,
    golden: state.golden ? { active: !!state.golden.active, mode: state.golden.active ? state.golden.active.mode : null, pos: state.golden.active ? state.golden.active.root.position.toArray().map((v) => +v.toFixed(1)) : null, until: +state.golden.until.toFixed(1) } : null,
    gear: { ...state.gear }, effDmg: PLAYER.dmg + GEAR_ATK[state.gear.sword], speedMul: GEAR_SPD[state.gear.boots],
    achCount: Object.keys(state.ach).length, ach: { ...state.ach },
    flowersLeft: state.flowers ? state.flowers.filter((f) => !f.taken).length : null,
    bossHp: state.boss ? state.boss.hp : null, bossDead: state.boss ? state.boss.dead : null,
    bossPos: state.boss ? state.boss.root.position.toArray().map((v) => +v.toFixed(1)) : null,
    now: +clock.elapsedTime.toFixed(2), atkUntil: +(state.attackUntil || 0).toFixed(2), cdUntil: +(state.attackCdUntil || 0).toFixed(2), didHit: state.didHit,
    eliteKills: state.eliteKills || 0, dex: { ...state.dex },
    rings: state.rings ? state.rings.map((r) => ({ x: r.x, z: r.z, name: r.name, passed: r.passed })) : null, ringsDone: state.ringsPassed.length,
    watch: { found: !!state.watchFound, cleared: !!state.watchCleared, guardian: state.watch && state.watch.guardian ? { hp: state.watch.guardian.hp, dead: state.watch.guardian.dead, pos: state.watch.guardian.root.position.toArray().map((v) => +v.toFixed(1)) } : null },
    enemies: state.enemies.map((e) => ({ hp: e.hp, mode: e.mode, anim: e.anim.current, d: +e.root.position.distanceTo(state.player.position).toFixed(1), tele: !!(e.tele && e.tele.visible), elite: !!e.stats.elite, label: e.stats.label, pos: e.root.position.toArray().map((v) => +v.toFixed(1)) })),
  } : null;
  window.__camDbg = { pos: camera.position.toArray().map((v) => +v.toFixed(2)), fov: camera.fov, yaw: +camYaw.toFixed(2), pitch: +camPitch.toFixed(2), w: innerWidth, h: innerHeight };
}

addEventListener('resize', () => {
  applyCamFraming();
  renderer.setSize(innerWidth, innerHeight);
});

// 스크린샷 검증용: ?demo=walk|running 이면 자동 전진, ?tp=x,z 텔레포트, ?reset=1 세이브 초기화
const params = new URLSearchParams(location.search);
if (!params.has('debug')) document.getElementById('hud').style.display = 'none'; // FPS 등 디버그 표시는 ?debug=1에서만
if (innerWidth < 640) document.getElementById('msg').textContent = '스틱 이동 · 버튼 공격(길게 강공격) · 회피/물약 버튼 · 드래그 시점';
const demo = params.get('demo');
if (demo) setTimeout(() => keys.add('KeyW'), 1500);
if (demo === 'running') setTimeout(() => keys.add('ShiftLeft'), 1500);
const fixedCam = params.get('cam') ? params.get('cam').split(',').map(Number) : null;
const tp = params.get('tp');
if (tp) {
  const [tx, tz] = tp.split(',').map(Number);
  const iv = setInterval(() => {
    if (state.ready) { state.player.position.set(tx, 0, tz); clearInterval(iv); }
  }, 300);
}

build().catch((e) => {
  console.error(e);
  window.__loadError = String(e);
  const lo = document.getElementById('loading');
  if (lo) {
    lo.style.display = 'flex';
    lo.innerHTML = '<div class="ttl">불러오기에 실패했습니다</div><div id="loadmsg">네트워크 상태를 확인한 뒤 다시 시도해 주세요.</div><button id="retry">다시 시도</button>';
    const b = document.getElementById('retry');
    if (b) b.onclick = () => location.reload();
  }
});
tick();
