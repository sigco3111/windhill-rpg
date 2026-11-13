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
  keys.add(e.code);
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) state.chargeStart = performance.now(); // 누르고 있으면 강공격 충전
  }
  if (e.code === 'KeyE') tryInteract();
  if (e.code === 'KeyQ') tryDodge();
  if (e.code === 'KeyR') usePotion();
  if (e.code === 'KeyT') toggleAuto();
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
document.getElementById('dodge').addEventListener('touchstart', (e) => { e.stopPropagation(); tryDodge(); }, { passive: true });
document.getElementById('dodge').addEventListener('click', (e) => { e.stopPropagation(); tryDodge(); });
document.getElementById('pot').addEventListener('touchstart', (e) => { e.stopPropagation(); usePotion(); }, { passive: true });
document.getElementById('pot').addEventListener('click', (e) => { e.stopPropagation(); usePotion(); });
document.getElementById('auto').addEventListener('click', (e) => { e.stopPropagation(); toggleAuto(); });
document.getElementById('auto').addEventListener('touchstart', (e) => { e.stopPropagation(); toggleAuto(); }, { passive: true });
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
  bossKills: 0, flowers: null, flowerCount: 0, boss: null,
  bounty: { active: false, startKills: 0, count: 0 }, chests: null, chestsOpened: [],
  quest: { idx: 0, state: 'none', startKills: 0 }, // idx: QUESTS 순번, state: none → active → done
};
const ENEMY = { hp: 20, dmg: 5, speed: 2.4, aggro: 11, range: 1.7, cd: 1.4, skel: true, label: '스켈레톤', windup: 0.45, gold: 5, teleH: 1.9 };
const WARRIOR = { hp: 40, dmg: 8, speed: 2.8, aggro: 12, range: 1.8, cd: 1.2, skel: true, warrior: true, label: '스켈레톤 전사', windup: 0.55, combo: true, gold: 12, teleH: 2.1 };
const BOSS = { hp: 150, dmg: 12, speed: 2.6, aggro: 15, range: 2.2, cd: 1.5, skel: true, warrior: true, boss: true, label: '묘지의 왕', windup: 0.65, combo: true, gold: 60, teleH: 3.4 };
const PLAYER = { dmg: 10, range: 2.4, arc: Math.PI * 0.6 };
const FROG = { hp: 15, dmg: 3, speed: 2.0, aggro: 9, range: 1.4, cd: 1.6, label: '개구리', windup: 0.5, leap: 2.8, gold: 4, teleH: 1.1 };
const RAT = { hp: 10, dmg: 2, speed: 3.2, aggro: 8, range: 1.2, cd: 1.1, label: '쥐', windup: 0.28, gold: 3, teleH: 0.7 };
const SPIDER = { hp: 25, dmg: 6, speed: 2.6, aggro: 10, range: 1.5, cd: 1.5, label: '거미', windup: 0.6, gold: 6, teleH: 1.3 };

