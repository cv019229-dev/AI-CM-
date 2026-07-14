import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function r2Endpoint() {
  if (process.env.R2_ENDPOINT) {
    return process.env.R2_ENDPOINT;
  }

  return `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
}

export function isR2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME,
  );
}

function createClient() {
  return new S3Client({
    region: "auto",
    endpoint: r2Endpoint(),
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function cleanFilename(filename) {
  return filename
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 140);
}

function objectKey({ projectId, kind, filename }) {
  const safeName = cleanFilename(filename || "upload.bin");
  return `projects/${projectId}/${kind}/${Date.now()}-${safeName}`;
}

function publicUrlForKey(key) {
  return process.env.R2_PUBLIC_URL ? `${process.env.R2_PUBLIC_URL.replace(/\/$/, "")}/${key}` : "";
}

export async function createUploadUrl({ projectId, kind, filename, contentType }) {
  if (!isR2Configured()) {
    const error = new Error("Cloudflare R2 환경변수가 아직 설정되지 않았습니다.");
    error.statusCode = 503;
    throw error;
  }

  const key = objectKey({ projectId, kind, filename });
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType || "application/octet-stream",
  });

  const uploadUrl = await getSignedUrl(createClient(), command, { expiresIn: 60 * 10 });
  const publicUrl = publicUrlForKey(key);

  return {
    method: "PUT",
    uploadUrl,
    key,
    publicUrl,
    headers: {
      "Content-Type": contentType || "application/octet-stream",
    },
  };
}

export async function uploadObjectBuffer({ projectId, kind, filename, contentType, buffer }) {
  if (!isR2Configured()) {
    const error = new Error("Cloudflare R2 환경변수가 아직 설정되지 않았습니다.");
    error.statusCode = 503;
    throw error;
  }

  const key = objectKey({ projectId, kind, filename });
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType || "application/octet-stream",
  });

  await createClient().send(command);

  return {
    key,
    publicUrl: publicUrlForKey(key),
  };
}

export async function createDownloadUrl(key, filename) {
  if (!isR2Configured()) {
    const error = new Error("Cloudflare R2 환경변수가 아직 설정되지 않았습니다.");
    error.statusCode = 503;
    throw error;
  }

  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    ResponseContentDisposition: filename
      ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
      : undefined,
  });
  return getSignedUrl(createClient(), command, { expiresIn: 60 * 10 });
}

export async function getObjectBuffer(key) {
  if (!isR2Configured()) {
    const error = new Error("Cloudflare R2 환경변수가 아직 설정되지 않았습니다.");
    error.statusCode = 503;
    throw error;
  }

  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
  });
  const result = await createClient().send(command);
  return streamToBuffer(result.Body);
}

export async function deleteObject(key) {
  if (!key) return;

  if (!isR2Configured()) {
    const error = new Error("Cloudflare R2 환경변수가 아직 설정되지 않았습니다.");
    error.statusCode = 503;
    throw error;
  }

  const command = new DeleteObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
  });
  await createClient().send(command);
}
