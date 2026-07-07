import OpenAI from "openai";

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
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(candidate);
}

function normalizeItems(items) {
  if (!Array.isArray(items)) {
    return fallbackItems;
  }

  return items.slice(0, 30).map((item) => ({
    category: item.category || "불일치·누락",
    type: item.type || "확인",
    issue: item.issue || "확인 필요 항목",
    source: item.source || "업로드 문서",
    decision: item.decision || "RFI 후보",
    priority: item.priority || "중간",
    action: item.action || "담당자가 원문을 확인합니다.",
    rfi: item.rfi || "관련 설계도서 기준 확인을 요청드립니다.",
  }));
}

export function isOpenAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function generateReviewItems({ project, files, notes }) {
  if (!isOpenAIConfigured()) {
    return {
      source: "fallback",
      items: fallbackItems,
      warning: "OPENAI_API_KEY가 없어 샘플 결과를 반환했습니다.",
    };
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "너는 중소 시공사를 위한 AI-CM 설계정보 검토 보조자다. 확정 판단을 내리지 말고 1차 검토 후보로만 분류한다. 반드시 JSON 배열만 반환한다.",
      },
      {
        role: "user",
        content: JSON.stringify({
          task:
            "프로젝트 정보, 업로드 파일 목록, 사용자가 입력한 메모를 바탕으로 설계관리 위험 후보를 4개 카테고리로 분류해줘. 카테고리는 불일치·누락, RFI 후보, 설계변경 검토, 공사비 영향 중 하나여야 한다.",
          requiredItemShape: {
            category: "불일치·누락 | RFI 후보 | 설계변경 검토 | 공사비 영향",
            type: "불일치 | 누락 | 수량 차이 | 확인 등",
            issue: "발견 내용",
            source: "관련 문서 또는 근거",
            decision: "RFI 후보 | 설계변경 검토 | 공사비 영향 | 단순 확인",
            priority: "높음 | 중간 | 낮음",
            action: "권장 조치",
            rfi: "필요 시 RFI 문안 초안",
          },
          project,
          files,
          notes,
        }),
      },
    ],
  });

  const text = response.output_text || "[]";
  return {
    source: "openai",
    items: normalizeItems(extractJson(text)),
    warning: "",
  };
}
