# AI-CM 설계정보 검토 보조 서비스

30억 미만 소규모 공사를 수행하는 중소 시공사를 위한 설계관리 리스크 1차 분류 서비스입니다.

이 서비스는 AI가 설계도서를 완벽하게 판정하는 도구가 아니라, 시공사가 먼저 확인해야 할 항목을 빠르게 찾도록 돕는 보조 도구입니다.

## 서비스 주소

- 웹 화면: https://ai-cm-review.vercel.app
- API 서버: https://ai-cm-production.up.railway.app
- 서버 상태 확인: https://ai-cm-production.up.railway.app/api/health

## 구현된 기능

### 1. 프로젝트 관리

- 프로젝트 생성
- 프로젝트 목록 조회
- 프로젝트별 파일과 검토 결과 분리 저장
- 공사명, 공사금액, 검토 범위 저장

### 2. 설계도서 파일 업로드

- 도면 파일 업로드
- 시방서 파일 업로드
- 내역서 파일 업로드
- Cloudflare R2에 파일 저장
- Railway API가 파일을 받아 Cloudflare R2에 저장
- 업로드 후 서버가 R2에서 파일을 다시 읽어 문서 내용을 추출

### 3. 문서 내용 추출

- Excel `.xlsx`, `.xlsm` 다중 시트 분석
- 내역서에서 공종, 품명, 규격, 단위, 수량, 단가, 금액, 비고 후보 추출
- PDF 일반 텍스트 추출
- 스캔 PDF OCR 추출
- 도면 이미지 `.jpg`, `.jpeg`, `.png`, `.webp` OCR 추출
- 한글 표준 XML 문서 `.hwpx` 본문 텍스트 추출
- 추출 결과를 PostgreSQL에 저장

### 4. 문서 간 비교 후보 생성

- 도면/시방서에는 있으나 내역서에 없는 항목 후보 표시
- 시방서 기준은 있으나 시험비 항목이 없는 경우 후보 표시
- 수량 차이 가능성이 있는 항목 후보 표시
- 텍스트 추출이 부족한 문서는 확인 필요 항목으로 분류

### 5. AI 검토 실행

- 선택한 프로젝트 기준으로 AI 검토 실행
- 프로젝트 정보, 파일 목록, 문서 추출 결과, 규칙 기반 후보를 OpenAI API에 전달
- 결과를 4개 카테고리로 정리
- 검토 결과를 PostgreSQL에 저장

### 6. 카테고리별 결과 출력

검토 결과는 아래 4개 카테고리로 나누어 보여줍니다.

- 설계도서 불일치
- RFI 후보
- 설계변경 검토
- 공사비 영향

### 7. 상세 검토 및 RFI 초안

- 검토 항목 상세 내용 표시
- 관련 문서 위치 표시
- 권장 조치 표시
- RFI 문안 초안 표시
- RFI 문안 복사 기능

## 서비스 구성

```text
사용자
  ↓
Vercel
  - index.html
  - styles.css
  - script.js
  ↓
Railway API Server
  - Express 서버
  - 프로젝트 API
  - 파일 업로드 API
  - 문서 추출 API
  - OCR 처리
  - 비교 후보 생성
  - AI 검토 API
  ↓
PostgreSQL
  - 프로젝트 정보
  - 업로드 파일 정보
  - 문서 추출 결과
  - AI 검토 결과
  ↓
Cloudflare R2
  - 도면
  - 시방서
  - 내역서
  ↓
OpenAI API
  - OCR
  - 설계관리 리스크 분류
  - RFI 초안 생성
```

## 기술 구성

- Frontend: HTML, CSS, JavaScript
- Hosting: Vercel
- Backend: Node.js, Express
- Backend Hosting: Railway
- Database: PostgreSQL
- File Storage: Cloudflare R2
- Document Parsing: JSZip, fast-xml-parser, pdf-parse
- OCR / AI: OpenAI API
- Source Control: GitHub

## 폴더 구조

```text
.
├─ index.html
├─ styles.css
├─ script.js
├─ package.json
├─ railway.json
├─ .env.example
└─ server
   └─ src
      ├─ index.js
      ├─ db.js
      ├─ r2.js
      ├─ extractor.js
      ├─ ocr.js
      ├─ comparison.js
      └─ openai.js
```

## Railway 환경변수

값은 GitHub에 올리지 말고 Railway 대시보드에 직접 등록합니다.

```text
DATABASE_URL
OPENAI_API_KEY
OPENAI_MODEL
OPENAI_OCR_MODEL
OCR_MAX_BYTES
UPLOAD_MAX_BYTES
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
R2_PUBLIC_URL
CORS_ORIGIN
```

권장 값:

```text
OPENAI_MODEL=gpt-4.1-mini
OPENAI_OCR_MODEL=gpt-4.1-mini
OCR_MAX_BYTES=20971520
UPLOAD_MAX_BYTES=50mb
CORS_ORIGIN=https://ai-cm-review.vercel.app
```

`OCR_MAX_BYTES`는 OCR 처리할 파일의 최대 크기입니다. 기본 예시는 20MB입니다.
`UPLOAD_MAX_BYTES`는 한 번에 업로드할 수 있는 파일의 최대 크기입니다. 기본 예시는 50MB입니다.

## 주요 API

### 상태 확인

```http
GET /api/health
```

정상 예시:

```json
{
  "ok": true,
  "service": "ai-cm-review-api",
  "database": "postgres",
  "r2Configured": true,
  "openAIConfigured": true
}
```

### 프로젝트

```http
GET /api/projects
POST /api/projects
GET /api/projects/:projectId
```

### 파일

```http
POST /api/projects/:projectId/files/presign
POST /api/projects/:projectId/files
POST /api/projects/:projectId/files/upload
```

### 검토 결과

```http
GET /api/projects/:projectId/document-extracts
GET /api/projects/:projectId/review-items
POST /api/projects/:projectId/reviews/run
```

## 로컬 실행

```bash
npm install
npm start
```

로컬 확인:

```bash
http://localhost:3000/api/health
```

## OCR 처리 방식

- 일반 PDF는 먼저 PDF 안에 들어 있는 텍스트를 직접 추출합니다.
- PDF에서 글자가 나오지 않으면 스캔 PDF로 보고 OpenAI OCR을 실행합니다.
- 도면 이미지 `.jpg`, `.jpeg`, `.png`, `.webp`는 OpenAI OCR을 실행합니다.
- OCR 결과는 문서 추출 결과로 저장되고, 이후 비교 후보 생성과 AI 검토에 사용됩니다.

## 현재 한계

- `.dwg` 같은 CAD 원본 파일의 선, 치수, 물량을 직접 해석하지는 않습니다.
- OCR은 이미지 품질, 해상도, 글자 크기에 따라 틀릴 수 있습니다.
- 큰 PDF는 비용과 처리 시간이 늘 수 있으므로 파일 분할이 필요할 수 있습니다.
- 구형 `.hwp`는 현재 직접 추출하지 않으며 `.hwpx` 또는 PDF 변환이 필요합니다.
- 실제 현장 적용 전에는 전문가 검토가 필요합니다.

## 다음 개발 과제

- 실제 OCR 결과를 화면에서 따로 확인하는 기능
- 도면 번호, 시트명, 위치 정보를 더 잘 나누는 기능
- OCR 신뢰도 낮은 항목을 별도로 표시하는 기능
- 검토 결과 Excel/PDF 다운로드
- RFI 문서 자동 생성
- 사용자 로그인과 회사별 권한 관리
