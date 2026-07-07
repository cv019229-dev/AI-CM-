const STORAGE_KEY = "ai-cm-projects-v2";

const sampleRisks = [
  {
    category: "불일치·누락",
    type: "불일치",
    issue: "도면에는 방수층 2회 시공, 내역서는 1회로 반영",
    source: "도면 A-301 / 내역서 B-04",
    decision: "설계변경 검토",
    priority: "높음",
    action: "설계자 확인 후 필요 시 설계변경 검토 항목으로 관리합니다.",
    rfi: "도면 A-301의 방수층 2회 시공 표기와 내역서 B-04의 1회 반영 내용이 달라, 적용 기준과 계약 내역 반영 여부 확인을 요청드립니다.",
  },
  {
    category: "불일치·누락",
    type: "누락",
    issue: "시방서에 품질시험 기준이 있으나 내역서 시험비 항목 없음",
    source: "특기시방서 01450 / 내역서 공통가설",
    decision: "공사비 영향",
    priority: "중간",
    action: "시험 대상과 횟수를 확인하고 별도 비용 반영 여부를 검토합니다.",
    rfi: "특기시방서 01450에 품질시험 기준이 명시되어 있으나 내역서에 시험비 항목이 확인되지 않습니다. 시험 범위와 비용 반영 기준 확인을 요청드립니다.",
  },
  {
    category: "RFI 후보",
    type: "불일치",
    issue: "마감표는 포세린타일, 내역서는 자기질타일로 표기",
    source: "마감표 A-102 / 내역서 마감공사",
    decision: "RFI 후보",
    priority: "높음",
    action: "적용 자재 등급을 공식 질의로 확인합니다.",
    rfi: "마감표 A-102에는 포세린타일, 내역서 마감공사에는 자기질타일로 표기되어 있습니다. 최종 적용 자재와 내역 기준 확인을 요청드립니다.",
  },
  {
    category: "설계변경 검토",
    type: "누락",
    issue: "상세도에 금속 보강철물 표기가 있으나 내역 항목 없음",
    source: "상세도 S-211 / 내역서 금속공사",
    decision: "설계변경 검토",
    priority: "높음",
    action: "시공 필요 여부와 물량 산출 근거를 확인합니다.",
    rfi: "상세도 S-211에 금속 보강철물이 표기되어 있으나 내역서 금속공사 항목에서 확인되지 않습니다. 시공 필요 여부와 내역 반영 기준 확인을 요청드립니다.",
  },
  {
    category: "공사비 영향",
    type: "수량 차이",
    issue: "창호 일람표 수량과 내역서 창호 수량이 다름",
    source: "창호도 A-501 / 내역서 창호공사",
    decision: "공사비 영향",
    priority: "중간",
    action: "실제 설치 위치별 수량을 다시 대조합니다.",
    rfi: "창호도 A-501의 창호 일람표 수량과 내역서 창호공사 수량이 일치하지 않습니다. 계약 수량 기준 확인을 요청드립니다.",
  },
  {
    category: "RFI 후보",
    type: "확인",
    issue: "시방서에는 친환경 인증 자재 사용 조건이 있으나 제품 기준 불명확",
    source: "특기시방서 09600",
    decision: "RFI 후보",
    priority: "낮음",
    action: "인증 범위와 제출 서류를 확인합니다.",
    rfi: "특기시방서 09600의 친환경 인증 자재 사용 조건에 대해 적용 범위와 제출 서류 기준 확인을 요청드립니다.",
  },
];

const categories = ["불일치·누락", "RFI 후보", "설계변경 검토", "공사비 영향"];

const projectList = document.querySelector("#projectList");
const projectForm = document.querySelector("#projectForm");
const currentProjectName = document.querySelector("#currentProjectName");
const currentProjectMeta = document.querySelector("#currentProjectMeta");
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
const fileNameFields = {
  drawing: document.querySelector("#drawingFileName"),
  spec: document.querySelector("#specFileName"),
  cost: document.querySelector("#costFileName"),
};

let state = loadState();
let selectedRiskId = null;

