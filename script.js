const API_BASE_URL = "https://ai-cm-production.up.railway.app";

const PAGE_META = {
  home: {
    eyebrow: "Construction Master",
    title: "콘마",
    subtitle: "소규모 공사의 설계도서 검토를 빠르게 돕는 AI-CM 보조 시스템입니다.",
  },
  dashboard: {
    eyebrow: "설계관리 리스크 1차 분류",
    title: "대시보드",
    subtitle: "프로젝트 상태와 검토 진행 상황을 한눈에 확인합니다.",
  },
  projects: {
    eyebrow: "공사별 독립 관리",
    title: "프로젝트 생성 및 관리",
    subtitle: "프로젝트를 만들고 선택하면 파일과 검토 결과가 서로 섞이지 않습니다.",
  },
  upload: {
    eyebrow: "설계도서 등록",
    title: "문서 업로드",
    subtitle: "도면, 시방서, 내역서를 현재 선택된 프로젝트에 저장합니다.",
  },
  extracts: {
    eyebrow: "OCR 및 문서 읽기 결과",
    title: "추출 결과 보기",
    subtitle: "서버가 파일에서 읽어낸 내용을 검토 전에 확인합니다.",
  },
  results: {
    eyebrow: "카테고리별 검토",
    title: "AI 검토 결과",
    subtitle: "불일치, RFI, 설계변경, 공사비 영향으로 나누어 확인합니다.",
  },
};

const CATEGORIES = [
  { id: "mismatch", label: "불일치·누락", color: "red" },
  { id: "rfi", label: "RFI 후보", color: "blue" },
  { id: "change", label: "설계변경 검토", color: "amber" },
  { id: "cost", label: "공사비 영향", color: "green" },
];

const TRADE_OPTIONS = [
  "가설",
  "철거",
  "토공",
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
  "시험·검사",
];

const pageTitle = document.querySelector("#pageTitle");
const pageEyebrow = document.querySelector("#pageEyebrow");
const pageSubtitle = document.querySelector("#pageSubtitle");
const pageViews = document.querySelectorAll("[data-page]");
const navLinks = document.querySelectorAll("[data-page-link]");
const pageButtons = document.querySelectorAll("[data-page-button]");
const projectList = document.querySelector("#projectList");
const topProjectSelect = document.querySelector("#topProjectSelect");
const topbarActions = document.querySelector("#topbarActions");
const projectTable = document.querySelector("#projectTable");
const projectForm = document.querySelector("#projectForm");
const projectSubmitButton = projectForm.querySelector(".project-submit");
const projectScopeOptions = document.querySelector("#projectScopeOptions");
const uploadedFileList = document.querySelector("#uploadedFileList");
const reviewSourceList = document.querySelector("#reviewSourceList");
const selectAllReviewFiles = document.querySelector("#selectAllReviewFiles");
const currentProjectName = document.querySelector("#currentProjectName");
const currentProjectMeta = document.querySelector("#currentProjectMeta");
const dashboardStatus = document.querySelector("#dashboardStatus");
const extractList = document.querySelector("#extractList");
const categoryGrid = document.querySelector("#categoryGrid");
const tableBody = document.querySelector("#riskTable");
const detailTitle = document.querySelector("#detailTitle");
const detailPriority = document.querySelector("#detailPriority");
const detailIssue = document.querySelector("#detailIssue");
const detailSource = document.querySelector("#detailSource");
const detailAction = document.querySelector("#detailAction");
const rfiText = document.querySelector("#rfiText");
const tabs = document.querySelectorAll(".tab");
const runReview = document.querySelector("#runReview");
const copyRfi = document.querySelector("#copyRfi");
const generateRfiDocument = document.querySelector("#generateRfiDocument");
const rfiDocumentList = document.querySelector("#rfiDocumentList");
const resultDateFilter = document.querySelector("#resultDateFilter");
const resultFileFilter = document.querySelector("#resultFileFilter");
const resultTradeFilter = document.querySelector("#resultTradeFilter");
const resetResultFilters = document.querySelector("#resetResultFilters");
const storageStatus = document.querySelector("#storageStatus");
const fileNameFields = {
  drawing: document.querySelector("#drawingFileName"),
  spec: document.querySelector("#specFileName"),
  cost: document.querySelector("#costFileName"),
};

let state = {
  activePage: "home",
  activeProjectId: "",
  projects: [],
  files: [],
  documentExtracts: [],
  reviewItems: [],
  activeCategoryId: "mismatch",
  editingProjectId: "",
  selectedReviewFileIds: [],
  resultFilters: {
    date: "all",
    fileId: "all",
    trade: "all",
  },
};
let selectedRiskId = null;
let extractionPollTimer = null;
let extractionPollCount = 0;

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data.error || "서버 요청에 실패했습니다.");
  }

  return data;
}

function uploadToServer(projectId, kind, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const url = `${API_BASE_URL}/api/projects/${projectId}/files/upload?kind=${encodeURIComponent(kind)}&filename=${encodeURIComponent(file.name)}`;
    request.open("POST", url);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.max(1, Math.round((event.loaded / event.total) * 100));
      onProgress(percent);
    });

    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        const data = request.responseText ? JSON.parse(request.responseText) : {};
        resolve(data);
        return;
      }

      let message = `파일 업로드에 실패했습니다. 상태 코드: ${request.status}`;
      try {
        const data = JSON.parse(request.responseText || "{}");
        if (data.error) message = data.error;
      } catch {
        // Keep the default message.
      }
      reject(new Error(message));
    });

    request.addEventListener("error", () => {
      reject(new Error("서버에 파일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요."));
    });

    request.addEventListener("timeout", () => {
      reject(new Error("파일 업로드 시간이 너무 오래 걸립니다. 파일 크기와 네트워크 상태를 확인해 주세요."));
    });

    request.timeout = 1000 * 60 * 10;
    request.send(file);
  });
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

