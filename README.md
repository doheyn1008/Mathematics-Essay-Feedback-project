# 수식채점실

수학 시험과 손글씨 답안을 제출하고 첨삭 기록을 관리하는 앱입니다. **운영 앱은 `mathgrade-studio/` 하나입니다.** Cloudflare Workers + D1 + R2를 사용합니다.

## 로컬 실행과 검증

Node.js 22.13 이상을 사용합니다. CI는 Node.js 24에서 실행합니다.

```sh
npm run install:app
npm --prefix mathgrade-studio run db:migrate:local
npm run dev
```

`http://localhost:5173/`에서 확인합니다. `?demo=1`은 가상 데이터 체험입니다.

```sh
npm test
npm run check
npm run build
npm run deploy:check
```

루트 명령도 모두 `mathgrade-studio/`를 실행합니다. Worker와 정적 자산은 `mathgrade-studio/dist/`에 생성됩니다. 정적 HTML만 배포하면 API와 DB가 동작하지 않습니다.

## 배포

[Cloudflare 배포 안내](mathgrade-studio/docs/CLOUDFLARE_DEPLOYMENT.md)에 D1·R2 생성, 마이그레이션, 환경변수, Git 연결 빌드 설정과 `qed.it.kr` 연결 순서를 정리했습니다. GitHub Actions는 테스트·빌드·배포 모의 검사만 실행합니다.

일반 Workers가 기본 대상이며, 기존 ChatGPT Sites 경로는 `npm run dev:sites`와 `npm run build:sites`로 명시적으로 선택합니다. Sites 프로젝트 설정과 데이터는 자동 이전되지 않습니다.

자체 가입·로그인·파일 저장 기능이 구현되어 있습니다. 실제 AI 첨삭·결제·SMS·소셜 로그인은 각각 운영 연결이 필요합니다. Sites 기반 관리자 인증은 일반 Workers에서 비활성화됩니다. [앱 설명](mathgrade-studio/README.md)에서 동작 범위를 확인하세요.

## 초안 보관

이전 풀이결 초안은 [`archive/pulgyeol/`](archive/pulgyeol/)에 보관했습니다. 기본 실행·운영 빌드·CI에서 제외되며 Git 이력도 남아 있습니다. 초안만 살펴보려면 `npm --prefix archive/pulgyeol run dev`를 사용합니다.
