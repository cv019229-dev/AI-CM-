import "dotenv/config";

import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  addProjectFile,
  createProject,
  dbMode,
  getProject,
  initDb,
  listProjectFiles,
  listProjects,
  listReviewItems,
  replaceReviewItems,
} from "./db.js";
import { createUploadUrl, isR2Configured } from "./r2.js";
import { generateReviewItems, isOpenAIConfigured } from "./openai.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const app = express();
const port = Number(process.env.PORT || 3000);

const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
  : true;

app.use(cors({ origin: corsOrigins }));
app.use(express.json({ limit: "3mb" }));
app.use(express.static(rootDir));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "ai-cm-review-api",
    database: dbMode(),
    r2Configured: isR2Configured(),
    openAIConfigured: isOpenAIConfigured(),
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
    const reviewItems = await listReviewItems(project.id);
    return response.json({ project, files, reviewItems });
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
    return response.status(201).json({ file });
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

app.post("/api/projects/:projectId/reviews/run", async (request, response, next) => {
  try {
    const project = await getProject(request.params.projectId);
    if (!project) {
      return response.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });
    }

    const files = await listProjectFiles(project.id);
    const generated = await generateReviewItems({
      project,
      files,
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
