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
const mtlLoader = new MTLLoader();
const objLoader = new OBJLoader();
async function loadObj(base) {
  const mtl = await mtlLoader.loadAsync(`/assets/village/${base}.mtl`);
  mtl.preload();
  const obj = await objLoader.setMaterials(mtl).loadAsync(`/assets/village/${base}.obj`);
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.color) m.color.convertSRGBToLinear();
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
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'Space') { e.preventDefault(); tryAttack(); } });
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
  ready: false, player: null, anim: null, enemies: [],
  heading: 0, hp: 100, maxHp: 100, dead: false,
  attackUntil: 0, attackCdUntil: 0, didHit: false, kills: 0,
};
const ENEMY = { hp: 20, dmg: 5, speed: 2.4, aggro: 11, range: 1.7, cd: 1.4 };
const WARRIOR = { hp: 40, dmg: 8, speed: 2.8, aggro: 12, range: 1.8, cd: 1.2 };
const PLAYER = { dmg: 10, range: 2.4, arc: Math.PI * 0.6 };

function tryAttack() {
  if (!state.ready || state.dead) return;
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
    ['windmill', -14, -22, 0.4, 6.0], ['watermill', 16, -24, -2.2, 4.5],
    ['fountainRound', 0, -14, 0, 3.0],
    ['stallRed', -7, -10, 0.9, 2.2], ['stallGreen', 7, -10, -0.9, 2.2],
    ['cart', -12, -12, 0.6, 1.8], ['lantern', -3, -10, 0, 1.7], ['lantern', 3, -10, 0, 1.7],
    ['lantern', -10, -18, 0, 1.7], ['lantern', 10, -18, 0, 1.7],
    ['hedge', -16, -16, 0, 1.6], ['hedge', 16, -16, 0, 1.6],
  ];
  const townCache = {};
  await Promise.all(village.map(async ([name, x, z, rot, hMul]) => {
    try {
      if (!townCache[name]) townCache[name] = (await load(`/assets/town/${name}.glb`)).scene;
      const o = shadowify(townCache[name].clone());
      const sz = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
      const maxDim = Math.max(sz.x, sz.y, sz.z) || 2;
      o.scale.setScalar((knightH * hMul) / maxDim);
      o.position.set(x, 0, z);
      o.rotation.y = rot;
      scene.add(o);
    } catch (err) { console.warn('town load fail', name, err); }
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
    }
  });

  // 지하묘지 (KayKit Dungeon Remastered, CC0) — 북동쪽 (48, -48)
  await buildDungeon(48, -48);

  state.ready = true;
  window.__gameReady = true;
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
  };
}

// ---------- 던전 생성 ----------
async function buildDungeon(cx, cz) {
  const D = '/assets/dungeon/';
  const floorG = await load(`${D}floor_tile_large.gltf.glb`);
  const wallG = await load(`${D}wall.gltf.glb`);
  const ts = Math.max(...(() => { const s = new THREE.Box3().setFromObject(floorG.scene).getSize(new THREE.Vector3()); return [s.x, s.z]; })());
  const wallH = new THREE.Box3().setFromObject(wallG.scene).getSize(new THREE.Vector3()).y;
  const N = 8; // 타일 수 (N x N)
  const half = (N * ts) / 2;
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
  const doorI = Math.floor(N / 2);
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
    put(torchG, px, pz, 0, wallH * 0.9);
    const l = new THREE.PointLight(0xff9a3c, 6, ts * 5, 1.6);
    l.position.set(px, wallH * 1.1, pz);
    scene.add(l);
  }
  // 소품
  const props = [
    ['chest_gold.glb', 0, -half + inset, 0],
    ['barrel_small.gltf.glb', -half + inset, half - inset, 0],
    ['box_stacked.gltf.glb', half - inset, half - inset * 1.5, 0.4],
    ['table_medium.gltf.glb', -half + inset * 1.2, 0, Math.PI / 2],
    ['rubble_half.gltf.glb', half - inset, -half + inset, 0],
    ['coin_stack_medium.gltf.glb', 0.8, -half + inset + 0.6, 0],
  ];
  for (const [f, ox, oz, ry] of props) {
    try { put(await load(D + f), cx + ox, cz + oz, ry); } catch (e) { console.warn('prop', f, e); }
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
      const d = Math.hypot(state.player.position.x, state.player.position.z);
      if (d > 78) state.player.position.multiplyScalar(78 / d);
      state.anim.play(running ? 'running' : 'walking');
    } else if (!attacking && !state.dead) {
      state.anim.play('Idle');
    }
    state.anim.update(dt);

    for (const e of state.enemies) updateEnemy(e, dt, now);

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
    hp: state.hp, dead: state.dead, kills: state.kills,
    enemies: state.enemies.map((e) => ({ hp: e.hp, mode: e.mode, anim: e.anim.current, d: +e.root.position.distanceTo(state.player.position).toFixed(1) })),
  } : null;
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// 스크린샷 검증용: ?demo=walk|running 이면 자동 전진, ?tp=x,z 텔레포트
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
