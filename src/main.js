import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
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
const load = (url) => new Promise((res, rej) => gltfLoader.load(url, res, undefined, rej));
async function loadObj(base) {
  // 로더는 호출마다 새로 생성 (공유 시 병렬 로드에서 재질이 섞임)
  const mtlLoader = new MTLLoader();
  const objLoader = new OBJLoader();
  const mtl = await mtlLoader.loadAsync(`/assets/village/${base}.mtl`);
  mtl.preload();
  const obj = await objLoader.setMaterials(mtl).loadAsync(`/assets/village/${base}.obj`);
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        m.side = THREE.DoubleSide; // Quaternius OBJ 일부 면이 안쪽을 향해 컬링되는 문제 방지
        // Blender가 내보낸 MTL Kd는 이미 리니어 값 — 추가 sRGB 변환을 하면 지나치게 어두워짐
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

// ---------- 입력 ----------
const keys = new Set();
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'Space') { e.preventDefault(); tryAttack(); } if (e.code === 'KeyE') tryInteract(); });
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
document.getElementById('atk').addEventListener('touchstart', (e) => { e.stopPropagation(); tryAttack(); }, { passive: true });
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
  attackUntil: 0, attackCdUntil: 0, didHit: false, kills: 0,
  dialog: false,
  quest: { state: 'none', startKills: 0, goal: 3 }, // none → active → done
};
const ENEMY = { hp: 20, dmg: 5, speed: 2.4, aggro: 11, range: 1.7, cd: 1.4 };
const WARRIOR = { hp: 40, dmg: 8, speed: 2.8, aggro: 12, range: 1.8, cd: 1.2 };
const PLAYER = { dmg: 10, range: 2.4, arc: Math.PI * 0.6 };

// ---------- 충돌체 (원형 + 던전 벽) ----------
const colliders = []; // {x, z, r}
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

function tryAttack() {
  if (!state.ready || state.dead || state.dialog) return;
  const now = clock.elapsedTime;
  if (now < state.attackCdUntil) return;
  const dur = state.anim.clipDuration('slice_diagonal') || 0.7;
  state.anim.playOnce('slice_diagonal');
  state.attackUntil = now + Math.min(dur * 0.8, 0.7);
  state.attackCdUntil = now + Math.max(dur * 0.9, 0.5);
  state.didHit = false;
}

function hitFlash(root) {
  root.traverse((o) => {
    if (o.isMesh && o.material) {
      if (!o.userData.origMat) o.userData.origMat = o.material;
      o.material = o.userData.origMat.clone();
      o.material.emissive = new THREE.Color(0xff3322);
      o.material.emissiveIntensity = 0.8;
      setTimeout(() => { o.material = o.userData.origMat; }, 130);
    }
  });
}

function respawnEnemy(e) {
  const a = Math.random() * Math.PI * 2;
  e.root.position.copy(e.home).add(new THREE.Vector3(Math.cos(a) * 4, 0, Math.sin(a) * 4));
  e.hp = e.stats.hp; e.mode = 'wander'; e.dead = false;
  e.root.visible = true;
  e.anim.play('walking', 'idle');
}

