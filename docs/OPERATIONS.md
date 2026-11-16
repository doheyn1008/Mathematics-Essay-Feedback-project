# 수식채점실 운영 가이드

이 저장소의 운영 앱은 `mathgrade-studio/`이다. 기본 배포 대상은 Cloudflare Workers + D1 + R2이며, 도메인은 `qed.it.kr`을 연결할 수 있다. 기존 Netlify 초안과 ChatGPT Sites 방문 권한·데이터가 자동으로 이전되지는 않는다.

**처음에는 코드 가져오기 → D1/R2 준비 → 첫 배포 → 내 계정 가입 → 관리자 지정 → 도메인 연결 순서로 진행한다.** 이 문서의 명령은 Windows의 VS Code 터미널(PowerShell)에서 실행할 수 있다.

## 1. 내 VS Code로 GitHub 코드 가져오기

Git, Node.js 24 LTS, VS Code를 설치한다. VS Code에서 터미널을 열어 확인한다.

```powershell
git --version
node --version
npm --version
```

원하는 프로젝트 폴더에서 처음 한 번만 clone한다. 아래 폴더 위치는 바꿔도 된다.

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\Documents\Projects" | Out-Null
Set-Location "$env:USERPROFILE\Documents\Projects"
git clone https://github.com/doheyn1008/Mathematics-Essay-Feedback-project.git
Set-Location Mathematics-Essay-Feedback-project
code .
```

`code` 명령이 없으면 VS Code의 **파일 → 폴더 열기**에서 방금 생성된 폴더를 연다. 이미 clone한 폴더가 있으면 다시 clone하지 않고 그 폴더에서 `git switch main`, `git pull --ff-only`로 갱신한다. 저장하지 않거나 커밋하지 않은 수정이 있으면 먼저 `git status`로 확인하고 보존한다.

## 2. 로컬에서 실행하기

아래 명령은 저장소 최상위 폴더에서 실행한다. 루트의 `npm run install:app`이 앱의 고정된 의존성을 설치한다.

```powershell
npm run install:app
npm --prefix mathgrade-studio run db:migrate:local
npm run dev
```

`http://localhost:5173/`을 연다. 가상 자료로 화면을 보려면 `http://localhost:5173/?demo=1`을 연다. 종료는 터미널에서 `Ctrl+C`다. 코드를 저장하면 개발 서버가 로컬 화면을 갱신한다. 로컬 회원과 파일은 운영 사이트의 DB·파일과 별개다.

확인 명령은 다음과 같다.

```powershell
npm test
npm run check
npm run build
npm run deploy:check
```

`build`는 파일을 만들고, `deploy:check`는 업로드 없이 패키징을 확인한다. 둘 다 실제 사이트를 배포하지 않는다. 일반 개발·배포에서는 기본 명령을 사용한다. 기존 Sites 환경을 선택할 때만 루트의 `npm run dev:sites`, `npm run build:sites`를 사용한다.

## 3. 내 계정에 관리자 권한 주기

이 단계는 아래 5번의 **첫 배포를 완료한 뒤** 진행한다. 관리자 권한은 GitHub 계정이나 ChatGPT 구독에 자동으로 붙지 않는다. 실제 수식채점실에 가입한 계정의 고유 회원 ID를 서버에 지정해야 한다. 일반 로컬 HTTP 개발 서버는 이 HTTPS 관리자 설정 대상이 아니다.

### 3-1. 실제 사이트에서 내 계정 가입

Cloudflare가 발급한 실제 `workers.dev` 주소에서 자체 아이디·비밀번호로 가입한다. 선생님·개인 등 계정 유형은 필요한 것을 선택한다. 관리자 권한과 유료 이용권은 이 유형과 별개다. 로컬 `localhost`나 `?demo=1`의 계정을 지정하면 운영 회원과 연결되지 않는다.

### 3-2. 내 고유 회원 ID 확인

아래 SQL은 `mathgrade-studio/`에서 실행한다. 현재 저장소 최상위라면 먼저 `Set-Location mathgrade-studio`를 실행하고, 이미 앱 폴더라면 그대로 진행한다. `your_login_id`를 방금 가입한 서비스 아이디로 바꾼다. 자체 로그인 아이디는 소문자로 저장된다.

```powershell
npx wrangler d1 execute DB --remote --config wrangler.json --command "SELECT c.user_id, c.username, u.name FROM product_credentials c JOIN product_users u ON u.id=c.user_id WHERE c.username='your_login_id';"
```

결과의 `user_id`를 복사한다. 비밀번호 해시나 로그인 쿠키를 읽거나 복사할 필요는 없다. 결과가 없다면 현재 연결한 DB와 가입한 사이트가 같은 환경인지 확인한다. Google·카카오 계정만 쓰는 경우에는 그 계정에 자체 로그인 아이디가 없을 수 있으므로 먼저 자신의 계정 연결 상태를 확인한다. 초기 관리자 설정에는 자체 아이디 가입을 권장한다.

### 3-3. 서버에 관리자 ID와 사이트 주소 지정

