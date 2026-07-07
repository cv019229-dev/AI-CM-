# AI-CM 설계정보 검토 보조 서비스

30억 미만 소규모 공사를 수행하는 중소 시공사를 위한 설계관리 리스크 1차 분류 시제품입니다.

## 현재 구성

- 정적 웹 화면: `index.html`, `styles.css`, `script.js`
- Railway API 서버: `server/src`
- 프로젝트 저장: PostgreSQL 연결 시 DB 저장, 미설정 시 메모리 임시 저장
- 파일 저장: Cloudflare R2 사전 업로드 URL 발급
- AI 분석: OpenAI API 연결 시 검토 항목 생성

## 실행

```bash
npm install
npm start
```

서버 확인:

```bash
GET /api/health
```

## Railway 환경변수

값은 저장소에 올리지 말고 Railway 대시보드에 직접 등록합니다.

```text
DATABASE_URL
OPENAI_API_KEY
OPENAI_MODEL
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
R2_PUBLIC_URL
CORS_ORIGIN
```

## 주요 API

- `GET /api/health`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`
- `POST /api/projects/:projectId/files/presign`
- `POST /api/projects/:projectId/files`
- `GET /api/projects/:projectId/review-items`
- `POST /api/projects/:projectId/reviews/run`
