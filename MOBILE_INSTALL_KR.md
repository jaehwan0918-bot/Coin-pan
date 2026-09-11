# 코인나침반 V15.31.29 모바일 설치 / Cloudflare 배포

## 가장 쉬운 방법: GitHub → Cloudflare 자동배포
1. V15.31.29 Full ZIP을 풀고 전체 파일을 GitHub 저장소에 업로드합니다.
2. Cloudflare Dashboard → **Workers & Pages** → **Create application** → **Import a repository**로 들어갑니다.
3. 해당 GitHub 저장소를 선택합니다.
4. Worker 이름은 `wrangler.jsonc`와 동일하게 **coin-nachimpan**으로 사용합니다.
5. 별도 프레임워크 Build는 필요하지 않습니다. Deploy command는 기본값 `npx wrangler deploy`를 사용하면 됩니다.
6. Save and Deploy 후 발급된 HTTPS 주소에서 `/api/health`가 정상인지 확인합니다.
7. Android Chrome에서 해당 HTTPS 주소를 열고 PWA로 설치합니다.

## CLI 배포
Node.js/npm 환경이라면 프로젝트 루트에서:

```bash
npx wrangler deploy
```

로컬 미리보기:

```bash
npx wrangler dev
```

## V15.31.27에서 이전할 때 가장 중요한 점
브라우저의 localStorage와 Service Worker 데이터는 **origin(도메인) 단위**입니다.

- 기존과 동일한 사용자 도메인을 Cloudflare로 이전한다면 로컬 데이터가 그대로 이어질 수 있습니다.
- `*.vercel.app` → `*.workers.dev`처럼 주소가 바뀌면 기존 로컬 데이터가 자동 이동하지 않습니다.

따라서 주소가 바뀌는 이전에서는 먼저 기존 V15.31.27 앱에서:

**설정 → 데이터 관리 → 백업 JSON 생성**

후 Cloudflare판 V15.31.29에서 백업 JSON을 복원하세요.

## 배포 후 확인
- 화면 버전: `V15.31.29`
- `/api/health`: `ok: true`, `platform: cloudflare-workers`
- `/api/version`: `15.31.29`
- 실제 BTC/4H 새로고침 성공
- 앱 종료 후 재실행 시 설정/즐겨찾기 유지

실제 Android 알림, Wi-Fi↔LTE/5G 전환은 휴대폰 Live E2E에서 최종 확인해야 합니다.


## V15.31.29 저장 구조
로그인 기능은 없습니다. 기존 `crypto_analyzer_mobile` namespace를 그대로 사용하므로 동일 Cloudflare origin에서 V15.31.28 → V15.31.29 업데이트 시 기존 데이터가 유지됩니다.
