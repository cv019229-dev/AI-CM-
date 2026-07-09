import OpenAI from "openai";

const IMAGE_MIME_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function extensionOf(filename) {
  return filename.split(".").pop()?.toLowerCase() || "";
}

function maxOcrBytes() {
  return Number(process.env.OCR_MAX_BYTES || 20 * 1024 * 1024);
}

function assertSize(buffer, filename) {
  if (buffer.length > maxOcrBytes()) {
    const error = new Error(
      `${filename} is larger than the OCR limit. Increase OCR_MAX_BYTES or split the file.`,
    );
    error.statusCode = 413;
    throw error;
  }
}

function dataUrl(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function client() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function model() {
  return process.env.OPENAI_OCR_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
}

function ocrPrompt(file) {
  return [
    "Extract visible text from this construction drawing image or scanned PDF.",
    "Keep Korean and English text as written.",
    "Preserve drawing numbers, titles, work types, material names, specifications, quantities, units, test standards, and notes as much as possible.",
    "Group text by page or visible area when possible.",
    "Mark unclear parts as [unclear].",
    "Return only extracted text. Do not add opinions or analysis.",
    `Filename: ${file.name}`,
  ].join("\n");
}

export function isOcrConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function isImageFile(file) {
  return Boolean(IMAGE_MIME_TYPES[extensionOf(file.name)]);
}

export function isPdfFile(file) {
  return extensionOf(file.name) === "pdf";
}

export function canOcrDocument(file) {
  return isImageFile(file) || isPdfFile(file);
}

export async function ocrDocument(buffer, file) {
  if (!isOcrConfigured()) {
    const error = new Error("OPENAI_API_KEY is required to run OCR.");
    error.statusCode = 503;
    throw error;
  }

  assertSize(buffer, file.name);

  if (isImageFile(file)) {
    const mimeType = IMAGE_MIME_TYPES[extensionOf(file.name)];
    const response = await client().responses.create({
      model: model(),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: ocrPrompt(file),
            },
            {
              type: "input_image",
              image_url: dataUrl(buffer, mimeType),
            },
          ],
        },
      ],
    });

    return response.output_text?.trim() || "";
  }

  if (isPdfFile(file)) {
    const response = await client().responses.create({
      model: model(),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_file",
              filename: file.name,
              file_data: dataUrl(buffer, "application/pdf"),
              detail: "high",
            },
            {
              type: "input_text",
              text: ocrPrompt(file),
            },
          ],
        },
      ],
    });

    return response.output_text?.trim() || "";
  }

  const error = new Error("This file type is not supported for OCR.");
  error.statusCode = 400;
  throw error;
}