// ---------- 토스트 (짧은 알림) ----------
let toastTimer = 0;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 1500);
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
  state.attackStrong = strong;
  const dur = state.anim.clipDuration(strong ? '1h_melee_attack_chop' : 'slice_diagonal') || (strong ? 1.0 : 0.7);
  state.anim.playOnce(strong ? '1h_melee_attack_chop' : 'slice_diagonal');
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
  state.dodgeUntil = now + 0.45;
  state.dodgeCdUntil = now + 2.5;
  state.invUntil = now + 0.55;
  state.dodgeFrom = state.player.position.clone();
  state.dodgeStart = now;
  state.dodgeCount++;
  state.anim.playOnce('dodge_forward', 'dodge');
  sfx('step1', 0.6);
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
  const healed = Math.min(60, state.maxHp - state.hp);
  state.hp += healed;
  state.anim.playOnce('use_item');
  sfx('reward', 0.8);
  toast(`체력 +${healed}`);
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
  const spawn = (gltf, stats, x, z) => {
    const root = shadowify(SkeletonUtils.clone(gltf.scene));
    root.position.set(x, 0, z);
    scene.add(root);
    const anim = new AnimSet(root, gltf.animations);
    anim.play('walking', 'walk', 'jump', 'idle');
    const e = { root, anim, angle: Math.atan2(x, z), stats, home: new THREE.Vector3(x, 0, z), hp: stats.hp, mode: 'wander', dead: false, atkUntil: 0, cdUntil: 0, respawnAt: 0 };
    state.enemies.push(e);
    return e;
  };
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.8;
    spawn(skel, ENEMY, Math.cos(a) * 20, Math.sin(a) * 20);
  }
  state.spawn = spawn;


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
    ['Spider', SPIDER, 0.55, [[32, -14], [-30, -18]]],
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
      scene.add(inst);
    }
    // 숲 서식 몬스터 (개구리 2, 거미 2)
    const fbx2 = new FBXLoader();
    const forestMobs = [
      ['Frog', FROG, 0.42, [[-40, 24], [-50, 12]]],
      ['Spider', SPIDER, 0.55, [[-38, 10], [-52, 26]]],
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
        wrap.add(fbx);
        shadowify(wrap);
        for (const [x, z] of spots) spawn({ scene: wrap, animations: fbx.animations }, stats, x, z);
      } catch (err) { console.warn('forest mob fail', name, err); }
    }));
  } catch (e) { console.warn('forest fail', e); }

  // 바람꽃 (수집 의뢰) — 서쪽 숲에 8송이
  buildFlowers(-45, 18);
  // 보물상자 (탐험 요소) — 언덕 곳곳 5개
  buildChests();

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

  // 지하묘지 (KayKit Dungeon Remastered, CC0) — 북동쪽 (48, -48)
  await buildDungeon(48, -48);

  state.ready = true;
  window.__gameReady = true;
  const lo = document.getElementById('loading');
  if (lo) lo.style.display = 'none';
  if (params.get('reset') === '1') localStorage.removeItem(SAVE_KEY);
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
    heal() { state.hp = state.maxHp; if (state.dead) respawn(); },
    talk() { tryInteract(); },
    addKills(n) { state.kills += n; },
    setCounters(k, sk, w) { state.kills = k; state.skKills = sk; state.wKills = w; },
    save() { saveGame(); },
    teleport(x, z) { state.player.position.set(x, 0, z); },
    face(x, z) { const pp = state.player.position; state.heading = Math.atan2(x - pp.x, z - pp.z); state.player.rotation.y = state.heading; },
    invuln(sec) { state.invUntil = clock.elapsedTime + sec; },
    onlyEnemy(idx) { state.enemies.forEach((e, i) => { if (i !== idx) { e.dead = true; e.mode = 'dead'; e.respawnAt = 1e9; e.root.visible = false; if (e.tele) e.tele.visible = false; } }); },
    setCamYaw(v) { camYaw = v; },
    setHp(v) { state.hp = Math.max(0, Math.min(state.maxHp, v)); },
    setGold(v) { state.gold = Math.max(0, v); },
    setQuest(idx, st) { state.quest = { idx, state: st, startKills: st === 'active' ? questCounter({ idx }) : 0 }; applyProgression(); },
    setFlowers(n) { state.flowerCount = n; },
    flowerPos(i) { return state.flowers ? state.flowers[i].root.position.toArray() : null; },
    debug() { return { dungeon: { ...DUNGEON }, colliders, hp: state.hp, dead: state.dead, dialog: state.dialog }; },
  };
}

