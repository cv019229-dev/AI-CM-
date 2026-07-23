import OpenAI from "openai";

const REVIEW_CATEGORIES = ["불일치·누락", "RFI 후보", "설계변경 검토", "공사비 영향"];
const REVIEW_DECISIONS = ["RFI 후보", "설계변경 검토", "공사비 영향", "단순 확인"];

const MAX_REVIEW_ITEMS = 50;
const MAX_CANDIDATES = 30;
const MAX_REVIEW_CHUNKS = Number(process.env.AI_REVIEW_MAX_CHUNKS || 6);
const MAX_TEXT_CHARS_PER_CHUNK = Number(process.env.AI_REVIEW_CHUNK_CHARS || 22000);
const MAX_TEXT_CHARS_PER_EXTRACT = Number(process.env.AI_REVIEW_EXTRACT_CHARS || 52000);
const MAX_COST_ITEMS_PER_CHUNK = Number(process.env.AI_REVIEW_COST_ITEMS_PER_CHUNK || 80);
const MAX_COST_ITEMS_PER_EXTRACT = Number(process.env.AI_REVIEW_COST_ITEMS_PER_EXTRACT || 420);

const fallbackItems = [
  {
    category: "불일치·누락",
    type: "확인",
    issue: "업로드 문서 분석 전 샘플 검토 항목입니다.",
    source: "샘플 데이터",
    decision: "RFI 후보",
    priority: "중간",
    action: "OpenAI API 키와 문서 추출 기능을 연결한 뒤 실제 분석 결과로 교체합니다.",
    rfi: "업로드된 설계도서의 적용 기준과 내역 반영 여부 확인을 요청드립니다.",
  },
];

function extractJson(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(candidate);
}

function cleanText(value, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim();
}

function normalizeCategory(value) {
  const text = cleanText(value);
  if (text.includes("공사비")) return "공사비 영향";
  if (text.includes("설계변경")) return "설계변경 검토";
  if (text.toUpperCase().includes("RFI")) return "RFI 후보";
  return REVIEW_CATEGORIES.includes(text) ? text : "불일치·누락";
}

function normalizeDecision(value, category) {
  const text = cleanText(value);
  if (text.includes("공사비")) return "공사비 영향";
  if (text.includes("설계변경")) return "설계변경 검토";
  if (text.toUpperCase().includes("RFI")) return "RFI 후보";
  if (text.includes("확인")) return "단순 확인";
  return REVIEW_DECISIONS.includes(text) ? text : category;
}

function normalizePriority(value) {
  const text = cleanText(value);
  if (text.includes("긴급")) return "긴급";
  if (text.includes("높")) return "높음";
  if (text.includes("낮")) return "낮음";
  return "중간";
}

function normalizeItems(items, fallback = fallbackItems) {
  if (!Array.isArray(items)) {
    return fallback;
  }

  return items
    .filter((item) => item && typeof item === "object")
    .slice(0, MAX_REVIEW_ITEMS)
    .map((item) => {
      const category = normalizeCategory(item.category);
      return {
        category,
        type: cleanText(item.type, "확인"),
        issue: cleanText(item.issue, "확인 필요한 설계관리 항목"),
        source: cleanText(item.source, "업로드 문서"),
        decision: normalizeDecision(item.decision, category),
        priority: normalizePriority(item.priority),
        action: cleanText(item.action, "담당자가 원문과 기준을 확인합니다."),
        rfi: cleanText(item.rfi, "관련 설계도서 기준 확인을 요청드립니다."),
      };
    });
}

function dedupeItems(items) {
  const seen = new Set();
  const deduped = [];

  for (const item of items) {
    const key = [item.category, item.type, item.issue, item.source]
      .map((part) => cleanText(part).toLowerCase())
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= MAX_REVIEW_ITEMS) break;
  }

  return deduped;
}

function splitText(text, limit) {
  const source = String(text || "").slice(0, MAX_TEXT_CHARS_PER_EXTRACT);
  if (!source.trim()) return [];

  const chunks = [];
  let offset = 0;

  while (offset < source.length) {
    let end = Math.min(offset + limit, source.length);
    if (end < source.length) {
      const lineBreak = source.lastIndexOf("\n", end);
      if (lineBreak > offset + limit * 0.6) {
        end = lineBreak;
      }
    }
    chunks.push(source.slice(offset, end).trim());
    offset = end;
  }

  return chunks.filter(Boolean);
}

