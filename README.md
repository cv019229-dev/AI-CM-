# AI-CM 설계정보 검토 보조 서비스

30억 미만 소규모 공사를 수행하는 중소 시공사를 위한 설계관리 리스크 1차 분류 서비스입니다.

이 서비스는 AI가 설계도서를 완벽하게 판정하는 시스템이 아니라, 시공사가 먼저 확인해야 할 위험 후보를 빠르게 정리하는 보조 도구입니다.

## 서비스 주소

- 웹 화면: https://ai-cm-review.vercel.app
- API 서버: https://ai-cm-production.up.railway.app
- 상태 확인: https://ai-cm-production.up.railway.app/api/health

## 구현된 기능

### 1. 프로젝트 관리

- 프로젝트 생성
- 프로젝트 목록 조회
- 프로젝트별 독립 데이터 관리
- 공사명, 공사금액, 검토 범위 저장

### 2. 설계도서 파일 업로드

- 도면 파일 업로드
- 시방서 파일 업로드
- 내역서 파일 업로드
- Cloudflare R2에 파일 저장
- Railway API에서 R2 업로드용 사전 서명 URL 발급
- 업로드 완료 후 서버가 R2에서 파일을 다시 읽어 문서 내용 추출

### 3. 문서 내용 추출

- 내역서 Excel `.xlsx`, `.xlsm` 다중 시트 분석
- 공종, 품명, 규격, 단위, 수량, 단가, 금액, 비고 후보 추출
- PDF 텍스트 추출
- 한글 표준 XML 문서 `.hwpx` 본문 텍스트 추출
- 텍스트가 없는 스캔 PDF는 OCR 필요 상태로 표시
- 추출 결과를 PostgreSQL에 저장

### 4. 문서 간 비교 후보 생성

- 도면·시방서에는 있으나 내역서에 없는 키워드 후보 탐지
- 시험·검사 기준은 있으나 시험비 항목이 없는 경우 후보 생성
- 시공 횟수 등 단순 불일치 후보 생성
- 스캔 PDF처럼 텍스트 추출이 안 된 문서는 확인 후보로 분류

### 5. AI 검토 실행

- 선택한 프로젝트 기준으로 AI 검토 실행
- 프로젝트 정보, 업로드 파일 목록, 문서 추출 결과, 규칙 기반 비교 후보를 OpenAI API에 전달
- AI가 검토 결과를 4개 카테고리로 정리
- 검토 결과를 PostgreSQL에 저장
- 검토 결과를 다시 화면에 표시

### 6. 카테고리별 결과 출력

검토 결과는 아래 4개 카테고리로 분리해 보여줍니다.

- 설계도서 불일치·누락
- RFI 후보
- 설계변경 검토
- 공사비 영향

### 7. 상세 검토 및 RFI 초안

- 검토 항목 클릭 시 상세 내용 표시
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
  - 설계관리 위험 후보 분류
  - RFI 초안 생성
```

## 기술 스택

- Frontend: HTML, CSS, JavaScript
- Hosting: Vercel
- Backend: Node.js, Express
- Backend Hosting: Railway
- Database: PostgreSQL
- File Storage: Cloudflare R2
- Document Parsing: JSZip, fast-xml-parser, pdf-parse
- AI: OpenAI API
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
      ├─ comparison.js
      └─ openai.js
```

## Railway 환경변수

값은 GitHub에 올리지 말고 Railway 대시보드에 직접 등록합니다.

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

권장 값:

```text
OPENAI_MODEL=gpt-4.1-mini
CORS_ORIGIN=https://ai-cm-review.vercel.app
```

`R2_PUBLIC_URL`은 R2 파일을 공개 URL로 직접 열어야 할 때 사용합니다. 공개 주소가 없으면 비워도 됩니다.

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

## 현재 한계

- 실제 PDF, HWP, Excel의 본문 추출은 아직 고도화 전입니다.
- Excel은 `.xlsx`, `.xlsm`의 여러 시트를 분석합니다.
- 한글 파일은 `.hwpx`를 우선 지원합니다.
- 구형 `.hwp`는 현재 직접 추출하지 않으며 `.hwpx` 또는 PDF 변환이 필요합니다.
- 스캔 도면 PDF는 OCR이 별도로 필요합니다.
- 프로젝트 삭제 기능은 아직 없습니다.
- 사용자 로그인 및 권한 분리는 아직 없습니다.
- 실제 현장 적용 전에는 전문가 검토가 필요합니다.

## 다음 개발 과제

- Excel 병합 셀, 복잡한 내역서 양식 분석 고도화
- PDF 본문 추출 정확도 개선
- 도면 OCR 또는 도면 텍스트 추출
- 구형 HWP 직접 추출 또는 변환 파이프라인
- 프로젝트 삭제 기능
- 사용자 로그인
- 회사별 프로젝트 권한 관리
- 검토 결과 Excel/PDF 다운로드
- RFI 문서 자동 생성