```powershell
npx wrangler secret put ADMIN_OWNER_USER_ID --config wrangler.json
```

입력 창에 앞에서 확인한 `user_id`를 붙여 넣는다. 이어서 `wrangler.json`의 기존 `vars`에 `ADMIN_SITE_ORIGIN`을 추가한다.

```json
"vars": {
  "DEPLOYMENT_TARGET": "cloudflare",
  "PRODUCT_HOST_LOGIN": "false",
  "ADMIN_SITE_ORIGIN": "https://실제-worker-주소.workers.dev"
}
```

`https://실제-worker-주소.workers.dev`는 반드시 현재 접속하는 실제 주소로 바꾼다. 나중에 도메인을 붙이면 `https://qed.it.kr`로 바꾼다. `/admin` 같은 경로나 끝의 `/`는 넣지 않는다. 설정은 HTTPS 원점과 정확히 일치해야 한다.

```powershell
npm run deploy
```

같은 사이트의 내 계정으로 로그인하고 메인의 **관리자 센터**를 누른다. 또는 `https://실제주소/admin`을 연다. 로그인 상태로 `https://실제주소/api/admin/access`를 열면 `{"allowed":true}`가 나와야 한다.

관리자를 해제하려면 서버의 `ADMIN_OWNER_USER_ID` secret을 삭제한다. 관리자를 교체하려면 새로 가입한 계정의 ID로 같은 secret을 바꾼다. 설정을 바꾼 뒤 실제 주소에서 접근 결과를 확인한다. 이 설정을 모르는 일반 회원은 이름·이메일·계정 유형을 바꾸어도 관리자가 되지 않는다.

## 4. 회원 관리하는 법

관리자 계정으로 `/admin`에 들어가면 다음을 할 수 있다.

| 작업 | 사용 방법 |
| --- | --- |
| 전체 회원 수 확인 | 전체·선생님·학원 학생·개인·유형 미등록 통계 확인 |
| 회원 찾기 | 이름 또는 서비스 아이디 검색, 계정 유형 필터, 페이지 이동 |
| 회원 상세 확인 | 목록에서 회원 선택, 가입 정보·전화번호 인증·이용권 확인 |
| 계정 유형 변경 | 상세의 서비스 계정 유형을 선택하고 저장 |

반 소속·이용권 부담 관계가 있거나 변경할 유형과 맞지 않는 활성 이용권이 있으면 유형 변경이 거부된다. 화면 안내에 따라 기존 관계부터 정리한다. 유형 변경 이력은 변경한 관리자와 함께 서버에 남는다.

현재 관리자 화면에는 회원 강제 삭제·비밀번호 열람·결제 환불·포인트/이용권 수동 지급 기능이 없다. **선생님 유형으로 바꾸는 것만으로 유료 이용권이나 관리자 권한이 생기지 않는다.** 실제 AI 첨삭·문자 발송·결제는 각각 후속 연결이 필요하다.

## 5. Cloudflare에 처음 배포하기

이 절의 명령은 `mathgrade-studio/`에서 실행한다. 앞 절을 따라 이미 이 폴더라면 다시 `cd mathgrade-studio`를 입력하지 않는다.

```powershell
npm ci
npx wrangler login
npx wrangler d1 create mathgrade-studio
npx wrangler r2 bucket create mathgrade-studio-uploads
```

D1 생성 결과의 실제 `database_id`를 `wrangler.json`의 예시 UUID 대신 넣는다. DB와 버킷 이름을 다르게 만들었다면 이름도 맞춘다. 바인딩 이름 `DB`, `BUCKET`은 유지한다. 이미 같은 자원을 만들어 둔 경우 새로 만들지 않고 기존 자원을 사용한다.

새 운영 DB에 SQL을 적용하고 배포한다.

```powershell
npm run db:migrate:remote
npm run deploy
```

기존 DB에 SQL을 수동 적용한 적이 있다면 마이그레이션 이력부터 확인한다. 새 DB는 기존 Sites 회원·첨삭·파일을 포함하지 않는다. 기존 데이터를 이어 쓰려면 DB와 R2 데이터를 별도로 이전해야 한다.

Wrangler가 출력한 `https://Worker이름.계정서브도메인.workers.dev`가 실제 접속 주소다. 이 주소에서 가입·로그인·파일 저장을 확인하고 3번의 관리자 지정 절차를 진행한다. AI·SMS·결제는 배포 성공만으로 연결되지 않는다. Workers 요금제는 로그인·PDF 처리 등 실제 사용량을 확인해 결정한다.

### `qed.it.kr` 연결

Cloudflare DNS에 도메인을 등록하고 안내된 네임서버로 가비아 설정을 맞춘다. 기존 메일·다른 서비스의 DNS 레코드는 보존한다. 해당 Worker의 **Settings → Domains & Routes → Custom Domain**에서 `qed.it.kr`을 연결한다.