// ---------- NPC 대화 / 의뢰 ----------
// ---------- 의뢰(퀘스트) 체인 ----------
// 보상은 applyProgression()이 완료 idx 기준으로 재계산해 세이브 복원과 항상 일치
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
];
function questCounter(q) {
  const d = QUESTS[q.idx];
  if (!d) return 0;
  if (d.counter === 'skKills') return state.skKills || 0;
  if (d.counter === 'wKills') return state.wKills || 0;
  if (d.counter === 'fieldKills') return (state.kills || 0) - (state.skKills || 0); // 전사 포함 스켈레톤 제외
  if (d.counter === 'flowers') return state.flowerCount || 0;
  if (d.counter === 'bossKills') return state.bossKills || 0;
  return 0;
}
function applyProgression() {
  const done = state.quest.idx; // idx번째 미만은 완료된 의뢰
  state.maxHp = 100; PLAYER.dmg = 10;
  if (done >= 1) state.maxHp = 130;
  if (done >= 2) PLAYER.dmg = 14;
  if (done >= 3) state.maxHp = 160;
  if (done >= 5) state.maxHp = 190;
  state.hp = Math.min(state.hp, state.maxHp);
}

const dlgEl = () => document.getElementById('dlg');
function questProgress() { const d = QUESTS[state.quest.idx]; return d ? Math.min(questCounter(state.quest) - state.quest.startKills, d.goal) : 0; }
function tryInteract() {
  if (!state.ready || state.dead || state.dialog || !state.npc) return;
  if (state.player.position.distanceTo(state.npc.pos) > 2.6) return;
  openDialog();
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
  if (!d) {
    // 모든 의뢰 완료 후: 반복 현상금 의뢰
    const b = state.bounty;
    const reward = 35 + Math.min(b.count * 5, 25);
    if (b.active && state.kills - b.startKills >= 8) {
      text.innerHTML = `현상금 의뢰를 마쳤군! 몬스터 <b>8마리</b> 처치를 확인했네.<br>사례일세: <b>골드 ${reward}</b>.`;
      mk('사례를 받는다', '', () => { state.gold += reward; b.count++; b.active = false; sfx('reward', 1); closeDialog(); saveGame(); });
    } else if (b.active) {
      text.innerHTML = `현상금 의뢰: 몬스터 <b>${state.kills - b.startKills} / 8</b> 마리 처치했네.<br>조금만 더 힘내주게.`;
      mk('계속', '', closeDialog);
    } else {
      text.innerHTML = '마을의 모든 부탁을 들어주었네. 자네는 이제 이 언덕의 영웅일세.<br>바람 언덕에서 마음껏 유랑하게나.<br><br>언덕의 몬스터는 계속 불어나니, <b>현상금 의뢰</b>(몬스터 8마리 처치)도 맡아주면 고맙겠네.';
      mk('현상금을 받는다', '', () => { b.active = true; b.startKills = state.kills; sfx('dialog', 0.7); closeDialog(); saveGame(); toast('현상금 의뢰: 몬스터 8마리 처치'); });
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
      sfx('reward', 1);
      closeDialog(); saveGame();
    });
  } else if (q.state === 'active') {
    text.innerHTML = `${d.progress} 현재 <b>${questProgress()} / ${d.goal}</b> ${d.unit}네.<br>조금만 더 힘내주게.`;
    mk('계속', '', closeDialog);
  }
  mk('상점', 'sub', openShop);
  dlgEl().style.display = 'block';
}
const SHOP = { potionPrice: 30, potionMax: 5, potionHeal: 60 };
function openShop() {
  sfx('dialog', 0.5);
  const text = document.getElementById('dlg-text');
  const btns = document.getElementById('dlg-btns');
  document.getElementById('dlg-name').textContent = '마을 장로 · 상점';
  btns.innerHTML = '';
  const render = () => {
    text.innerHTML = `보유 골드: <b>${state.gold}G</b><br>체력 물약(회복 ${SHOP.potionHeal}): <b>${SHOP.potionPrice}G</b> · 보유 ${state.potions}/${SHOP.potionMax}개`;
    buyBtn.textContent = state.potions >= SHOP.potionMax ? '물약이 가득 찼습니다' : state.gold < SHOP.potionPrice ? '골드가 부족합니다' : `물약 구매 (${SHOP.potionPrice}G)`;
    buyBtn.disabled = state.potions >= SHOP.potionMax || state.gold < SHOP.potionPrice;
  };
  const buyBtn = document.createElement('button');
  buyBtn.addEventListener('click', () => {
    if (state.gold < SHOP.potionPrice || state.potions >= SHOP.potionMax) return;
    state.gold -= SHOP.potionPrice;
    state.potions++;
    sfx('reward', 1);
    toast('체력 물약을 샀습니다');
    saveGame();
    render();
  });
  btns.appendChild(buyBtn);
  const back = document.createElement('button');
  back.textContent = '돌아가기';
  back.className = 'sub';
  back.addEventListener('click', openDialog);
  btns.appendChild(back);
  render();
}
function closeDialog() {
  state.dialog = false;
  dlgEl().style.display = 'none';
}
document.getElementById('prompt').addEventListener('click', tryInteract);
document.getElementById('prompt').addEventListener('touchstart', (e) => { e.stopPropagation(); tryInteract(); }, { passive: true });