// ---------- 월드 구성 ----------
async function build() {
  const knight = await load('/assets/characters/Knight.glb');
  const player = shadowify(knight.scene);
  const HIDE = ['1H_Sword_Offhand', '2H_Sword', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield'];
  player.traverse((o) => { if (HIDE.includes(o.name)) o.visible = false; });
  scene.add(player);
  state.player = player;
  state.anim = new AnimSet(player, knight.animations);
  state.anim.play('Idle');

  const skel = await load('/assets/characters/Skeleton_Minion.glb');
  const spawn = (gltf, stats, x, z) => {
    const root = shadowify(SkeletonUtils.clone(gltf.scene));
    root.position.set(x, 0, z);
    scene.add(root);
    const anim = new AnimSet(root, gltf.animations);
    anim.play('walking', 'idle');
    state.enemies.push({ root, anim, angle: Math.atan2(x, z), stats, home: new THREE.Vector3(x, 0, z), hp: stats.hp, mode: 'wander', dead: false, atkUntil: 0, cdUntil: 0, respawnAt: 0 });
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
      if (!townCache[name]) townCache[name] = (await load(`/assets/town/${name}.glb`)).scene;
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

  // 광장 돌길
  try {
    const road = (await load('/assets/town/road.glb')).scene;
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
    const fence = (await load('/assets/town/fence.glb')).scene;
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
  const natureGs = await Promise.all(natureFiles.map((f) => load(`/assets/nature/gltf/${f}.gltf`).catch((e) => { console.warn('nature load fail', f, e); return null; })));
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
      if (isTree) colliders.push({ x, z, r: 0.6 });
    }
  });

  // NPC 마을 장로 (KayKit Mage, CC0) — 광장 분수 옆
  try {
    const mage = await load('/assets/characters/Mage.glb');
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
  if (params.get('reset') === '1') localStorage.removeItem(SAVE_KEY);
  loadGame();
  window.__animNames = state.anim.names;
  window.__game = {
    teleportNearEnemy() {
      const e = state.enemies.find((x) => !x.dead);
      if (!e) return;
      state.player.position.copy(e.root.position).add(new THREE.Vector3(1.5, 0, 0));
      const to = e.root.position.clone().sub(state.player.position);
      state.heading = Math.atan2(to.x, to.z);
      state.player.rotation.y = state.heading;
    },
    heal() { state.hp = state.maxHp; if (state.dead) respawn(); },
    talk() { tryInteract(); },
    addKills(n) { state.kills += n; },
    save() { saveGame(); },
    teleport(x, z) { state.player.position.set(x, 0, z); },
    debug() { return { dungeon: { ...DUNGEON }, colliders, hp: state.hp, dead: state.dead, dialog: state.dialog }; },
  };
}

// ---------- NPC 대화 / 의뢰 ----------
const dlgEl = () => document.getElementById('dlg');
function questProgress() { return Math.min(state.kills - state.quest.startKills, state.quest.goal); }
function tryInteract() {
  if (!state.ready || state.dead || state.dialog || !state.npc) return;
  if (state.player.position.distanceTo(state.npc.pos) > 2.6) return;
  openDialog();
}
function openDialog() {
  state.dialog = true;
  const q = state.quest;
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
  if (q.state === 'none') {
    text.innerHTML = '유랑자여, 잘 왔네. 언덕에 스켈레톤이 들끓어 마을 사람들이 불안해하고 있네.<br>스켈레톤 <b>3마리</b>를 처치해주게. 사례는 하겠네.';
    mk('수락한다', '', () => { q.state = 'active'; q.startKills = state.kills; closeDialog(); saveGame(); });
    mk('나중에', 'sub', closeDialog);
  } else if (q.state === 'active' && questProgress() >= q.goal) {
    text.innerHTML = '스켈레톤 3마리를 모두 해치웠군! 마을이 자네 덕분에 한시름 놓았네.<br>약속한 사례일세: <b>최대 체력 100 → 130</b>.';
    mk('사례를 받는다', '', () => {
      q.state = 'done';
      state.maxHp = 130; state.hp = 130;
      closeDialog(); saveGame();
    });
  } else if (q.state === 'active') {
    text.innerHTML = `스켈레톤 처치를 부탁했었지. 현재 <b>${questProgress()} / ${q.goal}</b> 마리네.<br>조금만 더 힘내주게.`;
    mk('계속', '', closeDialog);
  } else {
    text.innerHTML = '덕분에 마을이 평온을 되찾았네. 언덕 저편 지하묘지에는 더 강한 스켈레톤 전사가 있다고 하니 조심하게.';
    mk('닫기', '', closeDialog);
  }
  dlgEl().style.display = 'block';
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
      hp: state.hp, maxHp: state.maxHp, kills: state.kills,
      heading: state.heading, quest: state.quest,
    }));
  } catch (e) { console.warn('save fail', e); }
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    state.player.position.set(s.x || 0, 0, s.z || 0);
    state.heading = s.heading || 0;
    state.player.rotation.y = state.heading;
    state.hp = s.hp ?? state.maxHp;
    state.maxHp = s.maxHp || 100;
    state.kills = s.kills || 0;
    if (s.quest) state.quest = s.quest;
  } catch (e) { console.warn('load fail', e); }
}
setInterval(() => { if (state.ready && !state.dead) saveGame(); }, 4000);

