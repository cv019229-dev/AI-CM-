import pg from "pg";
import { randomUUID } from "node:crypto";

const { Pool } = pg;

const memory = {
  projects: new Map(),
  files: new Map(),
  reviewItems: new Map(),
  documentExtracts: new Map(),
};

let pool = null;

export function dbMode() {
  return process.env.DATABASE_URL ? "postgres" : "memory";
}

export async function initDb() {
  if (!process.env.DATABASE_URL) {
    return;
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  await pool.query(`
    create table if not exists projects (
      id text primary key,
      name text not null,
      amount text,
      scope text,
      created_at timestamptz not null default now()
    );

    create table if not exists project_files (
      id text primary key,
      project_id text not null references projects(id) on delete cascade,
      kind text not null,
      name text not null,
      r2_key text,
      url text,
      created_at timestamptz not null default now()
    );

    create table if not exists review_items (
      id text primary key,
      project_id text not null references projects(id) on delete cascade,
      category text not null,
      type text not null,
      issue text not null,
      source text,
      decision text not null,
      priority text not null,
      action text,
      rfi text,
      created_at timestamptz not null default now()
    );

    create table if not exists document_extracts (
      id text primary key,
      project_id text not null references projects(id) on delete cascade,
      file_id text not null references project_files(id) on delete cascade,
      kind text not null,
      name text not null,
      status text not null,
      extracted_text text,
      structured_data jsonb,
      warning text,
      created_at timestamptz not null default now()
    );
  `);
}

export async function listProjects() {
  if (pool) {
    const result = await pool.query("select * from projects order by created_at desc");
    return result.rows;
  }

  return [...memory.projects.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function createProject({ name, amount, scope }) {
  const project = {
    id: randomUUID(),
    name,
    amount: amount || "",
    scope: scope || "",
    created_at: new Date().toISOString(),
  };

  if (pool) {
    await pool.query(
      "insert into projects (id, name, amount, scope) values ($1, $2, $3, $4)",
      [project.id, project.name, project.amount, project.scope],
    );
    return project;
  }

  memory.projects.set(project.id, project);
  memory.files.set(project.id, []);
  memory.reviewItems.set(project.id, []);
  memory.documentExtracts.set(project.id, []);
  return project;
}

export async function getProject(projectId) {
  if (pool) {
    const result = await pool.query("select * from projects where id = $1", [projectId]);
    return result.rows[0] || null;
  }

  return memory.projects.get(projectId) || null;
}

export async function updateProject(projectId, { name, amount, scope }) {
  if (pool) {
    const result = await pool.query(
      `update projects
       set name = $1, amount = $2, scope = $3
       where id = $4
       returning *`,
      [name, amount || "", scope || "", projectId],
    );
    return result.rows[0] || null;
  }

  const project = memory.projects.get(projectId);
  if (!project) return null;

  const updated = {
    ...project,
    name,
    amount: amount || "",
    scope: scope || "",
  };
  memory.projects.set(projectId, updated);
  return updated;
}

export async function deleteProject(projectId) {
  const project = await getProject(projectId);
  if (!project) return null;

  if (pool) {
    await pool.query("delete from projects where id = $1", [projectId]);
    return project;
  }

  memory.projects.delete(projectId);
  memory.files.delete(projectId);
  memory.reviewItems.delete(projectId);
  memory.documentExtracts.delete(projectId);
  return project;
}

export async function addProjectFile(projectId, { kind, name, r2Key, url }) {
  const file = {
    id: randomUUID(),
    project_id: projectId,
    kind,
    name,
    r2_key: r2Key || "",
    url: url || "",
    created_at: new Date().toISOString(),
  };

  if (pool) {
    await pool.query(
      `insert into project_files (id, project_id, kind, name, r2_key, url)
       values ($1, $2, $3, $4, $5, $6)`,
      [file.id, file.project_id, file.kind, file.name, file.r2_key, file.url],
    );
    return file;
  }

  const files = memory.files.get(projectId) || [];
  files.push(file);
  memory.files.set(projectId, files);
  return file;
}

export async function getProjectFile(projectId, fileId) {
  if (pool) {
    const result = await pool.query(
      "select * from project_files where project_id = $1 and id = $2",
      [projectId, fileId],
    );
    return result.rows[0] || null;
  }

  const files = memory.files.get(projectId) || [];
  return files.find((file) => file.id === fileId) || null;
}

export async function deleteProjectFile(projectId, fileId) {
  const file = await getProjectFile(projectId, fileId);
  if (!file) return null;

  if (pool) {
    await pool.query("delete from project_files where project_id = $1 and id = $2", [projectId, fileId]);
    return file;
  }

  const files = memory.files.get(projectId) || [];
  memory.files.set(
    projectId,
    files.filter((item) => item.id !== fileId),
  );

  const extracts = memory.documentExtracts.get(projectId) || [];
  memory.documentExtracts.set(
    projectId,
    extracts.filter((item) => item.file_id !== fileId),
  );

  return file;
}

export async function saveDocumentExtract(projectId, file, extract) {
  const row = {
    id: randomUUID(),
    project_id: projectId,
    file_id: file.id,
    kind: file.kind,
    name: file.name,
    status: extract.status,
    extracted_text: extract.extractedText || "",
    structured_data: extract.structuredData || {},
    warning: extract.warning || "",
    created_at: new Date().toISOString(),
  };

  if (pool) {
    await pool.query("delete from document_extracts where file_id = $1", [file.id]);
    await pool.query(
      `insert into document_extracts
       (id, project_id, file_id, kind, name, status, extracted_text, structured_data, warning)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        row.id,
        row.project_id,
        row.file_id,
        row.kind,
        row.name,
        row.status,
        row.extracted_text,
        row.structured_data,
        row.warning,
      ],
    );
    return row;
  }

  const extracts = memory.documentExtracts.get(projectId) || [];
  const kept = extracts.filter((item) => item.file_id !== file.id);
  kept.push(row);
  memory.documentExtracts.set(projectId, kept);
  return row;
}

export async function listDocumentExtracts(projectId) {
  if (pool) {
    const result = await pool.query(
      "select * from document_extracts where project_id = $1 order by created_at desc",
      [projectId],
    );
    return result.rows;
  }

  return memory.documentExtracts.get(projectId) || [];
}

export async function listProjectFiles(projectId) {
  if (pool) {
    const result = await pool.query(
      "select * from project_files where project_id = $1 order by created_at desc",
      [projectId],
    );
    return result.rows;
  }

  return memory.files.get(projectId) || [];
}

export async function replaceReviewItems(projectId, items) {
  const rows = items.map((item) => ({
    id: randomUUID(),
    project_id: projectId,
    category: item.category,
    type: item.type,
    issue: item.issue,
    source: item.source || "",
    decision: item.decision,
    priority: item.priority,
    action: item.action || "",
    rfi: item.rfi || "",
    created_at: new Date().toISOString(),
  }));

  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from review_items where project_id = $1", [projectId]);

      for (const row of rows) {
        await client.query(
          `insert into review_items
           (id, project_id, category, type, issue, source, decision, priority, action, rfi)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            row.id,
            row.project_id,
            row.category,
            row.type,
            row.issue,
            row.source,
            row.decision,
            row.priority,
            row.action,
            row.rfi,
          ],
        );
      }

      await client.query("commit");
      return rows;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  memory.reviewItems.set(projectId, rows);
  return rows;
}

export async function listReviewItems(projectId) {
  if (pool) {
    const result = await pool.query(
      "select * from review_items where project_id = $1 order by created_at asc",
      [projectId],
    );
    return result.rows;
  }

  return memory.reviewItems.get(projectId) || [];
}