const projectCancelEditButton = createElement("button", "outline-btn project-cancel", "취소");
projectCancelEditButton.type = "button";
projectCancelEditButton.hidden = true;
projectForm.appendChild(projectCancelEditButton);

function renderScopeOptions() {
  projectScopeOptions.innerHTML = "";
  TRADE_OPTIONS.forEach((trade) => {
    const label = createElement("label", "scope-option");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = trade;
    input.addEventListener("change", () => {
      document.querySelector("#projectScopeInput").value = getSelectedScopes().join(", ");
    });
    label.appendChild(input);
    label.appendChild(createElement("span", "", trade));
    projectScopeOptions.appendChild(label);
  });
}

renderScopeOptions();

function activeProject() {
  return state.projects.find((project) => project.id === state.activeProjectId) || null;
}

function currentRisks() {
  return filteredReviewItems();
}

function currentRfiItems() {
  return currentRisks().filter((item) => classifyCategory(item) === "rfi");
}

function sourceProjectFiles() {
  return state.files
    .filter((file) => file.kind !== "rfi")
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

function rfiDocumentFiles() {
  return state.files
    .filter((file) => file.kind === "rfi")
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function groupByKind(items) {
  const groups = {
    cost: [],
    drawing: [],
    spec: [],
  };
  items.forEach((item) => {
    if (groups[item.kind]) groups[item.kind].push(item);
  });
  return groups;
}

function parseScope(scope = "") {
  return scope
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getSelectedScopes() {
  return [...projectScopeOptions.querySelectorAll("input:checked")].map((input) => input.value);
}

function setSelectedScopes(scope = "") {
  const selected = new Set(parseScope(scope));
  projectScopeOptions.querySelectorAll("input").forEach((input) => {
    input.checked = selected.has(input.value);
  });
  document.querySelector("#projectScopeInput").value = [...selected].join(", ");
}

function formatDateKey(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("ko-KR");
}

function selectedReviewFiles() {
  const ids = new Set(state.selectedReviewFileIds);
  return sourceProjectFiles().filter((file) => ids.has(file.id));
}

function reviewSourceText() {
  const files = selectedReviewFiles();
  if (files.length === 0) return "선택된 문서 없음";
  return files.map((file) => `${displayKind(file.kind)}: ${file.name}`).join(", ");
}

function syncSelectedReviewFileIds() {
  const sourceFiles = sourceProjectFiles();
  const existingIds = new Set(sourceFiles.map((file) => file.id));
  state.selectedReviewFileIds = state.selectedReviewFileIds.filter((id) => existingIds.has(id));

  if (state.selectedReviewFileIds.length === 0 && sourceFiles.length > 0) {
    state.selectedReviewFileIds = sourceFiles.map((file) => file.id);
  }
}

function filteredReviewItems() {
  return (state.reviewItems || []).filter((item) => {
    if (state.resultFilters.date !== "all" && formatDateKey(item.created_at) !== state.resultFilters.date) {
      return false;
    }

    if (state.resultFilters.trade !== "all" && item.type !== state.resultFilters.trade) {
      return false;
    }

    if (state.resultFilters.fileId !== "all") {
      const file = state.files.find((itemFile) => itemFile.id === state.resultFilters.fileId);
      const source = String(item.source || "");
      if (file && !source.includes(file.name) && !source.includes(displayKind(file.kind))) {
        return false;
      }
    }

    return true;
  });
}

function processingExtracts() {
  return state.documentExtracts.filter((extract) => extract.status === "processing");
}

function hasProcessingExtracts() {
  return processingExtracts().length > 0;
}

function selectedProcessingExtracts() {
  const selected = new Set(state.selectedReviewFileIds);
  return processingExtracts().filter((extract) => selected.has(extract.file_id));
}

function fallback(value, text = "-") {
  return value == null || value === "" ? text : value;
}

function displayKind(kind) {
  return {
    drawing: "도면",
    spec: "시방서",
    cost: "내역서",
    rfi: "RFI 문서",
  }[kind] || kind;
}

function displayStatus(status) {
  return {
    processing: "분석 중",
    extracted: "분석 완료",
    ocr_extracted: "OCR 완료",
    needs_ocr: "OCR 필요",
    unsupported: "지원 안 됨",
    failed: "분석 실패",
  }[status] || status || "상태 없음";
}

function classifyCategory(item) {
  const text = `${item.category || ""} ${item.decision || ""}`;
  if (text.includes("RFI") || text.includes("질의")) return "rfi";
  if (text.includes("공사비")) return "cost";
  if (text.includes("설계변경")) return "change";
  return "mismatch";
}

function categoryLabel(id) {
  return CATEGORIES.find((category) => category.id === id)?.label || "불일치·누락";
}

function colorForCategory(id) {
  return CATEGORIES.find((category) => category.id === id)?.color || "red";
}

function priorityLevel(value = "") {
  if (value.includes("높") || value.includes("?믪쓬")) return "high";
  if (value.includes("중") || value.includes("以묎컙")) return "medium";
  return "low";
}

function priorityLabel(value = "") {
  const level = priorityLevel(value);
  if (level === "high") return "높음";
  if (level === "medium") return "중간";
  return value && !value.includes("?") ? value : "낮음";
}

function setPage(page, syncHash = true) {
  const nextPage = PAGE_META[page] ? page : "dashboard";
  state.activePage = nextPage;
  const meta = PAGE_META[nextPage];

  pageEyebrow.textContent = meta.eyebrow;
  pageTitle.textContent = meta.title;
  pageSubtitle.textContent = meta.subtitle;
  runReview.hidden = nextPage === "home";
  if (topbarActions) {
    topbarActions.hidden = nextPage === "home";
  }

  pageViews.forEach((view) => {
    view.classList.toggle("active", view.dataset.page === nextPage);
  });

  navLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.pageLink === nextPage);
  });

  if (syncHash && location.hash !== `#${nextPage}`) {
    history.replaceState(null, "", `#${nextPage}`);
  }
}

