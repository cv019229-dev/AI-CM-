import { createRequire } from "node:module";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { isImageFile, isOcrConfigured, ocrDocument } from "./ocr.js";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text",
});

const COST_HEADER_MAP = {
  trade: ["공종", "공사", "분류", "종별", "직종", "세부공종", "trade", "work"],
  item: ["품명", "품목", "명칭", "항목", "내역", "자재명", "명세", "공사명", "item", "name"],
  spec: ["규격", "사양", "치수", "두께", "규격명", "형상", "재질", "spec", "size"],
  unit: ["단위", "위", "unit"],
  quantity: ["수량", "물량", "산출량", "quantity", "qty"],
  unitPrice: ["단가", "일위대가", "재료비", "노무비", "경비", "unit price", "price"],
  amount: ["금액", "합계", "계", "공사비", "amount", "total"],
  note: ["비고", "메모", "특기", "참고", "적요", "note", "remark"],
};

function extensionOf(filename) {
  return filename.split(".").pop()?.toLowerCase() || "";
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    if (value.text) return String(value.text);
    if (value.richText) return value.richText.map((item) => item.text).join("");
    if (value.result != null) return String(value.result);
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

function normalizeKeyword(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()[\]{}:;·ㆍ._-]/g, "");
}

function findHeaderRow(rows) {
  let best = { index: -1, score: 0 };

  rows.slice(0, 60).forEach((row, index) => {
    const previous = rows[index - 1] || [];
    const next = rows[index + 1] || [];
    const joined = normalizeKeyword([...previous, ...row, ...next].join(" "));
    const score = Object.values(COST_HEADER_MAP)
      .flat()
      .reduce((total, keyword) => total + (joined.includes(normalizeKeyword(keyword)) ? 1 : 0), 0);

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
      const normalizedHeader = normalizeKeyword(header);
      if (keywords.some((keyword) => normalizedHeader.includes(normalizeKeyword(keyword)))) {
        mapping[field] = index;
      }
    }
  });

  return mapping;
}

function columnIndex(cellRef = "") {
  const letters = cellRef.replace(/\d/g, "");
  let index = 0;

  for (const letter of letters) {
    index = index * 26 + letter.toUpperCase().charCodeAt(0) - 64;
  }

  return Math.max(index - 1, 0);
}

async function zipText(zip, path) {
  const file = zip.file(path);
  return file ? file.async("text") : "";
}

function readRelationships(xml) {
  if (!xml) return {};
  const parsed = xmlParser.parse(xml);
  const relationships = asArray(parsed.Relationships?.Relationship);
  return Object.fromEntries(relationships.map((rel) => [rel.Id, rel.Target]));
}

function resolveWorkbookTarget(target) {
  if (!target) return "";
  if (target.startsWith("/")) return target.slice(1);
  return `xl/${target}`.replace(/\/+/g, "/");
}

function readSharedStrings(xml) {
  if (!xml) return [];
  const parsed = xmlParser.parse(xml);
  const items = asArray(parsed.sst?.si);

  return items.map((item) => collectText(item).join(""));
}

function collectText(node, output = []) {
  if (node == null) return output;
  if (typeof node === "string" || typeof node === "number") {
    output.push(String(node));
    return output;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => collectText(item, output));
    return output;
  }
  if (typeof node === "object") {
    if (typeof node.text === "string" || typeof node.text === "number") {
      output.push(String(node.text));
    }
    for (const [key, value] of Object.entries(node)) {
      if (["text", "rPr", "pPr", "tblPr", "tcPr", "trPr", "runPr", "secPr"].includes(key)) continue;
      collectText(value, output);
    }
  }
  return output;
}

function firstLines(text, limit = 500) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