// ---------- 세이브 (localStorage) ----------
const SAVE_KEY = 'windhill-save';
function saveGame() {
  if (!state.ready) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      x: state.player.position.x, z: state.player.position.z,
      hp: state.hp, maxHp: state.maxHp, kills: state.kills, skKills: state.skKills || 0, wKills: state.wKills || 0,
      heading: state.heading, quest: state.quest, tutDone: state.tutDone,
      gold: state.gold, potions: state.potions, bossKills: state.bossKills || 0, flowerCount: state.flowerCount || 0,
      bounty: state.bounty, chestsOpened: state.chestsOpened || [],
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
    state.gold = s.gold || 0;
    state.potions = s.potions || 0;
    state.bossKills = s.bossKills || 0;
    state.flowerCount = s.flowerCount || 0;
    state.bounty = s.bounty || { active: false, startKills: 0, count: 0 };
    state.chestsOpened = s.chestsOpened || [];
    if (state.chests) state.chests.forEach((c, i) => { c.opened = state.chestsOpened.includes(i); c.beam.visible = !c.opened; });
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
];
async function buildChests() {
  try {
    const gl = await load('assets/dungeon/chest_gold.glb');
    const bb = new THREE.Box3().setFromObject(gl.scene);
    const sz = bb.getSize(new THREE.Vector3());
    const sc = 0.6 / (sz.y || 1);
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
      toast(`보물상자! +${c.gold} 골드 (${state.chestsOpened.length}/${CHESTS.length})`);
      state.anim.playOnce('pick_up', 'pick');
      saveGame();
    }
  }
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
  const q = state.quest, d = QUESTS[q.idx];
  const npcPos = { x: state.npc.pos.x, z: state.npc.pos.z, label: '마을 장로' };
  if (!d) {
    const b = state.bounty;
    if (!b || !b.active) return null;
    if (state.kills - b.startKills >= 8) return { ...npcPos, label: '장로에게 보고' };
    const bp = nearestEnemyPos(() => true);
    return bp ? { x: bp.x, z: bp.z, label: '현상금 사냥' } : null;
  }
  if (q.state !== 'active') return npcPos;
  if (questProgress() >= d.goal) return { ...npcPos, label: '장로에게 보고' };
  let pos = null;
  if (d.counter === 'skKills') pos = nearestEnemyPos((e) => e.stats.skel && !e.stats.warrior);
  else if (d.counter === 'fieldKills') pos = nearestEnemyPos((e) => !e.stats.skel);
  else if (d.counter === 'wKills') pos = nearestEnemyPos((e) => e.stats.warrior);
  else if (d.counter === 'flowers') pos = nearestFlowerPos();
  else if (d.counter === 'bossKills') pos = state.boss && !state.boss.dead ? state.boss.root.position : null;
  if (!pos) return null;
  return { x: pos.x, z: pos.z, label: d.name };
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
  const t = state.tutDone || state.quest.idx > 0 || state.quest.state === 'active' ? objectiveTarget() : (state.npc ? { x: state.npc.pos.x, z: state.npc.pos.z, label: '마을 장로' } : null);
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
function playerAttackHit() {
  window.__dbgHit = (window.__dbgHit || 0) + 1;
  const p = state.player.position;
  const fwd = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
  for (const e of state.enemies) {
    if (e.dead) continue;
    const to = e.root.position.clone().sub(p);
    const d = to.length();
    if (d > PLAYER.range) continue;
    if (fwd.angleTo(to.normalize()) > PLAYER.arc / 2) continue;
    const dmg = Math.round(PLAYER.dmg * (state.attackStrong ? 2.2 : 1));
    e.hp -= dmg;
    window.__dbgDmg = (window.__dbgDmg || 0) + 1;
    hitFlash(e.root);
    sfx(Math.random() < 0.5 ? 'hit1' : 'hit2', 0.9);
    if (state.attackStrong) {
      // 강공격 넉백
      const push = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
      e.root.position.addScaledVector(push, 1.4);
      const d0 = Math.hypot(e.root.position.x, e.root.position.z);
      if (d0 > 78) e.root.position.multiplyScalar(78 / d0);
    }
    if (e.hp <= 0) {
      e.dead = true; e.mode = 'dead';
      e.anim.playOnce('death_a', 'death');
      sfx('death', 0.9);
      e.respawnAt = clock.elapsedTime + (e.stats.boss ? 60 : 6);
      state.kills++;
      if (e.stats.skel) state.skKills++;
      if (e.stats.warrior) state.wKills++;
      if (e.stats.boss) state.bossKills++;
      const g = e.stats.gold || 3;
      state.gold += g;
      toast(`처치! +${g} 골드`);
      if (e.tele) e.tele.visible = false;
      setTimeout(() => { e.root.visible = false; }, 1600);
    } else {
      e.anim.playOnce('hit_a', 'hit');
      e.hitUntil = clock.elapsedTime + 0.4;
    }
  }
}