function countByCategory(id) {
  return risksByCategory(id).length;
}

function risksByCategory(id) {
  return currentRisks().filter((item) => classifyCategory(item) === id);
}

function renderProjectList() {
  projectList.innerHTML = "";

  if (state.projects.length === 0) {
    projectList.appendChild(createElement("p", "sidebar-empty", "생성된 프로젝트가 없습니다."));
    return;
  }

  state.projects.forEach((project) => {
    const button = createElement("button", `project-chip ${project.id === state.activeProjectId ? "active" : ""}`);
    button.type = "button";
    button.appendChild(createElement("strong", "", project.name));
    button.appendChild(createElement("span", "", `${fallback(project.amount, "금액 미입력")} · ${fallback(project.scope, "범위 미입력")}`));
    button.addEventListener("click", () => loadProject(project.id));
    projectList.appendChild(button);
  });
}

function renderTopProjectSelect() {
  if (!topProjectSelect) return;

  topProjectSelect.innerHTML = "";

  if (state.projects.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "프로젝트 없음";
    topProjectSelect.appendChild(option);
    topProjectSelect.disabled = true;
    return;
  }

  topProjectSelect.disabled = false;
  state.projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    option.selected = project.id === state.activeProjectId;
    topProjectSelect.appendChild(option);
  });
}

function renderProjectTable() {
  projectTable.innerHTML = "";

  if (state.projects.length === 0) {
    projectTable.appendChild(createElement("p", "empty-text", "아직 프로젝트가 없습니다. 위 입력창에서 먼저 생성해 주세요."));
    return;
  }

  state.projects.forEach((project) => {
    const row = createElement("article", `project-row ${project.id === state.activeProjectId ? "active" : ""}`);
    const name = createElement("div");
    name.appendChild(createElement("strong", "", project.name));
    name.appendChild(createElement("span", "", project.created_at ? new Date(project.created_at).toLocaleDateString("ko-KR") : ""));
    row.appendChild(name);
    row.appendChild(createElement("span", "", fallback(project.amount, "금액 미입력")));
    row.appendChild(createElement("span", "", fallback(project.scope, "범위 미입력")));

    const button = createElement("button", "secondary-btn", project.id === state.activeProjectId ? "선택됨" : "선택");
    button.type = "button";
    button.disabled = project.id === state.activeProjectId;
    button.addEventListener("click", () => loadProject(project.id));
    row.appendChild(button);

    const editButton = createElement("button", "outline-btn", "수정");
    editButton.type = "button";
    editButton.addEventListener("click", () => startProjectEdit(project));
    row.appendChild(editButton);

    const deleteButton = createElement("button", "danger-btn", "삭제");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => removeProject(project));
    row.appendChild(deleteButton);

    projectTable.appendChild(row);
  });
}

function renderProjectHeader() {
  const project = activeProject();
  if (!project) {
    currentProjectName.textContent = "프로젝트 없음";
    currentProjectMeta.textContent = "프로젝트를 먼저 생성해 주세요.";
    fileNameFields.drawing.textContent = "선택된 파일 없음";
    fileNameFields.spec.textContent = "선택된 파일 없음";
    fileNameFields.cost.textContent = "선택된 파일 없음";
    return;
  }

  currentProjectName.textContent = project.name;
  currentProjectMeta.textContent = `${fallback(project.amount, "금액 미입력")} · ${fallback(project.scope, "범위 미입력")}`;

  ["drawing", "spec", "cost"].forEach((kind) => {
    const files = sourceProjectFiles().filter((item) => item.kind === kind);
    fileNameFields[kind].textContent =
      files.length > 0 ? `${files.length}개 파일 · 최근 ${files[files.length - 1].name}` : "선택된 파일 없음";
  });
}

function renderDashboard() {
  document.querySelector("#countProjects").textContent = state.projects.length;
  document.querySelector("#countFiles").textContent = state.files.length;
  document.querySelector("#countExtracts").textContent = state.documentExtracts.length;
  document.querySelector("#countReviews").textContent = state.reviewItems.length;

  const project = activeProject();
  const rows = [
    ["선택 프로젝트", project?.name || "없음"],
    ["업로드 상태", `${state.files.length}개 파일 등록`],
    ["문서 추출", `${state.documentExtracts.length}개 추출 결과`],
    ["AI 검토", `${state.reviewItems.length}개 검토 항목`],
  ];

  dashboardStatus.innerHTML = "";
  rows.forEach(([label, value]) => {
    const row = createElement("div", "status-row");
    row.appendChild(createElement("span", "", label));
    row.appendChild(createElement("strong", "", value));
    dashboardStatus.appendChild(row);
  });
}

