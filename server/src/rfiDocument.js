import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templatePath = path.resolve(__dirname, "../../templates/rfi-template.docx");

const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAllText(xml, search, value) {
  return xml.replace(new RegExp(escapeRegExp(search), "g"), escapeXml(value));
}

function replaceTextSequence(xml, search, values) {
  let index = 0;
  return xml.replace(new RegExp(escapeRegExp(search), "g"), () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return escapeXml(value);
  });
}

function replaceRowText(rowXml, values) {
  let index = 0;
  return rowXml.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g, (_match, open, _text, close) => {
    const value = values[Math.min(index, values.length - 1)] ?? "";
    index += 1;
    return `${open}${escapeXml(value)}${close}`;
  });
}

function getRows(tableXml) {
  return [...tableXml.matchAll(/<w:tr[\s\S]*?<\/w:tr>/g)].map((match) => ({
    xml: match[0],
    index: match.index,
  }));
}

function replaceRows(tableXml, headerRowCount, rows, valuesForRow) {
  const tableRows = getRows(tableXml);
  const rowTemplate = tableRows[headerRowCount]?.xml || tableRows[tableRows.length - 1]?.xml;
  if (!rowTemplate) return tableXml;

  const firstReplaceRow = tableRows[headerRowCount];
  const lastReplaceRow = tableRows[tableRows.length - 1];
  const beforeRows = tableXml.slice(0, firstReplaceRow.index);
  const afterRows = tableXml.slice(lastReplaceRow.index + lastReplaceRow.xml.length);
  const generatedRows = rows.map((row, index) => replaceRowText(rowTemplate, valuesForRow(row, index))).join("");

  return `${beforeRows}${generatedRows}${afterRows}`;
}

function replaceTableByMarker(xml, marker, replacer) {
  const tables = [...xml.matchAll(/<w:tbl[\s\S]*?<\/w:tbl>/g)];
  const table = tables.find((match) => match[0].includes(marker));
  if (!table) return xml;

  const nextTable = replacer(table[0]);
  return `${xml.slice(0, table.index)}${nextTable}${xml.slice(table.index + table[0].length)}`;
}

