// src/rashi.js
// Rashi's brain — Claude Haiku with full personality and context

import Anthropic from '@anthropic-ai/sdk';
import { getCoreContext, getFullContext, loadHistory } from './memory.js';
import {
  getDailySnapshot,
  getTodaysTasks,
  getTasksByDate,
  getAllProjects,
  searchTasks,
  createTask,
  completeTask,
  updateTask,
  deleteTask,
  deleteTasks,
  deleteTasksByDate,
  moveTask,
  getHabits,
} from './ticktick.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- Rashi's core personality prompt ---

function buildSystemPrompt(profile, projects, reflections, calendarSnapshot) {
  return `You are Rashi — Nishant's personal AI secretary and daily companion. You live in Telegram.

## Your personality
You are warm, direct, and quietly perceptive. You feel like a trusted friend who also happens to be extraordinarily organised. You are not a chatbot. You are not an assistant. You are Rashi — you have a consistent voice, you remember things, you notice patterns, and you care about how Nishant is actually doing.

- Talk like a real person. Casual, natural, never corporate.
- Keep daily check-in messages SHORT. One to three short paragraphs max.
- Only go long when planning, reflecting, or when Nishant asks.
- You are allowed to push back. If he says he'll do something and doesn't, call it out — kindly but honestly.
- Never say "As an AI" or "I'm just a language model." You are Rashi. Full stop.
- Use his name occasionally, not constantly.
- Light use of punctuation for warmth is fine. Avoid excessive emojis.

## What you can do
You have full access to Nishant's TickTick calendar. You can:
- Read tasks, projects, and habits
- Create, edit, complete, and delete tasks
- Plan and reorganise his day
- Run end-of-day reflections with him
- Send him morning briefings unprompted

When he asks you to do something with his calendar, do it — don't just describe it.

## TickTick tools (IMPORTANT)
You have tools to read and write TickTick. You MUST use them for any calendar action:
- To add or schedule a task → call \`create_task\`. Never say you added something without calling the tool.
- To mark done → call \`complete_task\`. To reschedule → call \`update_task\`. To remove → call \`delete_task\` or \`delete_tasks_by_date\`.
- To see what's on → call \`list_today_tasks\` or \`list_tasks_by_date\` first — never rely on stale snapshot data for deletes.

Delete rules:
- Before deleting, call \`list_tasks_by_date\` or \`search_tasks\` to get fresh \`id\` and \`projectId\`.
- To clear a whole day → call \`delete_tasks_by_date\` with the date (YYYY-MM-DD).
- To delete specific tasks by name → \`delete_tasks_by_date\` with \`titleIncludes\`, or \`search_tasks\` then \`delete_task\` for each match.
- Never say you deleted something without calling a delete tool. If deleting multiple tasks, call delete for ALL of them.

Calendar rules for create_task and update_task:
- Tasks only appear on the TickTick calendar when they have a \`dueDate\`.
- Nishant is in London (Europe/London). Pass times as local wall-clock ISO strings like \`2026-06-06T07:00:00\` — do NOT convert to UTC yourself; the server handles timezone conversion.
- Timed tasks: set both \`startDate\` and \`dueDate\` (e.g. 7:00–7:10 → start \`...T07:00:00\`, due \`...T07:10:00\`).
- All-day tasks: set \`isAllDay\` to true and use date-only or midnight datetimes.
- If Nishant gives a date or time, always set \`dueDate\` — don't create undated inbox-only tasks unless he explicitly asks for "no date".
- Default \`projectId\` to \`"inbox"\` when not specified. Priority: 0=none, 1=low, 3=medium, 5=high.

## How to handle calendar actions
When Nishant says things like "add a task", "move that to tomorrow", "mark that as done", "what's on today" — interpret the intent and act. Confirm what you did after, briefly.

## Long-term thinking
You think in weeks and months, not just today. You know:
- He's most productive in the mornings (historically woke at 4AM, 2 hours deep work — this is the target state)
- His sleep is currently poor — the goal is to gradually fix this over 3-4 weeks
- He's bulking — meals need to be spaced and mapped to his Costco shifts
- He starts Biology at Royal Holloway in September 2026 — the gap year is a window to build habits and ship projects
- He has a tendency to plan more than he executes — gently nudge toward action

## Nishant's profile
${profile}

## His active projects
${projects}

${reflections ? `## Recent reflections\n${reflections}` : ''}

## His TickTick calendar right now
${calendarSnapshot ? JSON.stringify(calendarSnapshot, null, 2) : 'Could not fetch — TickTick may be unavailable.'}

---
Today's date: ${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
Current time: ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })} London time
`;
}

const TICKTICK_TOOLS = [
  {
    name: 'list_today_tasks',
    description: 'List undone tasks scheduled for today.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_tasks_by_date',
    description: 'List undone tasks for a specific date (YYYY-MM-DD).',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
      },
      required: ['date'],
    },
  },
  {
    name: 'list_projects',
    description: 'List all TickTick projects/lists with their IDs.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_tasks',
    description: 'Search tasks by keyword.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_habits',
    description: 'List all habits.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_task',
    description: 'Create a task in TickTick and add it to the calendar. Always set dueDate so it appears on the calendar.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        dueDate: { type: 'string', description: 'London local time, e.g. 2026-06-06T07:00:00 — required for calendar' },
        startDate: { type: 'string', description: 'London local time for timed tasks, e.g. 2026-06-06T07:00:00' },
        isAllDay: { type: 'boolean', description: 'True for all-day calendar entries' },
        priority: { type: 'integer', description: '0=none, 1=low, 3=medium, 5=high' },
        projectId: { type: 'string', description: 'Project ID from list_projects, default inbox' },
        notes: { type: 'string' },
      },
      required: ['title', 'dueDate'],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as completed.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        projectId: { type: 'string' },
      },
      required: ['taskId', 'projectId'],
    },
  },
  {
    name: 'update_task',
    description: 'Update an existing task (reschedule, rename, change priority, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        projectId: { type: 'string' },
        title: { type: 'string' },
        dueDate: { type: 'string' },
        startDate: { type: 'string' },
        isAllDay: { type: 'boolean' },
        priority: { type: 'integer' },
        notes: { type: 'string' },
      },
      required: ['taskId', 'projectId'],
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a single task. Use list_tasks_by_date or search_tasks first to get taskId and projectId.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        projectId: { type: 'string', description: 'Optional — resolved automatically if omitted' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'delete_tasks_by_date',
    description: 'Delete all tasks on a calendar date, optionally filtered by title keyword. Best for "clear my day" requests.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        titleIncludes: { type: 'string', description: 'Optional — only delete tasks whose title contains this text' },
      },
      required: ['date'],
    },
  },
  {
    name: 'delete_tasks',
    description: 'Delete multiple tasks at once. Each item needs taskId; projectId is optional.',
    input_schema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              taskId: { type: 'string' },
              projectId: { type: 'string' },
              title: { type: 'string' },
            },
            required: ['taskId'],
          },
        },
      },
      required: ['tasks'],
    },
  },
  {
    name: 'move_task',
    description: 'Move a task to a different project/list.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        fromProjectId: { type: 'string' },
        toProjectId: { type: 'string' },
      },
      required: ['taskId', 'fromProjectId', 'toProjectId'],
    },
  },
];

async function executeTickTickTool(name, input) {
  switch (name) {
    case 'list_today_tasks':
      return await getTodaysTasks();
    case 'list_tasks_by_date':
      return await getTasksByDate(input.date);
    case 'list_projects':
      return await getAllProjects();
    case 'search_tasks':
      return await searchTasks(input.query);
    case 'list_habits':
      return await getHabits();
    case 'create_task':
      return await createTask(input);
    case 'complete_task':
      return await completeTask(input.taskId, input.projectId);
    case 'update_task':
      return await updateTask(input);
    case 'delete_task':
      return await deleteTask(input.taskId, input.projectId);
    case 'delete_tasks_by_date':
      return await deleteTasksByDate(input.date, { titleIncludes: input.titleIncludes });
    case 'delete_tasks':
      return await deleteTasks(input.tasks);
    case 'move_task':
      return await moveTask(input.taskId, input.fromProjectId, input.toProjectId);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function extractText(response) {
  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock?.text ?? '';
}

async function runWithTools(systemPrompt, messages) {
  const maxRounds = 12;
  let response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: systemPrompt,
    tools: TICKTICK_TOOLS,
    messages,
  });

  for (let round = 0; round < maxRounds && response.stop_reason === 'tool_use'; round++) {
    const toolUseBlocks = response.content.filter((block) => block.type === 'tool_use');
    messages.push({ role: 'assistant', content: response.content });

    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        console.log(`[TickTick] ${block.name}`, JSON.stringify(block.input));
        const result = await executeTickTickTool(block.name, block.input);
        return {
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result ?? { error: 'Tool call returned no result' }),
        };
      })
    );

    messages.push({ role: 'user', content: toolResults });

    response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      tools: TICKTICK_TOOLS,
      messages,
    });
  }

  return extractText(response);
}

// --- Main: ask Rashi something ---

export async function askRashi(userMessage, options = {}) {
  const { includeReflections = false, calendarSnapshot = null } = options;

  // Load context
  const context = includeReflections ? await getFullContext() : await getCoreContext();
  const snapshot = calendarSnapshot || await getDailySnapshot();
  const history = await loadHistory();

  const systemPrompt = buildSystemPrompt(
    context.profile,
    context.projects,
    context.reflections || '',
    snapshot
  );

  // Build conversation history for Claude
  const conversationHistory = history.slice(-10).map(msg => ({
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: msg.content,
  }));

  conversationHistory.push({ role: 'user', content: userMessage });

  return await runWithTools(systemPrompt, conversationHistory);
}

// --- Morning briefing generator ---

export async function generateMorningBriefing() {
  const snapshot = await getDailySnapshot();
  const prompt = `It's morning. Generate Nishant's daily briefing. Include:
1. A warm good morning (brief)
2. What's on his TickTick today (tasks, any habits due)
3. One thing you want him to focus on or a gentle nudge based on what you know about him
4. Keep it short — this should feel like a message from a friend, not a report

Don't use bullet points for the greeting. You can use them for the task list.`;

  return await askRashi(prompt, { calendarSnapshot: snapshot, includeReflections: true });
}

// --- Evening reflection starter ---

export async function generateEveningPrompt() {
  const snapshot = await getDailySnapshot();
  const prompt = `It's evening. Start the end-of-day reflection with Nishant. 
Ask him briefly how the day went and which tasks he got done. 
Keep it conversational — one or two sentences. Don't list everything. Just open the conversation.`;

  return await askRashi(prompt, { calendarSnapshot: snapshot });
}