function renderCounts() {
  document.querySelector("#countMismatch").textContent = countByCategory("mismatch");
  document.querySelector("#countRfi").textContent = countByCategory("rfi");
  document.querySelector("#countChange").textContent = countByCategory("change");
  document.querySelector("#countCost").textContent = countByCategory("cost");
}

function renderResultFilters() {
  if (!resultDateFilter || !resultFileFilter || !resultTradeFilter) return;

  const dates = [...new Set((state.reviewItems || []).map((item) => formatDateKey(item.created_at)).filter(Boolean))];
  const trades = [
    ...new Set([
      ...parseScope(activeProject()?.scope || ""),
      ...(state.reviewItems || []).map((item) => item.type).filter(Boolean),
    ]),
  ];
  const files = sourceProjectFiles();

  const renderOptions = (select, options, activeValue, allLabel) => {
    select.innerHTML = "";
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = allLabel;
    select.appendChild(all);

    options.forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });

    select.value = options.some((option) => option.value === activeValue) ? activeValue : "all";
  };

  renderOptions(
    resultDateFilter,
    dates.map((date) => ({ value: date, label: date })),
    state.resultFilters.date,
    "전체 일자",
  );
  renderOptions(
    resultFileFilter,
    files.map((file) => ({ value: file.id, label: `${displayKind(file.kind)} · ${file.name}` })),
    state.resultFilters.fileId,
    "전체 파일",
  );
  renderOptions(
    resultTradeFilter,
    trades.map((trade) => ({ value: trade, label: trade })),
    state.resultFilters.trade,
    "전체 공종",
  );
}

function renderExtracts() {
  extractList.innerHTML = "";

  if (!activeProject()) {
    extractList.appendChild(createElement("p", "empty-text", "프로젝트를 먼저 선택해 주세요."));
    return;
  }

  if (state.documentExtracts.length === 0) {
    extractList.appendChild(createElement("p", "empty-text", "아직 추출된 문서가 없습니다. 문서 업로드 화면에서 파일을 등록해 주세요."));
    return;
  }

  const groups = groupByKind(
    state.documentExtracts.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
  );

  ["cost", "drawing", "spec"].forEach((kind) => {
    const section = createElement("section", "document-kind-section");
    section.appendChild(createElement("h3", "", `${displayKind(kind)} (${groups[kind].length}개)`));

    if (groups[kind].length === 0) {
      section.appendChild(createElement("p", "empty-text", "아직 추출 결과가 없습니다."));
    }

    groups[kind].forEach((extract) => {
      const card = createElement("article", "extract-card");
      const header = createElement("header");
      const titleWrap = createElement("div");
      titleWrap.appendChild(createElement("h3", "", extract.name));
      titleWrap.appendChild(
        createElement("p", "", `${displayKind(extract.kind)} · ${displayStatus(extract.status)} · ${new Date(extract.created_at).toLocaleString("ko-KR")}`),
      );
      header.appendChild(titleWrap);
      const headerActions = createElement("div", "file-actions");
      headerActions.appendChild(createElement("span", "status-badge", displayStatus(extract.status)));
      const deleteButton = createElement("button", "danger-btn", "삭제");
      deleteButton.type = "button";
      deleteButton.addEventListener("click", () => deleteFile(extract.file_id));
      headerActions.appendChild(deleteButton);
      header.appendChild(headerActions);
      card.appendChild(header);

      if (extract.warning) {
        card.appendChild(createElement("p", "", `확인 필요: ${extract.warning}`));
      }

      const emptyText =
        extract.status === "processing"
          ? "파일 저장은 끝났고, 서버가 문서 내용을 읽는 중입니다. 큰 PDF나 OCR 파일은 시간이 더 걸릴 수 있습니다."
          : "추출된 텍스트가 없습니다.";
      const text = createElement("div", "extract-text", extract.extracted_text?.trim() || emptyText);
      card.appendChild(text);
      section.appendChild(card);
    });

    extractList.appendChild(section);
  });
}

function renderUploadedFiles() {
  if (!uploadedFileList) return;

  uploadedFileList.innerHTML = "";

  if (!activeProject()) {
    uploadedFileList.appendChild(createElement("p", "empty-text", "프로젝트를 먼저 선택해 주세요."));
    return;
  }

  const sourceFiles = sourceProjectFiles();

  if (sourceFiles.length === 0) {
    uploadedFileList.appendChild(createElement("p", "empty-text", "아직 업로드된 파일이 없습니다."));
    return;
  }

  const groups = groupByKind(sourceFiles);
  ["cost", "drawing", "spec"].forEach((kind) => {
    const section = createElement("section", "document-kind-section");
    section.appendChild(createElement("h3", "", `${displayKind(kind)} (${groups[kind].length}개)`));

    if (groups[kind].length === 0) {
      section.appendChild(createElement("p", "empty-text", "아직 업로드된 파일이 없습니다."));
    }

    groups[kind].forEach((file) => {
      const row = createElement("article", "uploaded-file-row");
      const info = createElement("div");
      info.appendChild(createElement("strong", "", file.name));
      info.appendChild(createElement("span", "", `${displayKind(file.kind)} · ${new Date(file.created_at).toLocaleString("ko-KR")}`));
      row.appendChild(info);

      const button = createElement("button", "danger-btn", "삭제");
      button.type = "button";
      button.addEventListener("click", () => deleteFile(file.id));
      row.appendChild(button);
      section.appendChild(row);
    });

    uploadedFileList.appendChild(section);
  });
}

