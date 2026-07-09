const KEYWORDS = {
  waterproof: ["방수", "우레탄", "시트방수", "도막방수"],
  tile: ["타일", "포세린", "자기질"],
  window: ["창호", "AL창", "PVC창", "유리"],
  test: ["시험", "검사", "성능시험", "품질시험"],
  rebar: ["철근", "D10", "D13", "D16", "D19"],
  metal: ["금속", "철물", "보강철물"],
};

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function extractTextByKind(extracts, kind) {
  return extracts
    .filter((extract) => extract.kind === kind)
    .map((extract) => extract.extracted_text || "")
    .join("\n");
}

function extractCostItems(extracts) {
  return extracts
    .filter((extract) => extract.kind === "cost")
    .flatMap((extract) => {
      const data = extract.structured_data || {};
      return Array.isArray(data.costItems) ? data.costItems : [];
    });
}

function costText(costItems) {
  return costItems
    .map((item) => [item.trade, item.item, item.spec, item.note].filter(Boolean).join(" "))
    .join("\n");
}

function makeItem({ category, type, issue, source, decision, priority, action, rfi }) {
  return {
    category,
    type,
    issue,
    source,
    decision,
    priority,
    action,
    rfi,
  };
}

export function buildComparisonCandidates({ extracts }) {
  const candidates = [];
  const drawingText = extractTextByKind(extracts, "drawing");
  const specText = extractTextByKind(extracts, "spec");
  const costItems = extractCostItems(extracts);
  const allCostText = costText(costItems);
  const designText = `${drawingText}\n${specText}`;

  for (const [group, words] of Object.entries(KEYWORDS)) {
    if (group === "test") continue;
    const designHasKeyword = includesAny(designText, words);
    const costHasKeyword = includesAny(allCostText, words);

    if (designHasKeyword && !costHasKeyword) {
      candidates.push(
        makeItem({
          category: "불일치·누락",
          type: "누락",
          issue: `도면 또는 시방서에는 ${words[0]} 관련 내용이 있으나 내역서 항목에서 확인되지 않습니다.`,
          source: "도면/시방서 추출 텍스트와 내역서 추출 항목",
          decision: "공사비 영향",
          priority: "높음",
          action: "내역 반영 여부와 설계 기준을 확인합니다.",
          rfi: `${words[0]} 관련 설계도서 표기와 내역 반영 여부 확인을 요청드립니다.`,
        }),
      );
    }
  }

  if (includesAny(specText, KEYWORDS.test) && !includesAny(allCostText, KEYWORDS.test)) {
    candidates.push(
      makeItem({
        category: "공사비 영향",
        type: "누락",
        issue: "시방서에는 시험 또는 검사 기준이 있으나 내역서에서 시험비 항목이 확인되지 않습니다.",
        source: "시방서 추출 텍스트 / 내역서 추출 항목",
        decision: "공사비 영향",
        priority: "중간",
        action: "시험 범위, 횟수, 비용 반영 기준을 확인합니다.",
        rfi: "시방서상 시험 또는 검사 기준의 적용 범위와 비용 반영 여부 확인을 요청드립니다.",
      }),
    );
  }

  if (designText.includes("2회") && allCostText.includes("1회")) {
    candidates.push(
      makeItem({
        category: "설계변경 검토",
        type: "불일치",
        issue: "도면 또는 시방서에는 2회 시공 표기가 있으나 내역서에는 1회 기준으로 보이는 항목이 있습니다.",
        source: "도면/시방서 추출 텍스트 / 내역서 추출 항목",
        decision: "설계변경 검토",
        priority: "높음",
        action: "적용 횟수와 계약 내역 기준을 공식 확인합니다.",
        rfi: "설계도서의 시공 횟수 표기와 내역서 반영 기준이 서로 다른지 확인을 요청드립니다.",
      }),
    );
  }

  extracts
    .filter((extract) => extract.status === "needs_ocr")
    .forEach((extract) => {
      candidates.push(
        makeItem({
          category: "RFI 후보",
          type: "확인",
          issue: `${extract.name}에서 텍스트를 추출하지 못했습니다. 스캔 도면 또는 이미지 PDF일 가능성이 있습니다.`,
          source: extract.name,
          decision: "단순 확인",
          priority: "낮음",
          action: "OCR 처리 또는 원본 CAD/PDF 텍스트 파일 확보가 필요합니다.",
          rfi: "해당 도면 또는 문서의 텍스트 확인 가능한 원본 제공 가능 여부 확인을 요청드립니다.",
        }),
      );
    });

  return candidates.slice(0, 30);
}