function compactCostItem(item, index) {
  return {
    no: index + 1,
    sheet: item.sheet || "",
    trade: item.trade || "",
    item: item.item || "",
    spec: item.spec || "",
    unit: item.unit || "",
    quantity: item.quantity ?? "",
    unitPrice: item.unitPrice ?? "",
    amount: item.amount ?? "",
    note: item.note || "",
  };
}

function compactStructuredData(extract, costItems = []) {
  const data = extract.structured_data || {};
  const sheets = Array.isArray(data.sheets)
    ? data.sheets.map((sheet) => ({
        name: sheet.name,
        rowCount: sheet.rowCount,
        headerDetected: sheet.headerDetected,
        textRowCount: sheet.textRowCount,
      }))
    : undefined;

  return {
    parser: data.parser,
    documentType: data.documentType || extract.kind,
    filename: data.filename || extract.name,
    pageCount: data.pageCount,
    sheetCount: sheets?.length,
    sheets,
    totalCostItemCount: Array.isArray(data.costItems) ? data.costItems.length : undefined,
    includedCostItems: costItems,
  };
}

function buildReviewChunks(extracts) {
  const chunks = [];
  let omittedCostItems = 0;
  let omittedTextChars = 0;

  for (const extract of extracts) {
    const data = extract.structured_data || {};
    const costItems = Array.isArray(data.costItems) ? data.costItems : [];
    const limitedCostItems = costItems.slice(0, MAX_COST_ITEMS_PER_EXTRACT);
    omittedCostItems += Math.max(costItems.length - limitedCostItems.length, 0);

    if (limitedCostItems.length > 0) {
      for (let start = 0; start < limitedCostItems.length; start += MAX_COST_ITEMS_PER_CHUNK) {
        const slice = limitedCostItems.slice(start, start + MAX_COST_ITEMS_PER_CHUNK);
        chunks.push({
          document: {
            kind: extract.kind,
            name: extract.name,
            status: extract.status,
            warning: extract.warning,
          },
          textSample: String(extract.extracted_text || "").slice(0, 3000),
          structuredData: compactStructuredData(
            extract,
            slice.map((item, index) => compactCostItem(item, start + index)),
          ),
        });
      }
      continue;
    }

    const text = String(extract.extracted_text || "");
    const textChunks = splitText(text, MAX_TEXT_CHARS_PER_CHUNK);
    omittedTextChars += Math.max(text.length - MAX_TEXT_CHARS_PER_EXTRACT, 0);

    if (textChunks.length === 0) {
      chunks.push({
        document: {
          kind: extract.kind,
          name: extract.name,
          status: extract.status,
          warning: extract.warning,
        },
        textSample: "",
        structuredData: compactStructuredData(extract),
      });
      continue;
    }

    textChunks.forEach((textSample) => {
      chunks.push({
        document: {
          kind: extract.kind,
          name: extract.name,
          status: extract.status,
          warning: extract.warning,
        },
        textSample,
        structuredData: compactStructuredData(extract),
      });
    });
  }

  const limitedChunks = chunks.slice(0, MAX_REVIEW_CHUNKS);

  return {
    chunks: limitedChunks,
    omittedChunks: Math.max(chunks.length - limitedChunks.length, 0),
    omittedCostItems,
    omittedTextChars,
  };
}

function compactFiles(files) {
  return files.map((file) => ({
    id: file.id,
    kind: file.kind,
    name: file.name,
    created_at: file.created_at,
  }));
}

function buildWarnings({ chunkInfo, chunkCount, fallbackWarning }) {
  const warnings = [];

  if (chunkCount > 1) {
    warnings.push(`큰 문서를 ${chunkCount}개 묶음으로 나누어 AI 검토했습니다.`);
  }
  if (chunkInfo.omittedChunks > 0) {
    warnings.push(
      `요청 한도를 넘지 않도록 ${chunkInfo.omittedChunks}개 초과 묶음은 이번 검토에서 제외했습니다. 공종이나 문서를 좁혀 다시 실행하면 더 자세히 볼 수 있습니다.`,
    );
  }
  if (chunkInfo.omittedCostItems > 0) {
    warnings.push(`내역서 항목 ${chunkInfo.omittedCostItems}개는 한도 초과 방지를 위해 제외했습니다.`);
  }
  if (chunkInfo.omittedTextChars > 0) {
    warnings.push("일부 긴 원문은 앞부분 중심으로 압축해 검토했습니다.");
  }
  if (fallbackWarning) {
    warnings.push(fallbackWarning);
  }

  return warnings.join(" ");
}

function tooLargeError(error) {
  const message = String(error?.message || "");
  return error?.status === 429 || message.includes("Request too large") || message.includes("tokens per min");
}

