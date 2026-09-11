# 코인나침반 Cloudflare 배포 가이드

## 배포 목표
Cloudflare 프로젝트 하나에서 다음을 함께 운영합니다.

- `public/`: PWA 정적 파일
- `src/worker.mjs`: API
- `caches.default`: Upbit 캔들 단기 캐시

D1, KV, R2, Durable Objects, Supabase는 현재 개인용 구조에 추가하지 않습니다.

## API
- `GET /api/candles?market=KRW-BTC&tf=240&count=200`
- `GET /api/health`
- `GET /api/version`

`/api/*`만 Worker를 먼저 실행하고, 나머지 PWA 파일은 Cloudflare Static Assets가 직접 제공합니다.

## 데이터 보존 정책
Forward Learning, 설정, 관심 코인, Snapshot/백업 메타데이터는 기존처럼 휴대폰 로컬 저장소를 사용합니다.
서버에 사용자 투자기록 DB를 새로 만들지 않습니다.

## Cache 정책
캔들 응답은 Workers Cache API를 사용합니다.
- TTL: 60초
- cache miss: Upbit Public API 조회
- cache match 오류: 원본 조회로 진행
- cache put 오류: 사용자 분석을 실패시키지 않음
- 손상 cache: 폐기 후 원본 재조회

Cache API는 정확성의 근거가 아니라 호출량/지연을 줄이는 최적화 계층입니다.

## 도메인 이전
기존 PWA 주소와 Cloudflare 주소가 달라지면 브라우저 localStorage가 분리됩니다.
주소 변경 전 반드시 기존 앱에서 백업 JSON을 만든 후 새 주소에서 복원하세요.
