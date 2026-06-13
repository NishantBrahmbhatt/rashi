// Debug script — see exactly what TickTick MCP returns.
// Run: node test-ticktick.js

import 'dotenv/config';
import { getAllProjects, getHabits, getTodaysTasks } from './src/ticktick.js';

console.log('Testing TickTick MCP (Streamable HTTP)...\n');

const [projects, habits, tasks] = await Promise.all([
  getAllProjects(),
  getHabits(),
  getTodaysTasks(),
]);

console.log('list_projects:', JSON.stringify(projects, null, 2));
console.log('\nlist_habits:', JSON.stringify(habits, null, 2));
console.log('\nlist_undone_tasks_by_date (today):', JSON.stringify(tasks, null, 2));
