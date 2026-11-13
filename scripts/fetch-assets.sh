#!/usr/bin/env bash
# 바람 언덕의 유랑자 - 에셋 내려받기
# 게임 저장소는 코드만 관리하고, 에셋은 sigco3111/assets-3d-lowpoly 릴리스에서 받는다.
# 사용 팩은 모두 CC0 (각 팩의 LICENSE.txt 참조).
set -euo pipefail
cd "$(dirname "$0")/.."
BASE='https://github.com/sigco3111/assets-3d-lowpoly/releases/download'
TMP=$(mktemp -d)

fetch() { # name url
  echo "== $1"
  curl -sSL -o "$TMP/$1.zip" "$2"
  mkdir -p "$TMP/$1"
  unzip -q -o "$TMP/$1.zip" -d "$TMP/$1"
}

fetch kaykit-adventurers "$BASE/v1.1/kaykit-adventurers-1.0.zip"
fetch kaykit-forest-nature "$BASE/v8.13/kaykit-forest-nature-pack.zip"
fetch fantasy-town "$BASE/v1.0/fantasy-town-kit-1.0.zip"
fetch kaykit-dungeon "$BASE/v1.1/kaykit-dungeon-remastered-1.0.zip"
fetch quaternius-village "$BASE/v4.0/quaternius-medieval-village.zip"
fetch easy-enemy "$BASE/v8.7/easy-enemy-pack.zip"
# KayKit Skeletons는 분할 zip이라 결합이 필요하다
curl -sSL -o "$TMP/s.zip"  "$BASE/v2.0/kaykit-skeletons-1.0.zip"
curl -sSL -o "$TMP/s.z01" "$BASE/v2.0/kaykit-skeletons-1.0.z01"
curl -sSL -o "$TMP/s.z02" "$BASE/v2.0/kaykit-skeletons-1.0.z02"
(cd "$TMP" && zip -q -s 0 s.zip --out s-full.zip)
mkdir -p "$TMP/kaykit-skeletons" && unzip -q -o "$TMP/s-full.zip" -d "$TMP/kaykit-skeletons"

mkdir -p public/assets/characters public/assets/nature/gltf public/assets/town public/fonts
cp "$TMP/kaykit-adventurers/addons/kaykit_character_pack_adventures/Characters/gltf/Knight.glb" public/assets/characters/
cp "$TMP/kaykit-adventurers/addons/kaykit_character_pack_adventures/Characters/gltf/Mage.glb" public/assets/characters/
cp "$TMP/kaykit-skeletons/addons/kaykit_character_pack_skeletons/Characters/gltf/Skeleton_Minion.glb" public/assets/characters/
cp "$TMP/kaykit-skeletons/addons/kaykit_character_pack_skeletons/Characters/gltf/Skeleton_Warrior.glb" public/assets/characters/
mkdir -p public/assets/village
cp "$TMP/quaternius-village/"*.obj "$TMP/quaternius-village/"*.mtl public/assets/village/
mkdir -p public/assets/enemies
E="$TMP/easy-enemy/Easy Enemy Pack/Easy Animated Enemy Pack - Jan 2019/FBX"
cp "$E/Frog.fbx" "$E/Rat.fbx" "$E/Spider.fbx" public/assets/enemies/
mkdir -p public/assets/dungeon
cp "$TMP/kaykit-dungeon/addons/kaykit_dungeon_remastered/Assets/gltf/"*.glb public/assets/dungeon/
N="$TMP/kaykit-forest-nature/KayKit_Forest_Nature_Pack_1.0_FREE"
cp $N/Assets/gltf/Tree_1_*.gltf $N/Assets/gltf/Tree_1_*.bin \
   $N/Assets/gltf/Tree_2_E_Color1.* \
   $N/Assets/gltf/Bush_1_*.gltf $N/Assets/gltf/Bush_1_*.bin \
   $N/Assets/gltf/Grass_1_*.gltf $N/Assets/gltf/Grass_1_*.bin public/assets/nature/gltf/
cp $N/Textures/forest_texture.png public/assets/nature/gltf/
T="$TMP/fantasy-town/fantasy-town-kit-1.0/Models/GLTF format"
for f in windmill watermill fountainRound fountainCenter stall stallRed stallGreen cart hedge hedgeCurved lantern road roadBend roadCorner fence fenceGate tree treeHigh planks poles; do
  cp "$T/$f.glb" public/assets/town/
done
# 폰트: Noto Sans KR (Google Fonts, OFL) — 별도 스크립트 없이 https://fonts.google.com/noto/specimen/Noto+Sans+KR 에서 받아 public/fonts에 둔다.
echo "완료. 라이선스 파일은 각 팩 폴더의 LICENSE.txt를 참조하세요."