function formatDate(date) {
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date).replace(/\.$/, "");
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function cleanFilename(value) {
  return String(value || "project")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function displayKind(kind) {
  return (
    {
      drawing: "설계도면",
      spec: "시방서",
      cost: "내역서",
      rfi: "RFI 문서",
    }[kind] || kind || "문서"
  );
}

function classifyCategory(item) {
  const text = `${item.category || ""} ${item.decision || ""}`;
  if (text.includes("RFI") || text.includes("질의")) return "rfi";
  if (text.includes("공사비")) return "cost";
  if (text.includes("설계변경")) return "change";
  return "mismatch";
}

export function isRfiReviewItem(item) {
  const text = `${item.category || ""} ${item.decision || ""} ${item.rfi || ""}`;
  return text.includes("RFI") || text.includes("질의");
}

function inferTrade(project, item) {
  const text = `${item.type || ""} ${item.issue || ""} ${item.source || ""} ${project.scope || ""}`;
  const trades = [
    "가설",
    "철거",
    "토공",
    "파일",
    "기초",
    "콘크리트",
    "철근",
    "거푸집",
    "철골",
    "조적",
    "미장",
    "방수",
    "단열",
    "지붕",
    "석공",
    "타일",
    "도장",
    "수장",
    "바닥",
    "창호",
    "유리",
    "금속",
    "목공",
    "가구",
    "조경",
    "토목",
    "전기",
    "조명",
    "통신",
    "소방",
    "기계",
    "설비",
    "공조",
    "가스",
    "승강기",
    "안전",
  ];
  return trades.find((trade) => text.includes(trade)) || item.type || project.scope || "종합 검토";
}

function checked(selected) {
  return selected ? "■" : "□";
}

function priorityText(priority = "") {
  if (priority.includes("긴급")) return "긴급";
  if (priority.includes("높")) return "높음";
  if (priority.includes("중")) return "중간";
  if (priority.includes("낮")) return "낮음";
  return "중간";
}

function reviewTypeText(categoryId) {
  return (
    {
      mismatch: "불일치·누락",
      rfi: "RFI 후보",
      change: "설계변경 검토",
      cost: "공사비 영향",
    }[categoryId] || "RFI 후보"
  );
}

function sourceForKind(files, kind, fallback) {
  const names = files.filter((file) => file.kind === kind).map((file) => file.name);
  return names.length > 0 ? names.join(", ") : fallback;
}

function buildContext({ project, files, item, index, now }) {
  const year = new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(now);
  const rfiNumber = `RFI-${year}-${String(index + 1).padStart(3, "0")}`;
  const categoryId = classifyCategory(item);
  const priority = priorityText(item.priority);
  const trade = inferTrade(project, item);
  const source = item.source || "관련 위치 확인 필요";
  const dueDate = formatDate(addDays(now, 7));
  const createdDate = formatDate(now);
  const uploadedFiles = files.filter((file) => file.kind !== "rfi");
  const attachments =
    uploadedFiles.length > 0
      ? uploadedFiles.map((file) => ({
          name: file.name,
          note: displayKind(file.kind),
        }))
      : [{ name: "업로드 원문 또는 발췌자료", note: "첨부 필요" }];

  const questions = [
    item.rfi || "관련 설계도서 기준 확인을 요청드립니다.",
    item.action || "해당 항목의 적용 위치와 설계 기준을 확인하여 주시기 바랍니다.",
  ];

  return {
    rfiNumber,
    createdDate,
    dueDate,
    priority,
    categoryId,
    reviewType: reviewTypeText(categoryId),
    trade,
    source,
    attachments,
    questions: [...new Set(questions.filter(Boolean))],
    lineItems: [
      {
        name: item.issue || "RFI 검토 항목",
        spec: trade,
        quantity: "확인 필요",
        unit: "-",
        price: categoryId === "cost" ? "검토 필요" : "-",
        note: source,
      },
    ],
    replacements: {
      "[공사명 자동입력]": project.name,
      "RFI-[YYYY]-[000]": rfiNumber,
      "[검토 이슈 요약 자동입력]": item.issue || "설계정보 확인 요청",
      "[발주자·설계자·감리자]": "발주처·설계자·감리단",
      "[토목·건축·기계·전기 등]": trade,
      "[도면명·도면번호]": sourceForKind(files, "drawing", "도면 확인 필요"),
      "[층·구간·상세번호]": source,
      "[시방서명·절/항]": sourceForKind(files, "spec", "시방서 확인 필요"),
      "[페이지·조항]": source,
      "[내역서명·시트명]": sourceForKind(files, "cost", "내역서 확인 필요"),
      "[품명·행/셀 위치]": source,
      "[AI 검토 결과와 원문 대조 결과를 서술합니다. 예: 동일 규격의 철근콘크리트깨기와 무근콘크리트깨기 항목에서 수량 및 단가 차이가 확인되었으나, 설계도면과 시방서에서 적용 위치와 기준을 명확히 확인하기 어려움.]":
        `${item.issue || "설계정보 확인이 필요한 항목입니다."} 관련 근거: ${source}.`,
      "[현재 확인된 자료만으로는 적용 범위 또는 산출 근거를 명확히 판단하기 어려우므로, 관련 설계도서 확인 후 적정성을 재검토할 필요가 있습니다.]":
        item.action || "관련 설계도서 확인 후 적용 기준과 조치 필요 여부를 회신받아야 합니다.",
      "[질의사항에 대한 회신 내용, 적용 기준, 수정 지시 및 참고사항을 작성합니다.]": "회신 대기",
      "[담당자·조치내용·완료예정일 입력]": "회신 후 담당자와 후속 조치 확정",
      "[개정 도면번호·시방서 조항·변경내역서 위치 입력]": "회신 후 필요 시 문서 개정 위치 기재",
      "[                    ]": "검토 필요",
      "[                              ]": "검토 필요",
    },
  };
}

function fillSection(sectionXml, context) {
  let xml = sectionXml;

  xml = replaceTextSequence(xml, "[YYYY. MM. DD.]", [
    context.createdDate,
    "회신 시 작성",
    "조치 완료 시 작성",
  ]);
  xml = replaceTextSequence(xml, "[회사/부서/담당자]", ["시공사 / 현장 담당자", "회신자 작성 예정"]);

  Object.entries(context.replacements).forEach(([search, value]) => {
    xml = replaceAllText(xml, search, value);
  });

  xml = replaceAllText(
    xml,
    "검토 우선순위   □ 긴급   □ 높음   □ 중간   □ 낮음      검토 유형   □ 불일치·누락   □ RFI 후보   □ 설계변경 검토   □ 공사비 영향",
    `검토 우선순위   ${checked(context.priority === "긴급")} 긴급   ${checked(context.priority === "높음")} 높음   ${checked(
      context.priority === "중간",
    )} 중간   ${checked(context.priority === "낮음")} 낮음      검토 유형   ${checked(
      context.categoryId === "mismatch",
    )} 불일치·누락   ${checked(context.categoryId === "rfi")} RFI 후보   ${checked(
      context.categoryId === "change",
    )} 설계변경 검토   ${checked(context.categoryId === "cost")} 공사비 영향`,
  );

  xml = replaceTableByMarker(xml, "품명/항목", (tableXml) =>
    replaceRows(tableXml, 1, context.lineItems, (row, index) => [
      String(index + 1),
      row.name,
      row.spec,
      row.quantity,
      row.unit,
      row.price,
      row.note,
    ]),
  );

  xml = replaceTableByMarker(xml, "해당 항목의 정확한 적용 위치", (tableXml) =>
    replaceRows(tableXml, 0, context.questions, (question, index) => [String(index + 1), question]),
  );

  xml = replaceTableByMarker(xml, "첨부자료명", (tableXml) =>
    replaceRows(tableXml, 1, context.attachments, (attachment, index) => [
      String(index + 1),
      attachment.name,
      attachment.note,
    ]),
  );

  xml = xml.replace(/\[[^\]]*\]/g, "입력 예정");
  return xml;
}

