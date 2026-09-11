# V15.31.29 사용자 데이터 저장 구조

```text
코인나침반 App
      ↓
LocalUserDataStore  ← 현재 권위 저장소(offline-first)
      ↓
localStorage + memory mirror

[향후 선택]
LocalUserDataStore ↔ Cloud Sync Provider ↔ 사용자 계정 DB
```

## 원칙
1. 개인용 현재 버전은 로그인 없이 즉시 사용합니다.
2. 분석 코드가 브라우저 저장 API를 직접 호출하지 않습니다.
3. 네트워크이 없는 상황에서도 로컬 데이터로 앱이 계속 동작합니다.
4. 향후 계정 동기화는 `exportSnapshot()/importSnapshot()` 경계 위에 추가합니다.
5. `crypto_analyzer_mobile` namespace를 유지해 기존 데이터와 호환합니다.
6. Cloud Sync가 생겨도 로컬 저장소를 캐시가 아닌 offline-first 권위 계층으로 유지하는 것을 기본안으로 합니다.