function updateEnemy(e, dt, now) {
  if (e.dead) {
    if (now > e.respawnAt) respawnEnemy(e);
    e.anim.update(dt);
    return;
  }
  if (e.hitUntil && now < e.hitUntil) { e.anim.update(dt); return; }
  const p = state.player.position;
  const to = p.clone().sub(e.root.position); to.y = 0;
  const d = to.length();

  if (e.tele && e.tele.visible && e.teleUntil && now > e.teleUntil) e.tele.visible = false;
  if (state.dead) { e.mode = 'wander'; }
  else if (d < e.stats.range) {
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
        state.hp = Math.max(0, state.hp - e.stats.dmg);
        (window.__dbgEnemyHits = window.__dbgEnemyHits || []).push({ t: +now.toFixed(2), invU: +state.invUntil.toFixed(2), d: +e.root.position.distanceTo(p).toFixed(2), blocked: 0, dmg: e.stats.dmg });
        hitFlash(state.player);
        sfx('hurt', 0.9);
        if (state.hp <= 0) playerDie(e.stats.label);
      } else if (!state.dead && now < state.invUntil && e.root.position.distanceTo(p) < e.stats.range + 0.4) {
        state.dodgeBlocks = (state.dodgeBlocks || 0) + 1; // 무적 중 피해 방지 확인용
        (window.__dbgEnemyHits = window.__dbgEnemyHits || []).push({ t: +now.toFixed(2), invU: +state.invUntil.toFixed(2), d: +e.root.position.distanceTo(p).toFixed(2), blocked: 1, dmg: 0 });
      }
    }
    if (e.combo2 && now >= e.combo2) {
      e.combo2 = 0;
      showTelegraph(e, 0.2);
      if (!state.dead && now >= state.invUntil && e.root.position.distanceTo(p) < e.stats.range + 0.5) {
        state.hp = Math.max(0, state.hp - Math.ceil(e.stats.dmg / 2));
        hitFlash(state.player);
        sfx('hurt', 0.7);
        if (state.hp <= 0) playerDie(e.stats.label);
      } else if (!state.dead && now < state.invUntil && e.root.position.distanceTo(p) < e.stats.range + 0.5) {
        state.dodgeBlocks = (state.dodgeBlocks || 0) + 1;
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
    e.root.position.addScaledVector(to, e.stats.speed * dt);
    e.root.rotation.y = Math.atan2(to.x, to.z);
    e.anim.play('running', 'run', 'walking', 'walk', 'jump');
  } else {
    e.angle += dt * 0.25;
    const wx = e.home.x + Math.cos(e.angle) * 6, wz = e.home.z + Math.sin(e.angle) * 6;
    const wdir = new THREE.Vector3(wx - e.root.position.x, 0, wz - e.root.position.z);
    if (wdir.length() > 0.3) {
      wdir.normalize();
      e.root.position.addScaledVector(wdir, 1.2 * dt);
      e.root.rotation.y = Math.atan2(wdir.x, wdir.z);
    }
    e.anim.play('walking', 'walk', 'jump', 'idle');
  }
  e.anim.update(dt);
}

