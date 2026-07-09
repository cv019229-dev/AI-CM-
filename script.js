const API_BASE_URL = "https://ai-cm-production.up.railway.app";

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
const sampleBadge = document.querySelector("#sampleBadge");
const fileNameFields = {
  drawing: document.querySelector("#drawingFileName"),
  spec: document.querySelector("#specFileName"),
  cost: document.querySelector("#costFileName"),
};

let state = {
  activeProjectId: "",
  projects: [],
  files: [],
  documentExtracts: [],
  reviewItems: [],
};
let selectedRiskId = null;

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

function activeProject() {
  return state.projects.find((project) => project.id === state.activeProjectId) || null;
}

function currentRisks() {
  return state.reviewItems || [];
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

  if (state.projects.length === 0) {
    projectList.innerHTML = '<p class="sidebar-empty">생성된 프로젝트가 없습니다.</p>';
    return;
  }

  state.projects.forEach((project) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `project-chip ${project.id === state.activeProjectId ? "active" : ""}`;
    button.innerHTML = `
      <strong>${project.name}</strong>
      <span>${project.amount} · ${project.scope}</span>
    `;
    button.addEventListener("click", () => loadProject(project.id));
    projectList.appendChild(button);
  });
}

function renderProjectHeader() {
  const project = activeProject();
  if (!project) {
    currentProjectName.textContent = "프로젝트 없음";
    currentProjectMeta.textContent = "새 프로젝트를 생성해 주세요.";
    fileNameFields.drawing.textContent = "선택된 파일 없음";
    fileNameFields.spec.textContent = "선택된 파일 없음";
    fileNameFields.cost.textContent = "선택된 파일 없음";
    return;
  }

  currentProjectName.textContent = project.name;
  currentProjectMeta.textContent = `${project.amount} · ${project.scope}`;

  const latestFileByKind = Object.fromEntries(
    ["drawing", "spec", "cost"].map((kind) => [
      kind,
      state.files.find((file) => file.kind === kind)?.name || "선택된 파일 없음",
    ]),
  );

  fileNameFields.drawing.textContent = latestFileByKind.drawing;
  fileNameFields.spec.textContent = latestFileByKind.spec;
  fileNameFields.cost.textContent = latestFileByKind.cost;
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
  window.setTimeout(() => toast.remove(), 2200);
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

async function loadProject(projectId) {
  const data = await api(`/api/projects/${projectId}`);
  state.activeProjectId = projectId;
  state.files = data.files || [];
  state.documentExtracts = data.documentExtracts || [];
  state.reviewItems = data.reviewItems || [];

  const exists = state.projects.some((project) => project.id === data.project.id);
  if (!exists) {
    state.projects = [data.project, ...state.projects];
  }

  selectedRiskId = null;
  sampleBadge.textContent =
    state.documentExtracts.length > 0 ? `문서 추출 ${state.documentExtracts.length}건` : "서버 저장";
  renderAll();
}

async function uploadFile(projectId, input) {
  const file = input.files[0];
  if (!file) return;

  const kind = input.dataset.fileKind;
  fileNameFields[kind].textContent = "업로드 준비 중";

  const { upload } = await api(`/api/projects/${projectId}/files/presign`, {
    method: "POST",
    body: JSON.stringify({
      kind,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
    }),
  });

  const uploadResponse = await fetch(upload.uploadUrl, {
    method: upload.method,
    headers: upload.headers,
    body: file,
  });

  if (!uploadResponse.ok) {
    throw new Error("R2 파일 업로드에 실패했습니다.");
  }

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
  showToast("파일을 서버에 저장했습니다.");
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
    showToast("새 프로젝트를 서버에 생성했습니다.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelectorAll("[data-file-kind]").forEach((input) => {
  input.addEventListener("change", async () => {
    const project = activeProject();
    if (!project) {
      showToast("먼저 프로젝트를 생성해 주세요.");
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
    showToast("먼저 프로젝트를 생성해 주세요.");
    return;
  }

  document.body.classList.add("is-running");
  runReview.disabled = true;
  runReview.textContent = "검토 중";

  try {
    const data = await api(`/api/projects/${project.id}/reviews/run`, {
      method: "POST",
      body: JSON.stringify({
        notes: "현재 업로드된 설계도서 목록을 기준으로 1차 설계관리 위험 후보를 분류합니다.",
      }),
    });
    state.reviewItems = data.reviewItems || [];
    selectedRiskId = state.reviewItems[0]?.id || null;
    sampleBadge.textContent = data.source === "openai" ? "AI 검토" : "샘플 결과";
    renderAll();
    showToast(data.warning || "AI 검토 결과를 서버에 저장했습니다.");
  } catch (error) {
    showToast(error.message);
  } finally {
    document.body.classList.remove("is-running");
    runReview.disabled = false;
    runReview.innerHTML = '<span aria-hidden="true">↻</span> AI 검토 실행';
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

loadProjects().catch((error) => {
  showToast(error.message);
  renderAll();
});