이후 `wrangler.json`의 `ADMIN_SITE_ORIGIN`을 `https://qed.it.kr`로 바꾸고 다시 배포한다. 자체 회원 데이터는 같은 DB에 남아 있지만 새 도메인에서는 다시 로그인한다. Google·카카오를 연결했다면 제공자에 등록한 콜백 주소도 새 도메인의 `/api/product/auth/google/callback`, `/api/product/auth/kakao/callback`으로 맞춘다.

## 6. 코드를 고친 뒤 실제 사이트에 반영하기

| 한 일 | 어디에 반영되나 |
| --- | --- |
| 파일 수정·저장 | 로컬 개발 서버 화면 |
| `git commit` | 내 컴퓨터의 Git 이력 |
| `git push` | GitHub 브랜치 |
| PR 병합 | GitHub의 `main` |
| `npm run build` | 로컬 배포 파일 |
| `npm run deploy` 성공 | Cloudflare의 실제 사이트 |

**현재 저장소의 GitHub Actions는 검사만 한다. 병합만으로 Cloudflare에 자동 배포되는 것은 아니다.** 아래 수동 배포와 Cloudflare Git 연결 중 사용하는 방식을 기준으로 진행한다.

### 코드 수정과 GitHub 반영

저장소 최상위 폴더에서 시작한다.

```powershell
git switch main
git pull --ff-only
git switch -c feat/my-change
```

VS Code에서 수정·저장하고 로컬 화면을 확인한다.

```powershell
npm test
npm run check
npm run build
git status
git add .
git commit -m "Describe the change"
git push -u origin feat/my-change
```

GitHub에서 PR을 만들고 검사·리뷰를 확인한 뒤 병합한다. 브랜치 이름은 작업마다 새 이름을 사용한다. API 키·비밀번호·세션 쿠키는 소스에 적지 않고 Cloudflare secrets에 둔다.

### 수동으로 배포하는 경우

병합된 최신 코드로 배포한다. 이 명령도 저장소 최상위에서 시작한다.

```powershell
git switch main
git pull --ff-only
npm run deploy
```

의존성이나 `package-lock.json`이 바뀌었다면 배포 전에 `npm run install:app`을 실행한다. 새 SQL 마이그레이션이 있다면 배포 전에 `npm --prefix mathgrade-studio run db:migrate:remote`를 실행한다. 배포 성공 로그와 실제 주소의 변경 내용을 확인하면 끝이다. GitHub에 올리지 않은 로컬 수정도 `deploy`하면 올라가므로 배포할 커밋과 `git status`를 확인한다.

### Cloudflare에서 GitHub 자동 배포를 연결한 경우

Cloudflare Workers Builds에 같은 GitHub 저장소를 연결하고 다음처럼 지정한다.

| 설정 | 값 |
| --- | --- |
| 운영 브랜치 | `main` |
| Root directory | `mathgrade-studio` |
| Build command | `npm run build` |
| Deploy command | `node scripts/deploy-cloudflare.mjs` |

이 연결을 완료한 뒤에는 `main`에 변경이 들어오면 Cloudflare가 빌드·배포한다. 별도로 수동 배포할 필요 없이 Cloudflare의 Deployments에서 **해당 커밋의 배포 성공**을 확인한다. 이 설정은 GitHub Actions와 별개다. 원격 DB 마이그레이션은 자동 배포 명령에 포함되어 있지 않으므로 새 SQL은 먼저 적용한다. 프리뷰 브랜치는 운영 DB를 공유하지 않도록 별도 자원을 준비한 뒤 활성화한다.

기존 Netlify 프로젝트의 자동 배포는 Cloudflare 배포와 다르다. 실제 운영 주소는 Cloudflare에 연결하고, 사용하지 않는 Netlify 자동 배포는 별도로 중단한다.

## 7. 자주 막히는 부분

| 증상 | 확인할 것 |
| --- | --- |
| 관리자 메뉴가 안 보임 | 운영 계정의 `user_id`, `ADMIN_OWNER_USER_ID`, 현재 HTTPS 원점, 로그인 세션 |
| 관리자 API 403 | 관리자 설정 누락·주소 불일치 또는 다른 회원으로 로그인했는지 |
| 관리자 API 401 | 로그아웃·세션 만료 여부, 관리자 계정으로 다시 로그인 |
| 저장소 준비 중 / 테이블 없음 | 실제 D1 ID, `DB` 바인딩, 원격 마이그레이션 |
| 파일 저장 실패 | 실제 R2 버킷과 `BUCKET` 바인딩 |
| GitHub에는 바뀌었는데 사이트는 그대로 | Cloudflare 배포 여부, 배포 커밋과 실제 접속 도메인 |
| AI 첨삭 준비 중 | 아직 실제 AI 연결이 없는 현재 기능 범위 |

세부 설정: [Cloudflare 배포 문서](../mathgrade-studio/docs/CLOUDFLARE_DEPLOYMENT.md), [관리자 기능](../mathgrade-studio/docs/ADMIN.md).

외부 서비스 설정 참고: [Workers Builds 설정](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [D1 명령](https://developers.cloudflare.com/d1/wrangler-commands/), [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [사용자 지정 도메인](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
