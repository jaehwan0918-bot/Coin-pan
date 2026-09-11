# 코인나침반 V15.31.29 변경사항

## Offline-first UserDataStore 구조 정리
- 로그인 기능은 추가하지 않았습니다.
- `localStorage` 직접 접근을 `public/user-data-store.js`의 `LocalUserDataStore`로 격리했습니다.
- 앱 로직은 전용 저장 계층을 통해 설정, Forward Learning, 캐시, UI 프로필, Snapshot을 읽고 씁니다.
- native localStorage 장애 시 메모리 mirror로 현재 세션을 안전하게 유지합니다.
- 앱 namespace만 추출하는 `dumpNamespace()`와 향후 계정 동기화를 위한 `exportSnapshot()/importSnapshot()` 경계를 추가했습니다.
- 미래 로그인은 로컬 저장소를 제거하는 방식이 아니라 Cloud Sync 계층을 위에 추가하는 방향으로 설계했습니다.
- 기존 `crypto_analyzer_mobile` namespace와 사용자 데이터 형식은 유지합니다.

## 사용자 영향
현재 UI, 분석 로직, 자동매매 미지원 정책, 백업 형식은 그대로입니다. 로그인이나 회원가입 화면은 없습니다.
