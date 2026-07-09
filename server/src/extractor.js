import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
const readXlsxFileModule = require("read-excel-file/node");
const readXlsxFile = readXlsxFileModule.default || readXlsxFileModule;

const COST_HEADER_MAP = {
  trade: ["공종", "공사", "분류", "종별"],
  item: ["품명", "명칭", "항목", "내역", "자재명"],
  spec: ["규격", "사양", "치수", "두께"],
  unit: ["단위"],
  quantity: ["수량", "물량"],
  unitPrice: ["단가"],
  amount: ["금액", "합계"],
  note: ["비고", "메모", "특기"],
};

function extensionOf(filename) {
  return filename.split(".").pop()?.toLowerCase() || "";
}

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    if (value.text) return String(value.text);
    if (value.richText) return value.richText.map((item) => item.text).join("");
    if (value.result != null) return String(value.result);
    if (value.hyperlink && value.text) return String(value.text);
  }
  return String(value).trim();
}

function toNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value;
  const normalized = String(value).replace(/,/g, "").replace(/[^\d.-]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function findHeaderRow(rows) {
  let best = { index: -1, score: 0 };

  rows.slice(0, 20).forEach((row, index) => {
    const joined = row.join(" ");
    const score = Object.values(COST_HEADER_MAP)
      .flat()
      .reduce((total, keyword) => total + (joined.includes(keyword) ? 1 : 0), 0);

    if (score > best.score) {
      best = { index, score };
    }
  });

  return best.score >= 2 ? best.index : -1;
}

function mapHeaders(headerRow) {
  const mapping = {};

  headerRow.forEach((header, index) => {
    for (const [field, keywords] of Object.entries(COST_HEADER_MAP)) {
      if (keywords.some((keyword) => header.includes(keyword))) {
        mapping[field] = index;
      }
    }
  });

  return mapping;
}

async function extractExcel(buffer, file) {
  const sheetNames = ["첫 번째 시트"];
  const sheets = [];
  const costItems = [];

  for (const sheetName of sheetNames) {
    const rawRows = await readXlsxFile(buffer);
    const rows = rawRows.map((row) => row.map(cellText));

    const headerIndex = findHeaderRow(rows);
    const headers = headerIndex >= 0 ? rows[headerIndex] : [];
    const mapping = headerIndex >= 0 ? mapHeaders(headers) : {};
    const dataRows = headerIndex >= 0 ? rows.slice(headerIndex + 1) : rows.slice(0, 100);

    dataRows.forEach((row) => {
      const itemName = row[mapping.item] || "";
      const trade = row[mapping.trade] || "";
      const spec = row[mapping.spec] || "";
      const note = row[mapping.note] || "";

      if (![itemName, trade, spec, note].some(Boolean)) return;

      costItems.push({
        sheet: sheetName,
        trade,
        item: itemName,
        spec,
        unit: row[mapping.unit] || "",
        quantity: toNumber(row[mapping.quantity]),
        unitPrice: toNumber(row[mapping.unitPrice]),
        amount: toNumber(row[mapping.amount]),
        note,
      });
    });

    sheets.push({
      name: sheetName,
      rowCount: rows.length,
      headerDetected: headerIndex >= 0,
      headers,
    });
  }

  return {
    status: "extracted",
    extractedText: costItems
      .slice(0, 200)
      .map((item) =>
        [item.trade, item.item, item.spec, item.unit, item.quantity, item.note].filter(Boolean).join(" / "),
      )
      .join("\n"),
    structuredData: {
      parser: "read-excel-file",
      documentType: "cost",
      sheets,
      costItems,
    },
    warning: costItems.length === 0 ? `${file.name}에서 내역 항목을 찾지 못했습니다.` : "",
  };
}

async function extractPdf(buffer, file) {
  const data = await pdfParse(buffer);
  const text = (data.text || "").replace(/\n{3,}/g, "\n\n").trim();
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 500);

  return {
    status: text ? "extracted" : "needs_ocr",
    extractedText: text.slice(0, 60000),
    structuredData: {
      parser: "pdf-parse",
      documentType: file.kind,
      pageCount: data.numpages,
      info: data.info || {},
      lines,
    },
    warning: text ? "" : "PDF에서 텍스트를 찾지 못했습니다. 스캔 도면 또는 이미지 PDF일 수 있어 OCR이 필요합니다.",
  };
}

function extractUnsupported(_buffer, file) {
  return {
    status: "unsupported",
    extractedText: "",
    structuredData: {
      documentType: file.kind,
      filename: file.name,
    },
    warning: "아직 이 파일 형식은 자동 추출을 지원하지 않습니다.",
  };
}

export async function extractDocument(buffer, file) {
  const extension = extensionOf(file.name);

  if (["xlsx", "xlsm"].includes(extension)) {
    return extractExcel(buffer, file);
  }

  if (extension === "pdf") {
    return extractPdf(buffer, file);
  }

  if (extension === "xls") {
    return {
      status: "unsupported",
      extractedText: "",
      structuredData: {
        documentType: "cost",
        filename: file.name,
      },
      warning: "구형 .xls 파일은 현재 지원하지 않습니다. .xlsx로 저장한 뒤 업로드해 주세요.",
    };
  }

  return extractUnsupported(buffer, file);
}