async function extractWithOcr(buffer, file, reason, structuredData = {}) {
  if (!isOcrConfigured()) {
    return {
      status: "needs_ocr",
      extractedText: "",
      structuredData: {
        parser: "openai-ocr",
        documentType: file.kind,
        filename: file.name,
        ...structuredData,
      },
      warning: `${reason} 문자인식을 실행하려면 서버에 인공지능 연결 키가 필요합니다.`,
    };
  }

  try {
    const text = await ocrDocument(buffer, file);

    return {
      status: text ? "ocr_extracted" : "needs_ocr",
      extractedText: text.slice(0, 60000),
      structuredData: {
        parser: "openai-ocr",
        documentType: file.kind,
        filename: file.name,
        ...structuredData,
        lines: firstLines(text),
      },
      warning: text ? "" : "문자인식을 실행했지만 읽을 수 있는 텍스트를 찾지 못했습니다.",
    };
  } catch (error) {
    return {
      status: "needs_ocr",
      extractedText: "",
      structuredData: {
        parser: "openai-ocr",
        documentType: file.kind,
        filename: file.name,
        ...structuredData,
        error: error.message,
      },
      warning: `문자인식에 실패했습니다: ${error.message}`,
    };
  }
}

function parseSheetRows(xml, sharedStrings) {
  const parsed = xmlParser.parse(xml);
  const sheetRows = asArray(parsed.worksheet?.sheetData?.row);

  return sheetRows.map((row) => {
    const values = [];
    asArray(row.c).forEach((cell) => {
      const index = columnIndex(cell.r);
      let value = "";
      const rawValue = cell.v ?? cell.is?.t ?? "";

      if (cell.t === "s") {
        value = sharedStrings[Number(rawValue)] || "";
      } else if (cell.t === "inlineStr") {
        value = collectText(cell.is).join("");
      } else {
        value = cellText(rawValue);
      }

      values[index] = cellText(value);
    });

    return values.map((value) => value || "");
  });
}

async function readXlsxSheets(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await zipText(zip, "xl/workbook.xml");
  const workbookRelsXml = await zipText(zip, "xl/_rels/workbook.xml.rels");
  const sharedStringsXml = await zipText(zip, "xl/sharedStrings.xml");
  const workbook = xmlParser.parse(workbookXml);
  const relations = readRelationships(workbookRelsXml);
  const sharedStrings = readSharedStrings(sharedStringsXml);

  const workbookSheets = asArray(workbook.workbook?.sheets?.sheet);
  const sheets = [];

  for (const sheet of workbookSheets) {
    const relationshipId = sheet["r:id"] || sheet.id;
    const target = resolveWorkbookTarget(relations[relationshipId]);
    const xml = await zipText(zip, target);
    if (!xml) continue;

    sheets.push({
      name: sheet.name || target,
      rows: parseSheetRows(xml, sharedStrings),
    });
  }

  return sheets;
}

function rowToText(row) {
  return row.map((value) => cellText(value)).filter(Boolean).join(" | ");
}

function sheetToTextLines(sheet) {
  return sheet.rows
    .map((row, index) => ({
      rowNumber: index + 1,
      text: rowToText(row),
    }))
    .filter((row) => row.text);
}

function buildWorkbookText(workbookSheets) {
  const lines = [];

  for (const sheet of workbookSheets) {
    const textRows = sheetToTextLines(sheet);
    if (textRows.length === 0) continue;

    lines.push(`[시트: ${sheet.name}]`);
    textRows.slice(0, 300).forEach((row) => {
      lines.push(`${row.rowNumber}행: ${row.text}`);
    });
  }

  return lines.join("\n").slice(0, 60000);
}

