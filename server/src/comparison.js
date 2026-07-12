const KEYWORDS = {
  temporary: ["가설", "비계", "동바리", "가설울타리", "안전난간", "낙하물방지망"],
  demolition: ["철거", "해체", "폐기물", "건설폐기물", "폐콘크리트", "폐목재"],
  earthwork: ["토공", "터파기", "되메우기", "잔토", "성토", "절토", "흙막이"],
  foundation: ["기초", "파일", "말뚝", "PHC", "지정", "잡석", "버림콘크리트"],
  concrete: ["콘크리트", "레미콘", "타설", "무근", "몰탈", "그라우트"],
  rebar: ["철근", "D10", "D13", "D16", "D19", "D22", "스터럽", "배근"],
  formwork: ["거푸집", "형틀", "합판거푸집", "유로폼", "동바리"],
  steel: ["철골", "H형강", "각관", "강재", "앵커볼트", "데크플레이트"],
  masonry: ["조적", "벽돌", "블록", "ALC", "치장벽돌", "시멘트벽돌"],
  plaster: ["미장", "몰탈", "견출", "바탕처리", "초벌", "정벌"],
  waterproof: ["방수", "우레탄", "시트방수", "도막방수", "액체방수", "실링"],
  insulation: ["단열", "단열재", "압출법", "비드법", "글라스울", "열반사"],
  roofing: ["지붕", "징크", "패널", "슁글", "홈통", "처마", "후레싱"],
  stone: ["석공", "석재", "화강석", "대리석", "인조석", "테라조"],
  tile: ["타일", "포세린", "자기질", "도기질", "타일붙임", "줄눈"],
  painting: ["도장", "페인트", "수성페인트", "유성페인트", "에폭시", "퍼티"],
  interior: ["수장", "석고보드", "천장", "경량철골", "마감재", "벽체마감"],
  flooring: ["바닥", "장판", "마루", "데코타일", "OA플로어", "악세스플로어"],
  window: ["창호", "AL창", "PVC창", "시스템창호", "방화문", "자동문", "문틀"],
  glass: ["유리", "복층유리", "강화유리", "접합유리", "로이유리", "유리공사"],
  metal: ["금속", "철물", "보강철물", "스테인리스", "난간", "핸드레일", "루버"],
  carpentry: ["목공", "목재", "합판", "걸레받이", "문선", "몰딩"],
  furniture: ["가구", "붙박이", "싱크대", "수납장", "상판", "제작가구"],
  landscaping: ["조경", "식재", "수목", "잔디", "관목", "포장석", "조경시설"],
  civil: ["토목", "배수로", "측구", "맨홀", "우수", "오수", "포장", "아스콘", "보도블록"],
  electrical: ["전기", "전선", "케이블", "분전반", "배전반", "콘센트", "스위치"],
  lighting: ["조명", "등기구", "LED", "비상등", "유도등", "조도"],
  communication: ["통신", "LAN", "CCTV", "방송", "인터폰", "네트워크", "통합배선"],
  fire: ["소방", "스프링클러", "감지기", "소화전", "소화기", "제연", "화재"],
  mechanical: ["기계설비", "배관", "펌프", "밸브", "위생기구", "급수", "급탕", "배수"],
  hvac: ["냉난방", "공조", "덕트", "환기", "에어컨", "실외기", "팬코일"],
  gas: ["가스", "가스배관", "도시가스", "가스밸브"],
  elevator: ["승강기", "엘리베이터", "리프트", "덤웨이터"],
  safety: ["안전", "안전관리", "보건", "표지판", "안전시설", "추락방지"],
  test: ["시험", "검사", "성능시험", "품질시험"],
};

function includesAny(text, words) {
  const normalizedText = String(text || "").toLowerCase();
  return words.some((word) => normalizedText.includes(String(word).toLowerCase()));
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
          action: "OCR 처리 또는 원본 도면/PDF 텍스트 파일 확보가 필요합니다.",
          rfi: "해당 도면 또는 문서의 텍스트 확인 가능한 원본 제공 가능 여부 확인을 요청드립니다.",
        }),
      );
    });

  return candidates.slice(0, 50);
}