function renderReviewSourceSelection() {
  if (!reviewSourceList) return;

  reviewSourceList.innerHTML = "";

  if (!activeProject()) {
    reviewSourceList.appendChild(createElement("p", "empty-text", "프로젝트를 먼저 선택해 주세요."));
    return;
  }

  const files = sourceProjectFiles();
  if (files.length === 0) {
    reviewSourceList.appendChild(createElement("p", "empty-text", "AI 검토에 사용할 문서를 먼저 업로드해 주세요."));
    return;
  }

  const selected = new Set(state.selectedReviewFileIds);
  const groups = groupByKind(files);
  ["cost", "drawing", "spec"].forEach((kind) => {
    const section = createElement("section", "document-kind-section");
    section.appendChild(createElement("h3", "", `${displayKind(kind)} (${groups[kind].length}개)`));

    groups[kind].forEach((file) => {
      const label = createElement("label", "review-source-row");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = selected.has(file.id);
      input.addEventListener("change", () => {
        if (input.checked) {
          state.selectedReviewFileIds = [...new Set([...state.selectedReviewFileIds, file.id])];
        } else {
          state.selectedReviewFileIds = state.selectedReviewFileIds.filter((id) => id !== file.id);
        }
      });
      label.appendChild(input);
      const text = createElement("span");
      text.appendChild(createElement("strong", "", file.name));
      text.appendChild(createElement("small", "", new Date(file.created_at).toLocaleString("ko-KR")));
      label.appendChild(text);
      section.appendChild(label);
    });

    reviewSourceList.appendChild(section);
  });
}

function renderRfiDocuments() {
  if (!rfiDocumentList) return;

  rfiDocumentList.innerHTML = "";

  if (!activeProject()) {
    rfiDocumentList.appendChild(createElement("p", "empty-text", "프로젝트를 먼저 선택해 주세요."));
    return;
  }

  const documents = rfiDocumentFiles();
  if (documents.length === 0) {
    rfiDocumentList.appendChild(createElement("p", "empty-text", "아직 생성된 RFI 문서가 없습니다."));
    return;
  }

  documents.forEach((file) => {
    const row = createElement("article", "rfi-document-row");
    const info = createElement("div");
    info.appendChild(createElement("strong", "", file.name));
    info.appendChild(createElement("span", "", new Date(file.created_at).toLocaleString("ko-KR")));
    row.appendChild(info);

    const actions = createElement("div", "rfi-document-actions");
    const downloadButton = createElement("button", "secondary-btn", "다운로드");
    downloadButton.type = "button";
    downloadButton.addEventListener("click", () => downloadProjectFile(file));
    actions.appendChild(downloadButton);

    const deleteButton = createElement("button", "danger-btn", "삭제");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => deleteFile(file.id));
    actions.appendChild(deleteButton);

    row.appendChild(actions);
    rfiDocumentList.appendChild(row);
  });
}

function renderCategoryOutput() {
  categoryGrid.innerHTML = "";

  const activeCategory =
    CATEGORIES.find((category) => category.id === state.activeCategoryId) || CATEGORIES[0];
  const activeItems = risksByCategory(activeCategory.id);

  const tabs = createElement("div", "category-tabs");
  CATEGORIES.forEach((category) => {
    const count = countByCategory(category.id);
    const button = createElement(
      "button",
      `category-tab ${category.id === activeCategory.id ? "active" : ""}`,
    );
    button.type = "button";
    button.appendChild(createElement("strong", "", category.label));
    button.appendChild(createElement("span", "", `${count}건`));
    button.addEventListener("click", () => {
      state.activeCategoryId = category.id;
      const firstItem = risksByCategory(category.id)[0];
      if (firstItem) {
        selectRisk(firstItem.id);
      } else {
        selectedRiskId = null;
        clearDetail();
        renderRows();
        renderCategoryOutput();
      }
    });
    tabs.appendChild(button);
  });
  categoryGrid.appendChild(tabs);

  const panel = createElement("article", "category-panel active");
  const head = createElement("div", "category-head");
  head.appendChild(createElement("h3", "", activeCategory.label));
  head.appendChild(createElement("span", "", `${activeItems.length}건`));
  panel.appendChild(head);

  const list = createElement("div", "category-items");
  if (activeItems.length === 0) {
    list.appendChild(createElement("p", "empty-text", "아직 출력된 항목이 없습니다."));
  } else {
    activeItems.forEach((item) => {
      const button = createElement(
        "button",
        `category-item ${item.id === selectedRiskId ? "selected" : ""}`,
      );
      button.type = "button";
      button.appendChild(createElement("strong", "", fallback(item.issue, "확인 필요 항목")));
      button.appendChild(createElement("span", "", fallback(item.source, "관련 문서 미표시")));
      button.appendChild(createElement("em", "", priorityLabel(item.priority)));
      button.addEventListener("click", () => {
        selectRisk(item.id);
        setPage("results");
      });
      list.appendChild(button);
    });
  }

  panel.appendChild(list);
  categoryGrid.appendChild(panel);
}

