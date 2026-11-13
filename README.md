# 바람 언덕의 유랑자 (windhill-rpg)

로우폴리 3D 오픈월드 탐험 RPG. 웹(Three.js)에서 바로 실행되는 3인칭 게임.

## 실행

```bash
npm install
./scripts/fetch-assets.sh   # 에셋 내려받기 (CC0 팩)
npm run dev                 # 개발 서버
npm run build               # 배포 빌드 (dist/)
```

## 조작

- WASD/화살표: 이동 · Shift: 달리기 · Space/클릭: 공격 · 드래그: 시점
- 모바일: 왼쪽 가상 조이스틱 이동, 오른쪽 드래그 시점, 빨간 버튼 공격

## 에셋 출처와 라이선스

에셋은 저장소에 포함하지 않고 `scripts/fetch-assets.sh`가
[sigco3111/assets-3d-lowpoly](https://github.com/sigco3111/assets-3d-lowpoly) 릴리스에서 내려받는다.

| 팩 | 제작자 | 라이선스 |
| --- | --- | --- |
| KayKit Adventurers | Kay Lousberg | CC0 |
| KayKit Skeletons | Kay Lousberg | CC0 |
| KayKit Forest Nature Pack | Kay Lousberg | CC0 |
| Fantasy Town Kit | Kenney | CC0 |
| KayKit Dungeon Remastered | Kay Lousberg | CC0 |
| Quaternius Medieval Village | Quaternius | CC0 (공식 팩 페이지 직접 확인) |
| Easy Enemy Pack | Quaternius | CC0 (공식 팩 페이지 직접 확인) |

UI 폰트: Noto Sans KR (Google Fonts, SIL OFL) — `public/fonts`에 둔다.