function createId() {
  return `project-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createRiskId(index) {
  return `risk-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`;
}

function createProject(name, amount, scope, risks = []) {
  return {
    id: createId(),
    name,
    amount: amount || "금액 미입력",
    scope: scope || "범위 미입력",
    files: {
      drawing: "",
      spec: "",
      cost: "",
    },
    risks,
  };
}

function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    return JSON.parse(stored);
  }

  const demoProject = createProject("가상 예시 프로젝트", "24.8억", "건축 마감 중심", withRiskIds(sampleRisks));
  return {
    activeProjectId: demoProject.id,
    projects: [demoProject],
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function withRiskIds(items) {
  return items.map((item, index) => ({
    ...item,
    id: createRiskId(index),
  }));
}

function activeProject() {
  return state.projects.find((project) => project.id === state.activeProjectId) || null;
}

function currentRisks() {
  return activeProject()?.risks || [];
}

function colorForDecision(value) {
  if (value.includes("설계변경")) return "amber";
  if (value.includes("RFI")) return "blue";
  if (value.includes("공사비")) return "green";
  return "red";
}

function colorForPriority(value) {
  if (value === "높음") return "high";
  if (value === "중간") return "medium";
  return "low";
}

function countByCategory(category) {
  return currentRisks().filter((item) => item.category === category || item.decision === category).length;
}

function renderProjectList() {
  projectList.innerHTML = "";

  state.projects.forEach((project) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `project-chip ${project.id === state.activeProjectId ? "active" : ""}`;
    button.innerHTML = `
      <strong>${project.name}</strong>
      <span>${project.amount} · ${project.scope}</span>
    `;
    button.addEventListener("click", () => {
      state.activeProjectId = project.id;
      selectedRiskId = null;
      saveState();
      renderAll();
    });
    projectList.appendChild(button);
  });
}

function renderProjectHeader() {
  const project = activeProject();
  if (!project) {
    currentProjectName.textContent = "프로젝트 없음";
    currentProjectMeta.textContent = "새 프로젝트를 생성해 주세요.";
    return;
  }

  currentProjectName.textContent = project.name;
  currentProjectMeta.textContent = `${project.amount} · ${project.scope}`;
  fileNameFields.drawing.textContent = project.files.drawing || "선택된 파일 없음";
  fileNameFields.spec.textContent = project.files.spec || "선택된 파일 없음";
  fileNameFields.cost.textContent = project.files.cost || "선택된 파일 없음";
}

function renderCounts() {
  document.querySelector("#countMismatch").textContent = countByCategory("불일치·누락");
  document.querySelector("#countRfi").textContent = countByCategory("RFI 후보");
  document.querySelector("#countChange").textContent = countByCategory("설계변경 검토");
  document.querySelector("#countCost").textContent = countByCategory("공사비 영향");
}

function renderCategoryOutput() {
  categoryGrid.innerHTML = "";

  categories.forEach((category) => {
    const items = currentRisks().filter((item) => item.category === category || item.decision === category);
    const panel = document.createElement("article");
    panel.className = "category-panel";
    panel.innerHTML = `
      <div class="category-head">
        <h3>${category}</h3>
        <span>${items.length}건</span>
      </div>
      <div class="category-items"></div>
    `;

    const list = panel.querySelector(".category-items");
    if (items.length === 0) {
      list.innerHTML = '<p class="empty-text">아직 출력된 항목이 없습니다.</p>';
    } else {
      items.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-item";
        button.innerHTML = `
          <strong>${item.issue}</strong>
          <span>${item.source}</span>
          <em>${item.priority}</em>
        `;
        button.addEventListener("click", () => selectRisk(item.id));
        list.appendChild(button);
      });
    }

    categoryGrid.appendChild(panel);
  });
}

function renderRows(filter = document.querySelector(".tab.active")?.dataset.filter || "all") {
  tableBody.innerHTML = "";
  const rows = currentRisks().filter((item) => {
    if (filter === "all") return true;
    if (filter === "높음") return item.priority === "높음";
    return item.decision === filter || item.category === filter;
  });

  if (rows.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-cell">이 프로젝트에는 아직 검토 결과가 없습니다.</td>
      </tr>
    `;
    return;
  }

  rows.forEach((item) => {
    const row = document.createElement("tr");
    row.tabIndex = 0;
    row.className = item.id === selectedRiskId ? "selected" : "";
    row.innerHTML = `
      <td><span class="pill red">${item.type}</span></td>
      <td>${item.issue}</td>
      <td>${item.source}</td>
      <td><span class="pill ${colorForDecision(item.decision)}">${item.decision}</span></td>
      <td>${item.priority}</td>
    `;
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

  detailTitle.textContent = item.issue;
  detailPriority.textContent = item.priority;
  detailPriority.className = `priority-badge ${colorForPriority(item.priority)}`;
  detailIssue.textContent = item.issue;
  detailSource.textContent = item.source;
  detailAction.textContent = item.action;
  rfiText.textContent = item.rfi;
  renderRows();
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 1800);
}

function renderAll() {
  renderProjectList();
  renderProjectHeader();
  renderCounts();
  renderCategoryOutput();
  renderRows();

  if (selectedRiskId) {
    selectRisk(selectedRiskId);
  } else {
    clearDetail();
  }
}

projectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = document.querySelector("#projectNameInput").value.trim();
  const amount = document.querySelector("#projectAmountInput").value.trim();
  const scope = document.querySelector("#projectScopeInput").value.trim();
  if (!name) return;

  const project = createProject(name, amount, scope);
  state.projects.push(project);
  state.activeProjectId = project.id;
  selectedRiskId = null;
  saveState();
  projectForm.reset();
  renderAll();
  showToast("새 프로젝트를 생성했습니다.");
});

document.querySelectorAll("[data-file-kind]").forEach((input) => {
  input.addEventListener("change", () => {
    const project = activeProject();
    if (!project) return;
    project.files[input.dataset.fileKind] = input.files[0]?.name || "";
    saveState();
    renderProjectHeader();
  });
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    renderRows(tab.dataset.filter);
  });
});

runReview.addEventListener("click", () => {
  const project = activeProject();
  if (!project) {
    showToast("먼저 프로젝트를 생성해 주세요.");
    return;
  }

  document.body.classList.add("is-running");
  runReview.disabled = true;
  runReview.textContent = "검토 중";

  window.setTimeout(() => {
    project.risks = withRiskIds(sampleRisks);
    selectedRiskId = project.risks[0]?.id || null;
    saveState();
    document.body.classList.remove("is-running");
    runReview.disabled = false;
    runReview.innerHTML = '<span aria-hidden="true">↻</span> 샘플 검토 실행';
    renderAll();
    showToast("선택 프로젝트에 가상 검토 결과를 넣었습니다.");
  }, 800);
});

copyRfi.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(rfiText.textContent.trim());
    showToast("RFI 문안을 복사했습니다.");
  } catch {
    showToast("브라우저에서 복사를 허용하지 않았습니다.");
  }
});

renderAll();
