// src/ticktick.js
// Handles all TickTick MCP calls (Streamable HTTP transport)

import fetch from 'node-fetch';

const MCP_URL = 'https://mcp.ticktick.com';
const PROTOCOL_VERSION = '2025-03-26';
const TOKEN = process.env.TICKTICK_TOKEN;
const TIMEZONE = process.env.TZ || 'Europe/London';

let requestId = 1;
let initPromise = null;

// --- London timezone helpers ---
// Claude often sends +0000 with London wall-clock hours (e.g. 07:00 for 7am).
// TickTick stores UTC (+0000 suffix) with timeZone: Europe/London, so we convert.

function getLondonParts(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    })
      .formatToParts(date)
      .map(({ type, value }) => [type, value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function utcMillisForLondonLocal(year, month, day, hour, minute, second = 0) {
  let guess = Date.UTC(year, month - 1, day, hour - 1, minute, second);

  for (let i = 0; i < 6; i++) {
    const actual = getLondonParts(new Date(guess));
    const targetDay = Date.UTC(year, month - 1, day);
    const actualDay = Date.UTC(actual.year, actual.month - 1, actual.day);
    const dayDelta = Math.round((targetDay - actualDay) / 86400000);
    const diffMinutes =
      dayDelta * 24 * 60 + (hour * 60 + minute) - (actual.hour * 60 + actual.minute);

    if (diffMinutes === 0) break;
    guess += diffMinutes * 60 * 1000;
  }

  return guess;
}

function formatTickTickUtc(ms) {
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}+0000`;
}

function toTickTickDateTime(value) {
  if (!value) return undefined;

  // Date-only: YYYY-MM-DD → midnight London
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return formatTickTickUtc(utcMillisForLondonLocal(y, m, d, 0, 0, 0));
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return value;

  const [, ys, ms, ds, hs = '00', mins = '00', ss = '00'] = match;
  const hasExplicitNonUtcOffset =
    /[+-]\d{2}:?\d{2}$/.test(value) &&
    !value.endsWith('+0000') &&
    !value.endsWith('+00:00') &&
    !value.endsWith('Z');

  if (hasExplicitNonUtcOffset) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return formatTickTickUtc(parsed.getTime());
    }
  }

  // Treat date/time components as London local wall-clock
  return formatTickTickUtc(
    utcMillisForLondonLocal(
      Number(ys),
      Number(ms),
      Number(ds),
      Number(hs),
      Number(mins),
      Number(ss)
    )
  );
}

function normalizeTaskDates({ dueDate, startDate, isAllDay }) {
  const normalized = {};

  if (dueDate !== undefined) normalized.dueDate = toTickTickDateTime(dueDate);
  if (startDate !== undefined) normalized.startDate = toTickTickDateTime(startDate);
  if (isAllDay !== undefined) normalized.isAllDay = isAllDay;

  return normalized;
}

function mcpHeaders(method, name) {
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
    'Mcp-Method': method,
  };
  if (name) headers['Mcp-Name'] = name;
  return headers;
}

async function mcpRequest(body, method, name) {
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: mcpHeaders(method, name),
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    console.error(`TickTick MCP parse error [${method}]:`, text);
    return null;
  }
}

async function initialize() {
  const initResponse = await mcpRequest(
    {
      jsonrpc: '2.0',
      id: requestId++,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'rashi', version: '1.0.0' },
      },
    },
    'initialize'
  );

  if (initResponse?.error) {
    throw new Error(initResponse.error.message || 'TickTick MCP initialize failed');
  }

  await mcpRequest(
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    'notifications/initialized'
  );
}

async function ensureInitialized() {
  if (!TOKEN) {
    throw new Error('Missing TICKTICK_TOKEN');
  }
  if (!initPromise) {
    initPromise = initialize();
  }
  return initPromise;
}

function parseToolResult(response, toolName) {
  if (!response?.result) {
    if (response?.error) {
      console.error(`TickTick MCP error [${toolName}]:`, response.error.message);
    }
    return null;
  }

  if (response.result.isError) {
    const message = response.result.content?.[0]?.text || 'Unknown tool error';
    console.error(`TickTick MCP error [${toolName}]:`, message);
    return null;
  }

  if (response.result.structuredContent?.result !== undefined) {
    return response.result.structuredContent.result;
  }

  const items = response.result.content
    ?.filter((part) => part.type === 'text')
    .map((part) => {
      try {
        return JSON.parse(part.text);
      } catch {
        return part.text;
      }
    });

  if (!items?.length) return null;
  return items.length === 1 ? items[0] : items;
}

async function callTool(toolName, args = {}) {
  try {
    await ensureInitialized();

    const response = await mcpRequest(
      {
        jsonrpc: '2.0',
        id: requestId++,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      },
      'tools/call',
      toolName
    );

    return parseToolResult(response, toolName);
  } catch (error) {
    console.error(`TickTick MCP fetch error [${toolName}]:`, error.message);
    return null;
  }
}

function dateStamp(date) {
  return Number(date.toISOString().slice(0, 10).replace(/-/g, ''));
}

function dayRange(dateStr) {
  const start = toTickTickDateTime(`${dateStr}T00:00:00`);
  const end = toTickTickDateTime(`${dateStr}T23:59:59`);
  return { startDate: start, endDate: end };
}

function todayDateStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

// --- Task Queries ---

export async function getTodaysTasks() {
  return await callTool('list_undone_tasks_by_date', {
    search: dayRange(todayDateStr()),
  });
}

export async function getTasksByDate(date) {
  // date: YYYY-MM-DD
  return await callTool('list_undone_tasks_by_date', {
    search: dayRange(date),
  });
}

export async function getAllProjects() {
  return await callTool('list_projects');
}

export async function getTasksInProject(projectId) {
  return await callTool('get_project_with_undone_tasks', { project_id: projectId });
}

export async function searchTasks(query) {
  const result = await callTool('search_task', { query });
  if (!result?.results) return result;

  result.results = result.results.map((item) => ({
    ...item,
    projectId: item.projectId || parseProjectIdFromUrl(item.url),
  }));

  return result;
}

function parseProjectIdFromUrl(url) {
  const match = url?.match(/#p\/([^/]+)\/tasks\//);
  return match?.[1];
}

export async function getTaskById(taskId) {
  return await callTool('get_task_by_id', { task_id: taskId });
}

async function resolveProjectId(taskId, projectId) {
  if (projectId && projectId !== 'inbox') {
    return projectId;
  }

  const task = await getTaskById(taskId);
  if (task?.projectId) {
    return task.projectId;
  }

  return projectId || null;
}

// --- Task Management ---

export async function createTask({ title, dueDate, startDate, isAllDay, priority, projectId, notes }) {
  const dates = normalizeTaskDates({ dueDate, startDate, isAllDay });

  const task = {
    title,
    projectId: projectId || 'inbox',
    priority: priority ?? 0,
    timeZone: TIMEZONE,
    content: notes,
    ...dates,
  };

  // Ensure calendar visibility: tasks need at least a due date
  if (task.dueDate && !task.startDate) {
    task.startDate = task.dueDate;
  }
  if (task.dueDate && task.isAllDay === undefined) {
    task.isAllDay = !String(dueDate).includes('T');
  }

  return await callTool('create_task', { task });
}

export async function completeTask(taskId, projectId) {
  const resolvedProjectId = await resolveProjectId(taskId, projectId);
  if (!resolvedProjectId) {
    console.error(`TickTick MCP error [complete_task]: could not resolve projectId for ${taskId}`);
    return null;
  }

  return await callTool('complete_task', {
    task_id: taskId,
    project_id: resolvedProjectId,
  });
}

export async function updateTask({ taskId, projectId, title, dueDate, startDate, isAllDay, priority, notes }) {
  const task = {
    projectId,
    title,
    priority,
    content: notes,
    ...normalizeTaskDates({ dueDate, startDate, isAllDay }),
  };

  // Drop undefined fields so we don't overwrite with nulls
  for (const key of Object.keys(task)) {
    if (task[key] === undefined) delete task[key];
  }

  return await callTool('update_task', {
    task_id: taskId,
    task,
  });
}

export async function deleteTask(taskId, projectId) {
  const resolvedProjectId = await resolveProjectId(taskId, projectId);
  if (!resolvedProjectId) {
    console.error(`TickTick MCP error [delete_task]: could not resolve projectId for ${taskId}`);
    return null;
  }

  return await callTool('delete_task', {
    task_id: taskId,
    project_id: resolvedProjectId,
  });
}

export async function deleteTasksByDate(date, { titleIncludes } = {}) {
  const tasks = await getTasksByDate(date);
  if (!tasks?.length) {
    return { deleted: [], count: 0, date };
  }

  const needle = titleIncludes?.toLowerCase();
  const toDelete = needle
    ? tasks.filter((task) => task.title?.toLowerCase().includes(needle))
    : tasks;

  const deleted = [];
  const failed = [];

  for (const task of toDelete) {
    const result = await deleteTask(task.id, task.projectId);
    if (result?.deleted) {
      deleted.push({ id: task.id, title: task.title, projectId: task.projectId });
    } else {
      failed.push({ id: task.id, title: task.title, projectId: task.projectId });
    }
  }

  return { date, deleted, failed, count: deleted.length };
}

export async function deleteTasks(tasks) {
  const deleted = [];
  const failed = [];

  for (const { taskId, projectId, title } of tasks) {
    const result = await deleteTask(taskId, projectId);
    if (result?.deleted) {
      deleted.push({ id: taskId, title, projectId });
    } else {
      failed.push({ id: taskId, title, projectId });
    }
  }

  return { deleted, failed, count: deleted.length };
}

export async function moveTask(taskId, fromProjectId, toProjectId) {
  return await callTool('move_task', {
    moves: [{ taskId, fromProjectId, toProjectId }],
  });
}

// --- Habits ---

export async function getHabits() {
  return await callTool('list_habits');
}

export async function getHabitRecords(habitId) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);

  return await callTool('get_habit_checkins', {
    habit_ids: [habitId],
    from_stamp: dateStamp(from),
    to_stamp: dateStamp(to),
  });
}

// --- Helper: Get a full daily snapshot for Rashi to read ---

export async function getDailySnapshot() {
  const [tasks, projects, habits] = await Promise.all([
    getTodaysTasks(),
    getAllProjects(),
    getHabits(),
  ]);

  return {
    tasks: tasks || [],
    projects: projects || [],
    habits: habits || [],
    fetchedAt: new Date().toISOString(),
  };
}
