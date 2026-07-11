const API_BASE_URL = "https://ai-cm-production.up.railway.app";

const PAGE_META = {
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

const pageTitle = document.querySelector("#pageTitle");
const pageEyebrow = document.querySelector("#pageEyebrow");
const pageSubtitle = document.querySelector("#pageSubtitle");
const pageViews = document.querySelectorAll("[data-page]");
const navLinks = document.querySelectorAll("[data-page-link]");
const projectList = document.querySelector("#projectList");
const projectTable = document.querySelector("#projectTable");
const projectForm = document.querySelector("#projectForm");
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
const storageStatus = document.querySelector("#storageStatus");
const fileNameFields = {
  drawing: document.querySelector("#drawingFileName"),
  spec: document.querySelector("#specFileName"),
  cost: document.querySelector("#costFileName"),
};

let state = {
  activePage: "dashboard",
  activeProjectId: "",
  projects: [],
  files: [],
  documentExtracts: [],
  reviewItems: [],
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

function uploadToStorage(upload, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(upload.method, upload.uploadUrl);

    Object.entries(upload.headers || {}).forEach(([name, value]) => {
      request.setRequestHeader(name, value);
    });

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.max(1, Math.round((event.loaded / event.total) * 100));
      onProgress(percent);
    });

    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }

      reject(new Error(`파일 저장소 업로드에 실패했습니다. 상태 코드: ${request.status}`));
    });

    request.addEventListener("error", () => {
      reject(new Error("파일 저장소에 연결하지 못했습니다. R2 CORS 설정 또는 저장소 권한을 확인해 주세요."));
    });

    request.addEventListener("timeout", () => {
      reject(new Error("파일 업로드 시간이 너무 오래 걸립니다. 파일 크기와 네트워크 상태를 확인해 주세요."));
    });

    request.timeout = 1000 * 60 * 5;
    request.send(file);
  });
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function activeProject() {
  return state.projects.find((project) => project.id === state.activeProjectId) || null;
}

function currentRisks() {
  return state.reviewItems || [];
}

function processingExtracts() {
  return state.documentExtracts.filter((extract) => extract.status === "processing");
}

function hasProcessingExtracts() {
  return processingExtracts().length > 0;
}

function fallback(value, text = "-") {
  return value == null || value === "" ? text : value;
}

function displayKind(kind) {
  return {
    drawing: "도면",
    spec: "시방서",
    cost: "내역서",
  }[kind] || kind;
}

function classifyCategory(item) {
  const text = `${item.category || ""} ${item.decision || ""}`;
  if (text.includes("RFI")) return "rfi";
  if (text.includes("공사비") || text.includes("怨듭궗鍮")) return "cost";
  if (text.includes("설계변경") || text.includes("蹂寃") || text.includes("?ㅺ퀎")) return "change";
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
  return currentRisks().filter((item) => classifyCategory(item) === id).length;
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
    const file = state.files.find((item) => item.kind === kind);
    fileNameFields[kind].textContent = file?.name || "선택된 파일 없음";
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

  state.documentExtracts.forEach((extract) => {
    const card = createElement("article", "extract-card");
    const header = createElement("header");
    const titleWrap = createElement("div");
    titleWrap.appendChild(createElement("h3", "", extract.name));
    titleWrap.appendChild(createElement("p", "", `${displayKind(extract.kind)} · ${extract.status}`));
    header.appendChild(titleWrap);
    const statusText =
      extract.status === "processing"
        ? "분석 중"
        : extract.status === "ocr_extracted"
          ? "OCR 추출"
          : extract.status;
    header.appendChild(createElement("span", "status-badge", statusText));
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
    extractList.appendChild(card);
  });
}

function renderCategoryOutput() {
  categoryGrid.innerHTML = "";

  CATEGORIES.forEach((category) => {
    const items = currentRisks().filter((item) => classifyCategory(item) === category.id);
    const panel = createElement("article", "category-panel");
    const head = createElement("div", "category-head");
    head.appendChild(createElement("h3", "", category.label));
    head.appendChild(createElement("span", "", `${items.length}건`));
    panel.appendChild(head);

    const list = createElement("div", "category-items");
    if (items.length === 0) {
      list.appendChild(createElement("p", "empty-text", "아직 출력된 항목이 없습니다."));
    } else {
      items.forEach((item) => {
        const button = createElement("button", "category-item");
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
  });
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

  const priority = priorityLevel(item.priority);
  detailTitle.textContent = fallback(item.issue, "검토 항목");
  detailPriority.textContent = priorityLabel(item.priority);
  detailPriority.className = `priority-badge ${priority}`;
  detailIssue.textContent = fallback(item.issue, "확인 필요 항목");
  detailSource.textContent = fallback(item.source, "관련 문서 미표시");
  detailAction.textContent = fallback(item.action, "담당자 확인이 필요합니다.");
  rfiText.textContent = fallback(item.rfi, "관련 설계도서 기준 확인을 요청드립니다.");
  renderRows();
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
  renderProjectTable();
  renderProjectHeader();
  renderDashboard();
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
  state.activeProjectId = projectId;
  state.files = data.files || [];
  state.documentExtracts = data.documentExtracts || [];
  state.reviewItems = data.reviewItems || [];

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
  const file = input.files[0];
  if (!file) return;

  const kind = input.dataset.fileKind;
  fileNameFields[kind].textContent = "업로드 주소 요청 중";
  updateUploadStatus("업로드 준비 중");

  const { upload } = await api(`/api/projects/${projectId}/files/presign`, {
    method: "POST",
    body: JSON.stringify({
      kind,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
    }),
  });

  fileNameFields[kind].textContent = "파일 전송 중";
  updateUploadStatus("파일 전송 중");

  await uploadToStorage(upload, file, (percent) => {
    fileNameFields[kind].textContent = `파일 전송 중 ${percent}%`;
    updateUploadStatus(`파일 전송 중 ${percent}%`);
  });

  fileNameFields[kind].textContent = "서버 분석 등록 중";
  updateUploadStatus("서버 분석 등록 중");

  await api(`/api/projects/${projectId}/files`, {
    method: "POST",
    body: JSON.stringify({
      kind,
      name: file.name,
      r2Key: upload.key,
      url: upload.publicUrl,
    }),
  });

  await loadProject(projectId);
  setPage("extracts");
  startExtractionPolling();
  showToast("파일 저장은 완료되었습니다. 문서 분석은 서버에서 계속 진행됩니다.");
}

projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.querySelector("#projectNameInput").value.trim();
  const amount = document.querySelector("#projectAmountInput").value.trim();
  const scope = document.querySelector("#projectScopeInput").value.trim();
  if (!name) return;

  try {
    const { project } = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, amount, scope }),
    });
    state.projects = [project, ...state.projects];
    projectForm.reset();
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

runReview.addEventListener("click", async () => {
  const project = activeProject();
  if (!project) {
    showToast("먼저 프로젝트를 생성하거나 선택해 주세요.");
    setPage("projects");
    return;
  }

  if (hasProcessingExtracts()) {
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
        notes: "현재 업로드된 설계도서 목록과 문서 추출 결과를 기준으로 1차 설계관리 리스크 후보를 분류합니다.",
      }),
    });
    state.reviewItems = data.reviewItems || [];
    selectedRiskId = state.reviewItems[0]?.id || null;
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

navLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    setPage(link.dataset.pageLink);
  });
});

window.addEventListener("hashchange", () => {
  setPage(location.hash.replace("#", ""), false);
});

setPage(location.hash.replace("#", "") || "dashboard", false);
loadProjects().catch((error) => {
  showToast(error.message);
  renderAll();
});