function renderRows(filter = document.querySelector(".tab.active")?.dataset.filter || "all") {
  tableBody.innerHTML = "";
  const rows = currentRisks().filter((item) => {
    if (filter === "all") return true;
    if (filter === "high") return priorityLevel(item.priority) === "high";
    return classifyCategory(item) === filter;
  });

  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = createElement("td", "empty-cell", "현재 조건에 맞는 검토 결과가 없습니다.");
    cell.colSpan = 5;
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  rows.forEach((item) => {
    const row = document.createElement("tr");
    const categoryId = classifyCategory(item);
    row.tabIndex = 0;
    row.className = item.id === selectedRiskId ? "selected" : "";

    const typeCell = document.createElement("td");
    typeCell.appendChild(createElement("span", `pill ${colorForCategory(categoryId)}`, fallback(item.type, categoryLabel(categoryId))));
    row.appendChild(typeCell);
    row.appendChild(createElement("td", "", fallback(item.issue, "확인 필요 항목")));
    row.appendChild(createElement("td", "", fallback(item.source, "관련 문서 미표시")));

    const decisionCell = document.createElement("td");
    decisionCell.appendChild(createElement("span", `pill ${colorForCategory(categoryId)}`, categoryLabel(categoryId)));
    row.appendChild(decisionCell);
    row.appendChild(createElement("td", "", priorityLabel(item.priority)));

    row.addEventListener("click", () => selectRisk(item.id));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter") selectRisk(item.id);
    });
    tableBody.appendChild(row);
  });
}

function clearDetail() {
  detailTitle.textContent = "선택된 항목 없음";
  detailPriority.textContent = "대기";
  detailPriority.className = "priority-badge low";
  detailIssue.textContent = "검토 항목을 선택하면 상세 내용이 표시됩니다.";
  detailSource.textContent = "-";
  detailAction.textContent = "-";
  rfiText.textContent = "RFI 후보 항목을 선택하면 문안 초안이 표시됩니다.";
}

function selectRisk(id) {
  selectedRiskId = id;
  const item = currentRisks().find((risk) => risk.id === id);
  if (!item) {
    clearDetail();
    return;
  }

  state.activeCategoryId = classifyCategory(item);
  const priority = priorityLevel(item.priority);
  detailTitle.textContent = fallback(item.issue, "검토 항목");
  detailPriority.textContent = priorityLabel(item.priority);
  detailPriority.className = `priority-badge ${priority}`;
  detailIssue.textContent = fallback(item.issue, "확인 필요 항목");
  detailSource.textContent = fallback(item.source, "관련 문서 미표시");
  detailAction.textContent = fallback(item.action, "담당자 확인이 필요합니다.");
  rfiText.textContent = fallback(item.rfi, "관련 설계도서 기준 확인을 요청드립니다.");
  renderRows();
  renderCategoryOutput();
}

function showToast(message) {
  const toast = createElement("div", "toast", message);
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2300);
}

function updateUploadStatus(message) {
  if (storageStatus) {
    storageStatus.textContent = message;
  }
}

function stopExtractionPolling() {
  if (extractionPollTimer) {
    window.clearInterval(extractionPollTimer);
    extractionPollTimer = null;
  }
  extractionPollCount = 0;
}

function startExtractionPolling() {
  if (!state.activeProjectId || extractionPollTimer) return;

  extractionPollCount = 0;
  extractionPollTimer = window.setInterval(async () => {
    extractionPollCount += 1;

    try {
      await loadProject(state.activeProjectId, { silent: true });
      if (!hasProcessingExtracts()) {
        stopExtractionPolling();
        showToast("문서 분석이 완료되었습니다.");
      }
    } catch {
      if (extractionPollCount >= 30) {
        stopExtractionPolling();
        showToast("분석 상태 확인이 지연되고 있습니다. 잠시 후 추출 결과 화면을 다시 열어 주세요.");
      }
    }

    if (extractionPollCount >= 30 && hasProcessingExtracts()) {
      stopExtractionPolling();
      showToast("분석이 오래 걸리고 있습니다. 큰 PDF나 OCR 파일은 시간이 더 필요할 수 있습니다.");
    }
  }, 4000);
}

function renderAll() {
  renderProjectList();
  renderTopProjectSelect();
  renderProjectTable();
  renderProjectHeader();
  renderDashboard();
  renderResultFilters();
  renderUploadedFiles();
  renderReviewSourceSelection();
  renderRfiDocuments();
  renderCounts();
  renderExtracts();
  renderCategoryOutput();
  renderRows();

  if (selectedRiskId) {
    selectRisk(selectedRiskId);
  } else {
    clearDetail();
  }
}

async function loadProjects() {
  const data = await api("/api/projects");
  state.projects = data.projects || [];
  if (!state.activeProjectId && state.projects[0]) {
    state.activeProjectId = state.projects[0].id;
  }

  if (state.activeProjectId) {
    await loadProject(state.activeProjectId);
    return;
  }

  renderAll();
}

