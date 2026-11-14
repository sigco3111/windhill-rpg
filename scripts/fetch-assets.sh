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
# 오디오 (sigco3111/assets-audio: Kenney zip은 루트 blob, chiptune은 릴리스)
AB="https://github.com/sigco3111/assets-audio"
fetch kenney-rpg-audio "$AB/raw/main/kenney_rpgaudio.zip"
fetch kenney-impact-sounds "$AB/raw/main/kenney_impactsounds.zip"
fetch kenney-music-jingles "$AB/raw/main/kenney_musicjingles.zip"
fetch chiptune-exploration "$AB/releases/download/v5.0/chiptune-exploration.zip"
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
cp "$E/Frog.fbx" "$E/Rat.fbx" "$E/Spider.fbx" "$E/Snake.fbx" "$E/Snake_angry.fbx" "$E/Wasp.fbx" public/assets/enemies/
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
# 오디오 선곡 복사 (게임이 사용하는 파일만)
mkdir -p public/assets/audio
RA=$(find "$TMP/kenney-rpg-audio" -type d -name Audio | head -1)
IA=$(find "$TMP/kenney-impact-sounds" -type d -name Audio | head -1)
cp "$RA/knifeSlice.ogg" "$RA/knifeSlice2.ogg" "$RA/handleCoins.ogg" "$RA/bookOpen.ogg" public/assets/audio/
cp "$IA/impactPunch_medium_000.ogg" "$IA/impactPunch_medium_001.ogg" \
   "$IA/impactPunch_heavy_000.ogg" "$IA/impactSoft_heavy_000.ogg" \
   "$IA/footstep_grass_000.ogg" "$IA/footstep_grass_001.ogg" \
   "$IA/footstep_grass_002.ogg" "$IA/footstep_grass_003.ogg" public/assets/audio/
cp "$TMP/chiptune-exploration/exploration files/exploration.ogg" public/assets/audio/
# 라이선스 사본 (각 팩 원문 그대로 배포 산출물에 포함)
cp "$TMP/kaykit-adventurers/LICENSE.txt" public/assets/characters/LICENSE-kaykit-adventurers.txt
cp "$TMP/kaykit-skeletons/LICENSE.txt" public/assets/characters/LICENSE-kaykit-skeletons.txt
cp "$N/License.txt" public/assets/nature/LICENSE-kaykit-forest-nature.txt
cp "$TMP/fantasy-town/fantasy-town-kit-1.0/License.txt" public/assets/town/LICENSE-fantasy-town-kit.txt
cp "$TMP/kaykit-dungeon/LICENSE.txt" public/assets/dungeon/LICENSE-kaykit-dungeon-remastered.txt
cp "$TMP/quaternius-village/License.txt" public/assets/village/LICENSE-quaternius-medieval-village.txt
cp "$TMP/easy-enemy/Easy Enemy Pack/LICENSE-SOURCE.txt" public/assets/enemies/LICENSE-easy-enemy-pack.txt
cp $(find "$TMP/kenney-rpg-audio" -iname 'License.txt' | head -1) public/assets/audio/LICENSE-kenney-rpg-audio.txt
cp $(find "$TMP/kenney-impact-sounds" -iname 'License.txt' | head -1) public/assets/audio/LICENSE-kenney-impact-sounds.txt
cp "$TMP/chiptune-exploration/LICENSE-SOURCE.txt" public/assets/audio/LICENSE-chiptune-exploration.txt
# 폰트: Noto Sans KR (Google Fonts, SIL OFL) — CSS API로 woff2를 받아 로컬 경로로 치환
mkdir -p public/fonts
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
curl -sSL -A "$UA" -o "$TMP/fonts-raw.css" "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap"
grep -o 'https://[^)]*\.woff2' "$TMP/fonts-raw.css" | sort -u | while read -r u; do
  curl -sSL -o "public/fonts/$(basename "$u")" "$u"
done
sed -E 's#url\(https://[^)]*/([^/)]+\.woff2)\)#url(\1)#g' "$TMP/fonts-raw.css" > public/fonts/fonts.css
echo "완료. 라이선스 사본은 각 assets 폴더의 LICENSE-* 파일을 참조하세요."
