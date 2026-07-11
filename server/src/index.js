import "dotenv/config";

import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  addProjectFile,
  createProject,
  deleteProjectFile,
  dbMode,
  getProjectFile,
  getProject,
  initDb,
  listDocumentExtracts,
  listProjectFiles,
  listProjects,
  listReviewItems,
  replaceReviewItems,
  saveDocumentExtract,
} from "./db.js";
import { buildComparisonCandidates } from "./comparison.js";
import { extractDocument } from "./extractor.js";
import {
  createUploadUrl,
  deleteObject,
  getObjectBuffer,
  isR2Configured,
  uploadObjectBuffer,
} from "./r2.js";
import { generateReviewItems, isOpenAIConfigured } from "./openai.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const app = express();
const port = Number(process.env.PORT || 3000);

const configuredCorsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
  : [];
const devCorsOrigins = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:5175",
  "http://localhost:5175",
];
const corsOrigins =
  configuredCorsOrigins.length > 0 ? [...configuredCorsOrigins, ...devCorsOrigins] : true;
const uploadLimit = process.env.UPLOAD_MAX_BYTES || "50mb";

app.use(cors({ origin: corsOrigins }));
app.use(express.json({ limit: "3mb" }));
app.use(express.static(rootDir));

async function extractFileInBackground(projectId, file) {
  try {
    const buffer = await getObjectBuffer(file.r2_key);
    const extract = await extractDocument(buffer, file);
    await saveDocumentExtract(projectId, file, extract);
  } catch (error) {
    await saveDocumentExtract(projectId, file, {
      status: "failed",
      extractedText: "",
      structuredData: {},
      warning: error.message || "문서 추출에 실패했습니다.",
    });
  }
}

app.get("/api/health", (_request, response) => {
  const requiredR2Variables = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
  ];

  response.json({
    ok: true,
    service: "ai-cm-review-api",
    database: dbMode(),
    r2Configured: isR2Configured(),
    openAIConfigured: isOpenAIConfigured(),
    config: {
      databaseUrl: Boolean(process.env.DATABASE_URL),
      openAiApiKey: Boolean(process.env.OPENAI_API_KEY),
      r2MissingVariables: requiredR2Variables.filter((name) => !process.env[name]),
    },
  });
});

app.get("/api/projects", async (_request, response, next) => {
  try {
    response.json({ projects: await listProjects() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects", async (request, response, next) => {
  try {
    const { name, amount, scope } = request.body;
    if (!name || !name.trim()) {
      return response.status(400).json({ error: "공사명을 입력해 주세요." });
    }

    const project = await createProject({
      name: name.trim(),
      amount: amount?.trim(),
      scope: scope?.trim(),
    });
    return response.status(201).json({ project });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/projects/:projectId", async (request, response, next) => {
  try {
    const project = await getProject(request.params.projectId);
    if (!project) {
      return response.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });
    }

    const files = await listProjectFiles(project.id);
    const documentExtracts = await listDocumentExtracts(project.id);
    const reviewItems = await listReviewItems(project.id);
    return response.json({ project, files, documentExtracts, reviewItems });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/projects/:projectId/files/presign", async (request, response, next) => {
  try {
    const project = await getProject(request.params.projectId);
    if (!project) {
      return response.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });
    }

    const { kind, filename, contentType } = request.body;
    if (!kind || !filename) {
      return response.status(400).json({ error: "파일 종류와 파일명이 필요합니다." });
    }

    const upload = await createUploadUrl({
      projectId: project.id,
      kind,
      filename,
      contentType,
    });
    return response.json({ upload });
  } catch (error) {
    return next(error);
  }
});

app.post(
  "/api/projects/:projectId/files/upload",
  express.raw({ type: "*/*", limit: uploadLimit }),
  async (request, response, next) => {
    try {
      const project = await getProject(request.params.projectId);
      if (!project) {
        return response.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });
      }

      const kind = String(request.query.kind || "");
      const name = String(request.query.filename || "");
      if (!kind || !name) {
        return response.status(400).json({ error: "파일 종류와 파일명이 필요합니다." });
      }

      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        return response.status(400).json({ error: "업로드할 파일 내용이 없습니다." });
      }

      const upload = await uploadObjectBuffer({
        projectId: project.id,
        kind,
        filename: name,
        contentType: request.headers["content-type"] || "application/octet-stream",
        buffer: request.body,
      });

      const file = await addProjectFile(project.id, {
        kind,
        name,
        r2Key: upload.key,
        url: upload.publicUrl,
      });

      const documentExtract = await saveDocumentExtract(project.id, file, {
        status: "processing",
        extractedText: "",
        structuredData: {
          documentType: file.kind,
          filename: file.name,
        },
        warning: "파일 저장은 완료되었습니다. 서버에서 문서를 분석 중입니다.",
      });

      extractFileInBackground(project.id, file).catch((error) => {
        console.error("Background extraction failed", error);
      });

      return response.status(201).json({ file, documentExtract });
    } catch (error) {
      return next(error);
    }
  },
);