function shrinkChunk(chunk) {
  const costItems = chunk.structuredData?.includedCostItems || [];
  return {
    ...chunk,
    textSample: String(chunk.textSample || "").slice(0, 8000),
    structuredData: {
      ...chunk.structuredData,
      includedCostItems: costItems.slice(0, 25),
      shrinkReason: "AI 요청 한도 초과로 축소 검토",
    },
  };
}

async function requestReview({ client, model, project, files, chunk, candidates, notes, chunkIndex, chunkCount }) {
  const payload = {
    task:
      "업로드된 설계도서를 기준으로 설계관리 리스크 후보를 4개 카테고리로 분류해 주세요. 확정 판단은 하지 말고, 근거가 부족하면 확인 필요로 표현해 주세요.",
    requiredItemShape: {
      category: "불일치·누락 | RFI 후보 | 설계변경 검토 | 공사비 영향",
      type: "불일치 | 누락 | 물량 차이 | 확인 | 기타",
      issue: "발견 내용",
      source: "관련 문서 또는 근거",
      decision: "RFI 후보 | 설계변경 검토 | 공사비 영향 | 단순 확인",
      priority: "긴급 | 높음 | 중간 | 낮음",
      action: "권장 조치",
      rfi: "필요 시 RFI 문안 초안",
    },
    rules: [
      "반드시 JSON 배열만 반환합니다.",
      "문서 내용에 없는 사실은 단정하지 않습니다.",
      "RFI 후보는 발주처, 설계자, 감리단의 공식 확인이 필요한 항목만 포함합니다.",
      "공사비 영향은 내역 누락, 물량 증가, 신규 단가, 시험비 누락 가능성이 있을 때 표시합니다.",
      "설계변경 검토는 단순 오탈자보다 계약 내용이나 설계 기준 변경 가능성이 있을 때 표시합니다.",
    ],
    chunk: {
      index: chunkIndex + 1,
      total: chunkCount,
      note: "큰 문서는 여러 묶음으로 나누어 검토 중입니다.",
      ...chunk,
    },
    project,
    files: compactFiles(files),
    candidates: candidates.slice(0, MAX_CANDIDATES),
    notes,
  };

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "당신은 중소 시공사를 위한 AI-CM 설계정보 검토 보조자입니다. 확정 판단자가 아니라 1차 검토 후보를 분류하는 역할입니다. 답변은 JSON 배열만 반환합니다.",
      },
      {
        role: "user",
        content: JSON.stringify(payload),
      },
    ],
  });

  try {
    return normalizeItems(extractJson(response.output_text || "[]"), []);
  } catch {
    return [];
  }
}

export function isOpenAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function generateReviewItems({ project, files, extracts = [], candidates = [], notes }) {
  if (!isOpenAIConfigured()) {
    return {
      source: "fallback",
      items: candidates.length > 0 ? candidates : fallbackItems,
      warning: "OpenAI API 키가 없어 규칙 기반 후보 또는 샘플 결과를 반환했습니다.",
    };
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const chunkInfo = buildReviewChunks(extracts);
  const chunks = chunkInfo.chunks.length > 0 ? chunkInfo.chunks : [{ textSample: "", structuredData: {} }];
  const generatedItems = [];
  let fallbackWarning = "";

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];

    try {
      const items = await requestReview({
        client,
        model,
        project,
        files,
        chunk,
        candidates,
        notes,
        chunkIndex: index,
        chunkCount: chunks.length,
      });
      generatedItems.push(...items);
    } catch (error) {
      if (!tooLargeError(error)) {
        throw error;
      }

      try {
        const items = await requestReview({
          client,
          model,
          project,
          files,
          chunk: shrinkChunk(chunk),
          candidates: candidates.slice(0, 10),
          notes,
          chunkIndex: index,
          chunkCount: chunks.length,
        });
        generatedItems.push(...items);
        fallbackWarning = "일부 문서는 AI 요청 한도 때문에 더 짧게 압축해 검토했습니다.";
      } catch {
        fallbackWarning =
          "일부 문서 묶음은 AI 요청 한도를 초과해 규칙 기반 후보만 반영했습니다. 문서나 공종 범위를 좁혀 다시 실행해 주세요.";
      }
    }
  }

  const normalizedCandidates = normalizeItems(candidates, []);
  const items = dedupeItems([...generatedItems, ...normalizedCandidates]);

  return {
    source: "openai",
    items: items.length > 0 ? items : fallbackItems,
    warning: buildWarnings({ chunkInfo, chunkCount: chunks.length, fallbackWarning }),
  };
}
