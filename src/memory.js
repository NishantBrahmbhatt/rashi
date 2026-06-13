// src/memory.js
// Reads and writes Rashi's context files (profile.md, projects.md, reflections.md)

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTEXT_DIR = path.join(__dirname, '..', 'context');

const FILES = {
  profile: path.join(CONTEXT_DIR, 'profile.md'),
  projects: path.join(CONTEXT_DIR, 'projects.md'),
  reflections: path.join(CONTEXT_DIR, 'reflections.md'),
  conversation: path.join(CONTEXT_DIR, 'conversation.json'),
};

// --- Read context files ---

export async function readFile(name) {
  try {
    return await fs.readFile(FILES[name], 'utf-8');
  } catch {
    return '';
  }
}

export async function getCoreContext() {
  const [profile, projects] = await Promise.all([
    readFile('profile'),
    readFile('projects'),
  ]);
  return { profile, projects };
}

export async function getFullContext() {
  const [profile, projects, reflections] = await Promise.all([
    readFile('profile'),
    readFile('projects'),
    readFile('reflections'),
  ]);
  return { profile, projects, reflections };
}

// --- Write/update context files ---

export async function writeFile(name, content) {
  await fs.mkdir(CONTEXT_DIR, { recursive: true });
  await fs.writeFile(FILES[name], content, 'utf-8');
}

export async function appendReflection(entry) {
  const date = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const line = `\n## ${date}\n${entry}\n`;

  try {
    await fs.appendFile(FILES.reflections, line, 'utf-8');
  } catch {
    await writeFile('reflections', `# Daily Reflections\n${line}`);
  }
}

// --- Conversation history (last N messages for context) ---

const MAX_HISTORY = 20;

export async function loadHistory() {
  try {
    const raw = await fs.readFile(FILES.conversation, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveHistory(history) {
  const trimmed = history.slice(-MAX_HISTORY);
  await fs.mkdir(CONTEXT_DIR, { recursive: true });
  await fs.writeFile(FILES.conversation, JSON.stringify(trimmed, null, 2), 'utf-8');
}

export async function addToHistory(role, content) {
  const history = await loadHistory();
  history.push({ role, content, timestamp: new Date().toISOString() });
  await saveHistory(history);
  return history;
}