export async function buildRfiDocument({ project, files, reviewItems }) {
  const rfiItems = reviewItems.filter(isRfiReviewItem);
  if (rfiItems.length === 0) {
    const error = new Error("생성할 RFI 후보가 없습니다.");
    error.statusCode = 400;
    throw error;
  }

  const templateBuffer = await fs.readFile(templatePath);
  const zip = await JSZip.loadAsync(templateBuffer);
  const documentXml = await zip.file("word/document.xml").async("string");
  const bodyMatch = documentXml.match(/<w:body>([\s\S]*?)<\/w:body>/);
  if (!bodyMatch) {
    throw new Error("RFI 양식의 본문 구조를 읽지 못했습니다.");
  }

  const bodyXml = bodyMatch[1];
  const sectMatch = bodyXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
  const sectionProperties = sectMatch?.[0] || "";
  const bodyTemplate = sectionProperties ? bodyXml.replace(sectionProperties, "") : bodyXml;
  const now = new Date();
  const sections = rfiItems.map((item, index) =>
    fillSection(
      bodyTemplate,
      buildContext({
        project,
        files,
        item,
        index,
        now,
      }),
    ),
  );
  const nextBodyXml = `${sections.join(pageBreak)}${sectionProperties}`;
  const nextDocumentXml = documentXml.replace(bodyMatch[1], nextBodyXml);
  zip.file("word/document.xml", nextDocumentXml);

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  const year = new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(now);
  const filename = `${cleanFilename(project.name)}_RFI_${year}_${String(rfiItems.length).padStart(2, "0")}건.docx`;

  return {
    buffer,
    filename,
    contentType: DOCX_CONTENT_TYPE,
    count: rfiItems.length,
  };
}