app.post("/api/projects/:projectId/files", async (request, response, next) => {
  try {
    const project = await getProject(request.params.projectId);
    if (!project) {
      return response.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });
    }

    const { kind, name, r2Key, url } = request.body;
    if (!kind || !name) {
      return response.status(400).json({ error: "파일 종류와 파일명이 필요합니다." });
    }

    const file = await addProjectFile(project.id, { kind, name, r2Key, url });
    let documentExtract = null;

    if (file.r2_key) {
      documentExtract = await saveDocumentExtract(project.id, file, {
        status: "processing",
        extractedText: "",
        structuredData: {
          documentType: file.kind,
          filename: file.name,
        },
        warning: "파일 저장은 완료되었습니다. 서버에서 문서를 분석 중입니다.",
      });

      extractFileInBackground(project.id, file).catch((error) => {
        console.error("Background extraction failed", error);
      });
    }

    return response.status(201).json({ file, documentExtract });
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/projects/:projectId/files/:fileId", async (request, response, next) => {
  try {
    const project = await getProject(request.params.projectId);
    if (!project) {
      return response.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });
    }

    const file = await getProjectFile(project.id, request.params.fileId);
    if (!file) {
      return response.status(404).json({ error: "삭제할 파일을 찾을 수 없습니다." });
    }

    if (file.r2_key) {
      await deleteObject(file.r2_key);
    }

    await deleteProjectFile(project.id, file.id);

    return response.json({ ok: true, file });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/projects/:projectId/review-items", async (request, response, next) => {
  try {
    const project = await getProject(request.params.projectId);
    if (!project) {
      return response.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });
    }

    return response.json({ reviewItems: await listReviewItems(project.id) });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/projects/:projectId/document-extracts", async (request, response, next) => {
  try {
    const project = await getProject(request.params.projectId);
    if (!project) {
      return response.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });
    }

    return response.json({ documentExtracts: await listDocumentExtracts(project.id) });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/projects/:projectId/reviews/run", async (request, response, next) => {
  try {
    const project = await getProject(request.params.projectId);
    if (!project) {
      return response.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });
    }

    const files = await listProjectFiles(project.id);
    const extracts = await listDocumentExtracts(project.id);
    const candidates = buildComparisonCandidates({ project, files, extracts });
    const generated = await generateReviewItems({
      project,
      files,
      extracts,
      candidates,
      notes: request.body.notes || "",
    });
    const reviewItems = await replaceReviewItems(project.id, generated.items);

    return response.json({
      source: generated.source,
      warning: generated.warning,
      reviewItems,
    });
  } catch (error) {
    return next(error);
  }
});

app.get("*", (_request, response) => {
  response.sendFile(path.join(rootDir, "index.html"));
});

app.use((error, _request, response, _next) => {
  const statusCode = error.statusCode || 500;
  response.status(statusCode).json({
    error: error.message || "서버 오류가 발생했습니다.",
  });
});

await initDb();

app.listen(port, () => {
  console.log(`AI-CM API server listening on port ${port}`);
});