async function loadProject(projectId, options = {}) {
  const data = await api(`/api/projects/${projectId}`);
  const projectChanged = state.activeProjectId !== projectId;
  state.activeProjectId = projectId;
  state.files = data.files || [];
  state.documentExtracts = data.documentExtracts || [];
  state.reviewItems = data.reviewItems || [];
  syncSelectedReviewFileIds();

  if (projectChanged && !options.silent) {
    state.resultFilters = {
      date: "all",
      fileId: "all",
      trade: "all",
    };
  }

  const exists = state.projects.some((project) => project.id === data.project.id);
  if (!exists) {
    state.projects = [data.project, ...state.projects];
  }

  if (!options.silent) {
    selectedRiskId = null;
  }
  const processingCount = processingExtracts().length;
  if (processingCount > 0) {
    updateUploadStatus(`서버 분석 중 ${processingCount}개`);
    startExtractionPolling();
  } else {
    updateUploadStatus(state.files.length > 0 ? `${state.files.length}개 파일` : "서버 저장");
    if (!options.silent) {
      stopExtractionPolling();
    }
  }
  renderAll();
}

async function uploadFile(projectId, input) {
  const files = [...input.files];
  if (files.length === 0) return;

  const kind = input.dataset.fileKind;
  fileNameFields[kind].textContent = "서버 업로드 준비 중";
  updateUploadStatus("업로드 준비 중");

  fileNameFields[kind].textContent = "파일 전송 중";
  updateUploadStatus("파일 전송 중");

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const label = `${index + 1}/${files.length}`;
    fileNameFields[kind].textContent = `${label} uploading`;
    updateUploadStatus(`${displayKind(kind)} ${label} uploading`);

    await uploadToServer(projectId, kind, file, (percent) => {
      fileNameFields[kind].textContent = `${label} uploading ${percent}%`;
      updateUploadStatus(`${displayKind(kind)} ${label} uploading ${percent}%`);
    });
  }

  await loadProject(projectId);
  setPage("extracts");
  startExtractionPolling();
  showToast("파일 저장은 완료되었습니다. 문서 분석은 서버에서 계속 진행됩니다.");
}

async function deleteFile(fileId) {
  const project = activeProject();
  if (!project || !fileId) {
    showToast("삭제할 파일을 찾지 못했습니다.");
    return;
  }

  const file = state.files.find((item) => item.id === fileId);
  const fileName = file?.name || "선택한 파일";
  const confirmed = window.confirm(`${fileName} 파일을 삭제할까요?\n문서 추출 결과도 함께 삭제됩니다.`);
  if (!confirmed) return;

  try {
    updateUploadStatus("파일 삭제 중");
    await api(`/api/projects/${project.id}/files/${fileId}`, {
      method: "DELETE",
    });
    selectedRiskId = null;
    await loadProject(project.id);
    showToast("파일을 삭제했습니다.");
  } catch (error) {
    showToast(error.message);
  }
}

async function downloadProjectFile(file) {
  const project = activeProject();
  if (!project || !file?.id) {
    showToast("다운로드할 파일을 찾지 못했습니다.");
    return;
  }

  try {
    const data = await api(`/api/projects/${project.id}/files/${file.id}/download`);
    if (!data.downloadUrl) {
      throw new Error("다운로드 주소를 만들지 못했습니다.");
    }

    const link = document.createElement("a");
    link.href = data.downloadUrl;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    showToast(error.message);
  }
}

function setProjectFormMode(project = null) {
  state.editingProjectId = project?.id || "";
  document.querySelector("#projectNameInput").value = project?.name || "";
  document.querySelector("#projectAmountInput").value = project?.amount || "";
  setSelectedScopes(project?.scope || "");
  projectSubmitButton.textContent = project ? "프로젝트 저장" : "프로젝트 생성";
  projectCancelEditButton.hidden = !project;
}

function startProjectEdit(project) {
  setProjectFormMode(project);
  setPage("projects");
  document.querySelector("#projectNameInput").focus();
}

async function removeProject(project) {
  const confirmed = window.confirm(
    `${project.name} 프로젝트를 삭제할까요?\n업로드 파일, 문서 추출 결과, AI 검토 결과도 함께 삭제됩니다.`,
  );
  if (!confirmed) return;

  try {
    await api(`/api/projects/${project.id}`, {
      method: "DELETE",
    });

    state.projects = state.projects.filter((item) => item.id !== project.id);
    if (state.activeProjectId === project.id) {
      state.activeProjectId = state.projects[0]?.id || "";
      state.files = [];
      state.documentExtracts = [];
      state.reviewItems = [];
      selectedRiskId = null;
      if (state.activeProjectId) {
        await loadProject(state.activeProjectId, { silent: true });
      }
    }

    if (state.editingProjectId === project.id) {
      setProjectFormMode();
    }

    renderAll();
    showToast("프로젝트를 삭제했습니다.");
  } catch (error) {
    showToast(error.message);
  }
}

projectCancelEditButton.addEventListener("click", () => {
  setProjectFormMode();
});

projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.querySelector("#projectNameInput").value.trim();
  const amount = document.querySelector("#projectAmountInput").value.trim();
  const scope = document.querySelector("#projectScopeInput").value.trim();
  if (!name) return;

  try {
    if (state.editingProjectId) {
      const { project } = await api(`/api/projects/${state.editingProjectId}`, {
        method: "PATCH",
        body: JSON.stringify({ name, amount, scope }),
      });
      state.projects = state.projects.map((item) => (item.id === project.id ? project : item));
      setProjectFormMode();
      await loadProject(project.id);
      showToast("프로젝트를 수정했습니다.");
      return;
    }

    const { project } = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, amount, scope }),
    });
    state.projects = [project, ...state.projects];
    setProjectFormMode();
    await loadProject(project.id);
    setPage("upload");
    showToast("프로젝트를 생성했습니다.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelectorAll("[data-file-kind]").forEach((input) => {
  input.addEventListener("change", async () => {
    const project = activeProject();
    if (!project) {
      showToast("먼저 프로젝트를 생성하거나 선택해 주세요.");
      setPage("projects");
      input.value = "";
      return;
    }

    try {
      await uploadFile(project.id, input);
    } catch (error) {
      showToast(error.message);
    } finally {
      input.value = "";
    }
  });
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    renderRows(tab.dataset.filter);
  });
});

topProjectSelect?.addEventListener("change", () => {
  if (topProjectSelect.value) {
    loadProject(topProjectSelect.value);
  }
});

selectAllReviewFiles?.addEventListener("click", () => {
  const files = sourceProjectFiles();
  const allSelected = files.length > 0 && files.every((file) => state.selectedReviewFileIds.includes(file.id));
  state.selectedReviewFileIds = allSelected ? [] : files.map((file) => file.id);
  renderReviewSourceSelection();
});

resultDateFilter?.addEventListener("change", () => {
  state.resultFilters.date = resultDateFilter.value;
  selectedRiskId = null;
  renderAll();
});

resultFileFilter?.addEventListener("change", () => {
  state.resultFilters.fileId = resultFileFilter.value;
  selectedRiskId = null;
  renderAll();
});

resultTradeFilter?.addEventListener("change", () => {
  state.resultFilters.trade = resultTradeFilter.value;
  selectedRiskId = null;
  renderAll();
});

resetResultFilters?.addEventListener("click", () => {
  state.resultFilters = {
    date: "all",
    fileId: "all",
    trade: "all",
  };
  selectedRiskId = null;
  renderAll();
});

runReview.addEventListener("click", async () => {
  const project = activeProject();
  if (!project) {
    showToast("먼저 프로젝트를 생성하거나 선택해 주세요.");
    setPage("projects");
    return;
  }

  if (state.selectedReviewFileIds.length === 0) {
    showToast("AI 검토에 사용할 문서를 하나 이상 선택해 주세요.");
    setPage("upload");
    return;
  }

  if (selectedProcessingExtracts().length > 0) {
    showToast("문서 분석이 아직 진행 중입니다. 추출 결과 화면에서 완료 상태를 확인해 주세요.");
    setPage("extracts");
    startExtractionPolling();
    return;
  }

  document.body.classList.add("is-running");
  runReview.disabled = true;
  runReview.textContent = "검토 중";

  try {
    const data = await api(`/api/projects/${project.id}/reviews/run`, {
      method: "POST",
      body: JSON.stringify({
        fileIds: state.selectedReviewFileIds,
        notes: `선택된 문서만 기준으로 1차 설계관리 리스크 후보를 분류합니다. 검토 대상: ${reviewSourceText()}. 검토 공종: ${
          activeProject()?.scope || "전체"
        }.`,
      }),
    });
    state.reviewItems = data.reviewItems || [];
    selectedRiskId = state.reviewItems[0]?.id || null;
    state.resultFilters = {
      date: "all",
      fileId: "all",
      trade: "all",
    };
    renderAll();
    setPage("results");
    showToast(data.warning || "AI 검토 결과를 저장했습니다.");
  } catch (error) {
    showToast(error.message);
  } finally {
    document.body.classList.remove("is-running");
    runReview.disabled = false;
    runReview.textContent = "AI 검토 실행";
  }
});

copyRfi.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(rfiText.textContent.trim());
    showToast("RFI 문안을 복사했습니다.");
  } catch {
    showToast("브라우저에서 복사를 허용하지 않았습니다.");
  }
});

generateRfiDocument.addEventListener("click", async () => {
  const project = activeProject();
  if (!project) {
    showToast("먼저 프로젝트를 생성하거나 선택해 주세요.");
    setPage("projects");
    return;
  }

  const rfiCount = currentRfiItems().length;
  if (rfiCount === 0) {
    showToast("생성할 RFI 후보가 없습니다. 먼저 AI 검토를 실행해 주세요.");
    return;
  }

  generateRfiDocument.disabled = true;
  generateRfiDocument.textContent = "문서 생성 중";

  try {
    const data = await api(`/api/projects/${project.id}/rfi-documents`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (data.downloadUrl) {
      const link = document.createElement("a");
      link.href = data.downloadUrl;
      link.download = data.file?.name || "RFI.docx";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    await loadProject(project.id, { silent: true });
    showToast(`${data.count || rfiCount}건의 RFI 문서를 생성했습니다.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    generateRfiDocument.disabled = false;
    generateRfiDocument.textContent = "RFI 문서 생성";
  }
});

navLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    setPage(link.dataset.pageLink);
  });
});

pageButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setPage(button.dataset.pageButton);
  });
});

window.addEventListener("hashchange", () => {
  setPage(location.hash.replace("#", ""), false);
});

setPage(location.hash.replace("#", "") || "home", false);
loadProjects().catch((error) => {
  showToast(error.message);
  renderAll();
});
