# 코인나침반 V15.31.28 변경사항

## Cloudflare 통합
- Vercel Serverless API 제거
- `vercel.json` 제거
- `/api/candles`, `/api/health`, `/api/version`를 단일 Cloudflare Worker로 통합
- PWA 정적 파일을 `public/`로 정리
- `wrangler.jsonc` 추가

## Cache 단순화
- 기존 서버 프로세스 `Map` 캔들 캐시 제거
- Cloudflare `caches.default` 사용
- 캐시 장애 시 Upbit 원본 조회로 fail-open
- 손상된 cache payload는 사용하지 않고 원본 재조회
- 분석 결과의 안전성은 기존 프론트 Data Integrity Gate와 Worker 입력검증으로 이중 유지

## 유지된 부분
- 분석 알고리즘/판정 기준 변경 없음
- Headline-first UI 변경 없음
- 기존 `crypto_analyzer_mobile` namespace 유지
- 자동주문 기능 없음
- 유료 DB/유료 LLM 의존성 추가 없음

## 이전 주의
Cloudflare 주소가 기존 Vercel 주소와 다르면 localStorage는 자동 이전되지 않습니다.
기존 앱에서 백업 JSON 생성 후 새 Cloudflare 주소에서 복원해야 합니다.