// ---------- 던전 생성 ----------
async function buildDungeon(cx, cz) {
  const D = '/assets/dungeon/';
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
  const war = await load('/assets/characters/Skeleton_Warrior.glb');
  state.spawn(war, WARRIOR, cx - ts, cz);
  state.spawn(war, WARRIOR, cx + ts, cz);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 전투 판정 ----------
function playerAttackHit() {
  const p = state.player.position;
  const fwd = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
  for (const e of state.enemies) {
    if (e.dead) continue;
    const to = e.root.position.clone().sub(p);
    const d = to.length();
    if (d > PLAYER.range) continue;
    if (fwd.angleTo(to.normalize()) > PLAYER.arc / 2) continue;
    e.hp -= PLAYER.dmg;
    hitFlash(e.root);
    if (e.hp <= 0) {
      e.dead = true; e.mode = 'dead';
      e.anim.playOnce('death_a');
      e.respawnAt = clock.elapsedTime + 6;
      state.kills++;
      setTimeout(() => { e.root.visible = false; }, 1600);
    } else {
      e.anim.playOnce('hit_a');
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

  if (state.dead) { e.mode = 'wander'; }
  else if (d < e.stats.range) {
    e.mode = 'attack';
    if (now >= e.cdUntil) {
      const dur = e.anim.clipDuration('unarmed_melee_attack_punch', 'attack') || 0.8;
      e.anim.playOnce('unarmed_melee_attack_punch', 'attack');
      e.atkUntil = now + Math.min(dur * 0.75, 0.7);
      e.cdUntil = now + e.stats.cd;
      e.pendingHit = now + dur * 0.45;
    }
    e.root.rotation.y = Math.atan2(to.x, to.z);
    if (e.pendingHit && now >= e.pendingHit) {
      e.pendingHit = 0;
      if (!state.dead && e.root.position.distanceTo(p) < e.stats.range + 0.4) {
        state.hp = Math.max(0, state.hp - e.stats.dmg);
        hitFlash(state.player);
        if (state.hp <= 0) playerDie();
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
    e.anim.play('running', 'walking');
  } else {
    e.angle += dt * 0.25;
    const wx = e.home.x + Math.cos(e.angle) * 6, wz = e.home.z + Math.sin(e.angle) * 6;
    const wdir = new THREE.Vector3(wx - e.root.position.x, 0, wz - e.root.position.z);
    if (wdir.length() > 0.3) {
      wdir.normalize();
      e.root.position.addScaledVector(wdir, 1.2 * dt);
      e.root.rotation.y = Math.atan2(wdir.x, wdir.z);
    }
    e.anim.play('walking', 'idle');
  }
  e.anim.update(dt);
}

function playerDie() {
  state.dead = true;
  state.anim.playOnce('death_a');
  document.getElementById('over').style.display = 'flex';
}
function respawn() {
  state.dead = false; state.hp = state.maxHp;
  state.player.position.set(0, 0, 0);
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
    if (state.dialog) { ix = 0; iz = 0; }
    const m = Math.hypot(ix, iz);
    if (m > 1) { ix /= m; iz /= m; }

    const attacking = now < state.attackUntil;
    if (attacking && !state.didHit && now > state.attackUntil - 0.35) {
      state.didHit = true;
      playerAttackHit();
    }

    const running = keys.has('ShiftLeft') || keys.has('ShiftRight') || (stick.active && m > 0.92);
    const speed = (!state.dead && !attacking && m > 0.05) ? (running ? RUN : WALK) : 0;

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
    } else if (!attacking && !state.dead) {
      state.anim.play('Idle');
    }
    state.anim.update(dt);

    for (const e of state.enemies) updateEnemy(e, dt, now);

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
    if (state.quest.state === 'active') {
      qEl.style.display = 'block';
      qEl.innerHTML = `의뢰 · 스켈레톤 처치 ${questProgress()} / ${state.quest.goal}${questProgress() >= state.quest.goal ? '<br>장로에게 돌아가기' : ''}`;
    } else if (state.quest.state === 'done') {
      qEl.style.display = 'block';
      qEl.textContent = '의뢰 완료 · 스켈레톤 처치';
    } else {
      qEl.style.display = 'none';
    }

    // 카메라
    const p = state.player.position;
    const dist = 5.2, h = 1.6 + Math.sin(camPitch) * 3.2;
    camera.position.lerp(new THREE.Vector3(
      p.x - Math.sin(camYaw) * Math.cos(camPitch) * dist, h,
      p.z - Math.cos(camYaw) * Math.cos(camPitch) * dist
    ), Math.min(1, dt * 8));
    camera.lookAt(p.x, p.y + 1.4, p.z);
    sun.position.set(p.x + 20, 30, p.z + 12);
    sun.target.position.copy(p);
    sun.target.updateMatrixWorld();

    hpbar.style.width = `${(state.hp / state.maxHp) * 100}%`;
    hpbar.style.background = state.hp > 40 ? '#5ad06a' : '#e05252';
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
    hp: state.hp, maxHp: state.maxHp, dead: state.dead, kills: state.kills,
    quest: state.quest.state, qprog: questProgress(), dialog: state.dialog,
    enemies: state.enemies.map((e) => ({ hp: e.hp, mode: e.mode, anim: e.anim.current, d: +e.root.position.distanceTo(state.player.position).toFixed(1) })),
  } : null;
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// 스크린샷 검증용: ?demo=walk|running 이면 자동 전진, ?tp=x,z 텔레포트, ?reset=1 세이브 초기화
const params = new URLSearchParams(location.search);
const demo = params.get('demo');
if (demo) setTimeout(() => keys.add('KeyW'), 1500);
if (demo === 'running') setTimeout(() => keys.add('ShiftLeft'), 1500);
const tp = params.get('tp');
if (tp) {
  const [tx, tz] = tp.split(',').map(Number);
  const iv = setInterval(() => {
    if (state.ready) { state.player.position.set(tx, 0, tz); clearInterval(iv); }
  }, 300);
}

build().catch((e) => { console.error(e); window.__loadError = String(e); });
tick();