function playerDie(killerLabel) {
  state.dead = true;
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
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = clock.elapsedTime;

  if (state.ready) {
    let ix = 0, iz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    ix += stick.x; iz += stick.y;
    const manualMove = Math.hypot(ix, iz) > 0.05;
    if (state.dialog) { ix = 0; iz = 0; }
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
          if (now >= state.attackCdUntil) tryAttack();
        }
        if (state.hp < state.maxHp * 0.35 && state.potions > 0) usePotion();
      }
    }
    const m = Math.hypot(ix, iz);
    if (m > 1) { ix /= m; iz /= m; }

    const attacking = now < state.attackUntil;
    // 저FPS에서 프레임이 판정 순간을 건너뛰어 공격이 헛나가지 않도록 1초 유예
    if (!state.didHit && state.attackUntil > 0 && now > state.attackUntil - 0.35 && now < state.attackUntil + 1.0) {
      state.didHit = true;
      playerAttackHit();
    }

    const running = keys.has('ShiftLeft') || keys.has('ShiftRight') || (stick.active && m > 0.92);
    let speed = (!state.dead && !attacking && m > 0.05) ? (running ? RUN : WALK) : 0;
    // 회피 구르기 중: 구르기 방향으로 빠르게 이동, 다른 조작/공격 불가
    if (!state.dead && state.dodgeFrom && now < state.dodgeUntil + 0.5) {
      // 시간 기반 보간: 프레임률과 무관하게 0.45초 동안 정확히 4m 이동 (저FPS에서 회피 거리 축소 방지)
      const k = Math.min(1, Math.max(0, (now - state.dodgeStart) / 0.45));
      state.player.position.copy(state.dodgeFrom).addScaledVector(state.dodgeDir, 4 * k);
      resolveCollisions(state.player.position);
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
      if (d > 78) state.player.position.multiplyScalar(78 / d);
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

    for (const e of state.enemies) updateEnemy(e, dt, now);
    updateFlowers(dt, now);
    updateChests();

    // NPC: 대기 애니메이션 + 근접 시 대화 프롬프트
    if (state.npc) {
      state.npc.anim.update(dt);
      const near = state.player.position.distanceTo(state.npc.pos) < 2.6 && !state.dead;
      document.getElementById('prompt').style.display = near && !state.dialog ? 'block' : 'none';
      if (near) {
        const to = state.player.position.clone().sub(state.npc.pos);
        state.npc.root.rotation.y = Math.atan2(to.x, to.z);
      }
    }

    // 의뢰 HUD
    const qEl = document.getElementById('quest');
    const qd = QUESTS[state.quest.idx];
    if (qd && state.quest.state === 'active') {
      qEl.style.display = 'block';
      qEl.innerHTML = `의뢰 · ${qd.name} ${questProgress()} / ${qd.goal}${questProgress() >= qd.goal ? '<br>장로에게 돌아가기' : ''}`;
    } else if (!qd) {
      const b = state.bounty;
      if (b && b.active) {
        const bp = Math.min(state.kills - b.startKills, 8);
        qEl.style.display = 'block';
        qEl.innerHTML = `현상금 · 몬스터 처치 ${bp} / 8${bp >= 8 ? '<br>장로에게 돌아가기' : ''}`;
      } else {
        qEl.style.display = 'block';
        qEl.textContent = '모든 의뢰 완료';
      }
    } else {
      qEl.style.display = 'none';
    }

    // 카메라 (?cam=px,py,pz 고정 시점 — 촬영용)
    const p = state.player.position;
    if (fixedCam) {
      camera.position.set(fixedCam[0], fixedCam[1], fixedCam[2]);
      camera.lookAt(fixedCam[3] ?? p.x, fixedCam[4] ?? 1, fixedCam[5] ?? p.z);
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
    }
    updateGuidance(now);
    updateTutorial();
    sun.position.set(p.x + 20, 30, p.z + 12);
    sun.target.position.copy(p);
    sun.target.updateMatrixWorld();

    hpbar.style.width = `${(state.hp / state.maxHp) * 100}%`;
    hpbar.style.background = state.hp > 40 ? '#5ad06a' : '#e05252';
    // 골드/물약 표시
    const goldEl = document.getElementById('gold');
    goldEl.style.display = (state.gold > 0 || state.potions > 0) ? 'block' : 'none';
    goldEl.textContent = `골드 ${state.gold}G` + (state.chestsOpened && state.chestsOpened.length ? ` · 보물 ${state.chestsOpened.length}/${CHESTS.length}` : '');
    const potBtn = document.getElementById('pot');
    const potLabel = `물약 ${state.potions}`;
    if (potBtn.textContent !== potLabel) potBtn.textContent = potLabel;
  }

  renderer.render(scene, camera);

  fpsAcc += dt; fpsN++; fpsTimer += dt;
  if (fpsTimer > 0.5) {
    fps = Math.round(fpsN / fpsAcc);
    fpsAcc = 0; fpsN = 0; fpsTimer = 0;
    hud.textContent = `FPS ${fps} · 드로콜 ${renderer.info.render.calls} · 삼각형 ${(renderer.info.render.triangles / 1000).toFixed(0)}k · 처치 ${state.kills}`;
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
    gold: state.gold, potions: state.potions, autoOn: state.autoOn, inv: now < state.invUntil, dodging: now < state.dodgeUntil, dodgeCount: state.dodgeCount, dodgeBlocks: state.dodgeBlocks || 0,
    bossKills: state.bossKills, flowerCount: state.flowerCount,
    chestsOpened: state.chestsOpened ? state.chestsOpened.length : 0, bounty: state.bounty ? { ...state.bounty } : null,
    flowersLeft: state.flowers ? state.flowers.filter((f) => !f.taken).length : null,
    bossHp: state.boss ? state.boss.hp : null, bossDead: state.boss ? state.boss.dead : null,
    bossPos: state.boss ? state.boss.root.position.toArray().map((v) => +v.toFixed(1)) : null,
    now: +clock.elapsedTime.toFixed(2), atkUntil: +(state.attackUntil || 0).toFixed(2), cdUntil: +(state.attackCdUntil || 0).toFixed(2), didHit: state.didHit,
    enemies: state.enemies.map((e) => ({ hp: e.hp, mode: e.mode, anim: e.anim.current, d: +e.root.position.distanceTo(state.player.position).toFixed(1), tele: !!(e.tele && e.tele.visible), pos: e.root.position.toArray().map((v) => +v.toFixed(1)) })),
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
