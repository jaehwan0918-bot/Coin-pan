# 코인나침반 V15.31.29 — Cloudflare Simplification Release

모바일 전용 개인용 가상자산 분석·판단 보조 PWA입니다.

## 이번 버전의 목적
V15.31.27의 분석 로직과 모바일 UI는 유지하고, 배포 구조만 단순화했습니다.

기존 구조:

`정적 PWA + Vercel API 함수 + Vercel 설정 + 인메모리 API 캐시`

현재 구조:

`Cloudflare Worker + Static Assets + Workers Cache API`

## 최종 구조
```text
coin-nachimpan/
├─ public/                 # PWA 정적 파일
│  ├─ index.html
│  ├─ app.js
│  ├─ styles.css
│  ├─ sw.js
│  ├─ manifest.json
│  ├─ _headers             # 정적 파일 보안 헤더
│  └─ icons/
├─ src/
│  └─ worker.mjs           # /api/candles, /api/health, /api/version
├─ wrangler.jsonc          # Cloudflare 배포 설정
├─ package.json
└─ tools/                  # E2E / Chaos / 통합 검증
```

## 유지된 기능
- Headline-first 모바일 홈
- 쉬운 한글 용어 + 상세 전문용어
- Entry Quality / Scenario / Strategy Edge
- Data Integrity / Safety Gate
- Forward Learning / Confidence Calibration / Regime Edge
- Safe Snapshot / 백업·복원
- 자동주문 없음
- 기존 내부 저장 namespace `crypto_analyzer_mobile` 유지

## 인프라 변경
- `vercel.json` 제거
- `api/*.js` Vercel 함수 제거
- API를 `src/worker.mjs` 하나로 통합
- API 캔들 캐시를 프로세스 `Map` 대신 `caches.default`로 변경
- PWA 파일을 `public/`로 정리
- 정적 보안 헤더를 `public/_headers`로 이동

Cloudflare Cache는 성능 최적화용입니다. 캐시 장애 시에도 Upbit 원본 조회로 계속 동작하도록 설계되어 있으며, 캐시 데이터가 손상되면 폐기하고 원본을 재조회합니다.


## 사용자 데이터 구조
로그인은 아직 사용하지 않습니다. 브라우저 저장 접근은 `LocalUserDataStore`로 격리했으며, 향후 계정 기능이 필요하면 현재 offline-first 저장소 위에 Cloud Sync Provider를 추가할 수 있습니다.
