# Cloudflare Workers 배포

운영 소스는 `mathgrade-studio/`이며, 아래 명령은 이 폴더에서 실행합니다. 기본 대상은 일반 Workers입니다. GitHub PR을 병합해도 이 저장소의 Actions가 배포하지는 않습니다. 외부 호스팅에 연결한 자동 배포 설정은 별도로 확인합니다.

## 설정의 분리

| 대상 | 명령 | 설정과 인증 |
| --- | --- | --- |
| Cloudflare Workers | `npm run dev`, `npm run build` | `wrangler.json`, 자체 `mg_session` 회원 세션 |
| 기존 ChatGPT Sites | `npm run dev:sites`, `npm run build:sites` | `.openai/hosting.json`, Sites ingress·로컬 모의 인증·connector 도구 |

Workers 빌드에는 Sites 프로젝트 식별자와 connector preview 서비스가 포함되지 않습니다. Worker 진입점이 외부의 `oai-authenticated-user-*` 헤더를 제거하므로 임의의 ChatGPT 계정 사칭은 회원·관리자 인증이 되지 않습니다. 자체 아이디·비밀번호와 설정된 OAuth 로그인을 이용합니다.

기존 `/admin`은 신뢰된 Sites ingress 전용입니다. **이번 Workers 준비에는 관리자 인증 이전을 포함하지 않습니다.** `ADMIN_OWNER_EMAIL`, `ADMIN_SITE_ORIGIN`, `PRODUCT_HOST_LOGIN=true`를 Workers에 복사해 관리자 인증을 활성화하려고 하지 마세요. 회원 세션 기반의 별도 관리자 권한 또는 검증된 Cloudflare Access 연동은 후속 구현이 필요합니다. Sites 방문 제한 역시 Workers에 자동 적용되지 않습니다. 비공개 테스트가 필요하면 배포 전에 Cloudflare Access 등의 접근 제한을 설정합니다.

## 1. D1·R2 생성과 로컬 검사

```sh
npm ci
npx wrangler login
npx wrangler d1 create mathgrade-studio
npx wrangler r2 bucket create mathgrade-studio-uploads
```

출력된 D1 `database_id`를 `wrangler.json`의 0으로 시작하는 예시 UUID 대신 기록합니다. 계정·Worker·DB·버킷 이름을 변경했다면 같은 파일의 이름도 맞춥니다. ID는 비밀키가 아니며 자격증명은 커밋하지 않습니다. D1 `DB`와 R2 `BUCKET` 바인딩 이름은 앱 코드와 일치해야 합니다. 현재 설정에는 사용자 지정 도메인·유료 플랜 변경이 없습니다.

```sh
npm run db:migrate:local
npm test
npm run check
npm run build
npm run deploy:check
npm start
```

`npm start`는 빌드한 Worker를 로컬 Wrangler에서 실행합니다. 로컬 개발과 시작 명령은 `.wrangler/state`를 사용합니다. `drizzle/`의 SQL은 Wrangler migrations로 파일명 순서에 따라 적용되고 적용 이력은 D1에 기록됩니다. **기존 DB에 SQL을 수동 적용한 이력이 있다면 이력 테이블을 확인·조정하기 전 remote migrations를 실행하지 마세요.** 새 DB로 시작하는 경우 기존 Sites 회원·업로드·첨삭 기록은 없습니다. 기존 데이터를 이어 쓰려면 DB와 R2의 별도 백업·이전 계획이 필요합니다.

## 2. 환경변수와 실제 배포

OAuth 등 연결을 사용하는 경우 `wrangler secret put GOOGLE_CLIENT_ID`, `wrangler secret put GOOGLE_CLIENT_SECRET`처럼 필요한 값만 등록합니다. 로컬 값은 무시되는 `.dev.vars`에 둡니다. Google·카카오 콜백은 `https://실제주소/api/product/auth/google/callback`, `.../kakao/callback`입니다. 도메인을 바꾸면 제공자에 등록한 콜백도 갱신합니다. AI·SMS·결제는 키를 등록하는 것만으로 구현되지 않으며 기존 미연결 기능의 후속 작업이 필요합니다.

```sh
npm run db:migrate:remote
npm run deploy
```

`deploy`는 새로 빌드하고 Cloudflare용 산출물인지 확인한 뒤 Wrangler로 업로드합니다. 예시 D1 UUID가 남았거나 Sites 빌드이면 배포를 거부합니다. `deploy:check`는 자격증명 없이 패키징만 검사하며 DB·버킷의 실제 존재나 원격 기능을 확인하지 않습니다.

처음에는 Cloudflare가 반환한 `https://Worker이름.계정서브도메인.workers.dev` 주소로 확인합니다. 가입 → 로그인 → 새로고침 후 세션 유지 → 로그아웃, 허용된 시험/답안 업로드와 본인 파일 조회를 검증합니다. 다른 회원 파일 접근, 임의 ChatGPT 인증 헤더, `/api/admin/access` 접근이 거부되는지도 확인합니다. 유료 이용권·AI·문자 인증은 별도 연결 전에는 완료로 간주하지 않습니다.

## Git 연결 빌드

Cloudflare Workers Builds에서 저장소를 연결한다면 다음과 같이 지정합니다.

| 설정 | 값 |
| --- | --- |
| Root directory | `mathgrade-studio` |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Deploy command | `node scripts/deploy-cloudflare.mjs` |
| Production branch | `main` |

DB·R2 생성과 원격 마이그레이션을 먼저 수행합니다. 자동 프리뷰 배포는 별도 DB·버킷 구성을 마련한 뒤 사용합니다. 기존 Netlify 프로젝트가 계속 초안을 서비스한다면 자동 배포를 중단하거나 프로젝트를 분리합니다. 이 앱은 Netlify 정적 배포 대상으로 설정하지 않습니다.

## 3. `qed.it.kr` 연결

Workers 주소에서 검증을 마친 뒤, 도메인의 Cloudflare DNS zone을 준비하고 Worker의 Settings → Domains & Routes에서 Custom Domain을 추가합니다. 가비아에서 도메인을 다시 구매할 필요는 없습니다. DNS를 변경하기 전 기존 메일·다른 서비스 레코드를 보존합니다. 이 PR은 DNS나 도메인을 변경하지 않습니다.

## 기존 Sites 유지

Sites로 계속 빌드할 때는 `npm run build:sites` 또는 `MATHGRADE_DEPLOYMENT_TARGET=sites`를 설정합니다. 기존 `.openai/hosting.json`의 프로젝트 ID와 접근 범위는 유지합니다. 일반 Workers 배포 스크립트로 Sites 산출물을 업로드하지 않습니다. 기존 Sites 도구에서 직접 `vinext build`를 호출할 때도 위 환경변수가 필요합니다.

참고: [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/get-started/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