async function extractExcel(buffer, file) {
  const workbookSheets = await readXlsxSheets(buffer);
  const sheets = [];
  const costItems = [];
  const workbookText = buildWorkbookText(workbookSheets);

  for (const sheet of workbookSheets) {
    const rows = sheet.rows;
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
        sheet: sheet.name,
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
      name: sheet.name,
      rowCount: rows.length,
      headerDetected: headerIndex >= 0,
      headers,
      textRowCount: sheetToTextLines(sheet).length,
    });
  }

  const costItemText = costItems
    .slice(0, 500)
    .map((item) =>
      [item.sheet, item.trade, item.item, item.spec, item.unit, item.quantity, item.note]
        .filter(Boolean)
        .join(" / "),
    )
    .join("\n");
  const extractedText = costItemText || workbookText;
  const warning =
    costItems.length > 0
      ? ""
      : workbookText
        ? `${file.name}에서 표 항목은 자동 분류하지 못했지만, 시트 텍스트는 추출했습니다.`
        : `${file.name}에서 읽을 수 있는 텍스트를 찾지 못했습니다.`;

  return {
    status: "extracted",
    extractedText,
    structuredData: {
      parser: "custom-ooxml",
      documentType: "cost",
      sheets,
      costItems,
      textExtracted: Boolean(workbookText),
    },
    warning,
  };
}

async function extractPdfWithoutOcr(buffer, file) {
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
    warning: text ? "" : "피디에프에서 텍스트를 찾지 못했습니다. 스캔 도면 또는 이미지 피디에프일 수 있어 문자인식이 필요합니다.",
  };
}

async function extractPdf(buffer, file) {
  let data;

  try {
    data = await pdfParse(buffer);
  } catch (error) {
    return extractWithOcr(buffer, file, "피디에프 텍스트 추출에 실패했습니다.", {
      fallbackFrom: "pdf-parse",
      parseError: error.message,
    });
  }

  const text = (data.text || "").replace(/\n{3,}/g, "\n\n").trim();

  if (!text) {
    return extractWithOcr(buffer, file, "피디에프 안에 직접 읽을 수 있는 텍스트가 없습니다.", {
      fallbackFrom: "pdf-parse",
      pageCount: data.numpages,
      info: data.info || {},
    });
  }

  return {
    status: "extracted",
    extractedText: text.slice(0, 60000),
    structuredData: {
      parser: "pdf-parse",
      documentType: file.kind,
      pageCount: data.numpages,
      info: data.info || {},
      lines: firstLines(text),
    },
    warning: "",
  };
}

async function extractImage(buffer, file) {
  return extractWithOcr(buffer, file, "도면 이미지의 글자를 읽으려면 문자인식이 필요합니다.", {
    sourceType: "image",
  });
}

async function extractHwpx(buffer, file) {
  const zip = await JSZip.loadAsync(buffer);
  const sectionPaths = Object.keys(zip.files)
    .filter((path) => /Contents\/section\d+\.xml$/i.test(path))
    .sort((a, b) => a.localeCompare(b));
  const sections = [];
  const paragraphs = [];

  for (const sectionPath of sectionPaths) {
    const xml = await zipText(zip, sectionPath);
    const parsed = xmlParser.parse(xml);
    const textPieces = collectText(parsed)
      .map((text) => text.trim())
      .filter(Boolean);
    const sectionText = textPieces.join(" ").replace(/\s+/g, " ").trim();

    if (sectionText) {
      sections.push({
        path: sectionPath,
        textLength: sectionText.length,
      });
      paragraphs.push(sectionText);
    }
  }

  const text = paragraphs.join("\n\n").slice(0, 60000);

  return {
    status: text ? "extracted" : "unsupported",
    extractedText: text,
    structuredData: {
      parser: "hwpx-xml",
      documentType: file.kind,
      sections,
      lines: text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 500),
    },
    warning: text ? "" : "HWPX에서 본문 텍스트를 찾지 못했습니다.",
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

  if (isImageFile(file)) {
    return extractImage(buffer, file);
  }

  if (extension === "hwpx") {
    return extractHwpx(buffer, file);
  }

  if (extension === "hwp") {
    return {
      status: "unsupported",
      extractedText: "",
      structuredData: {
        documentType: file.kind,
        filename: file.name,
      },
      warning: "구형 .hwp는 현재 서버에서 직접 추출하지 않습니다. 한글에서 .hwpx 또는 피디에프로 저장한 뒤 업로드해 주세요.",
    };
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
