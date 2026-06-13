// src/index.js
// Rashi — main entry point. Telegram bot + scheduled messages.

import 'dotenv/config';
import { Telegraf } from 'telegraf';
import cron from 'node-cron';
import { askRashi, generateMorningBriefing, generateEveningPrompt } from './rashi.js';
import { addToHistory } from './memory.js';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const AUTHORISED_ID = parseInt(process.env.TELEGRAM_CHAT_ID);

// --- Security: only respond to Nishant ---

function isAuthorised(ctx) {
  return ctx.from?.id === AUTHORISED_ID;
}

// --- Handle incoming messages ---

bot.on('text', async (ctx) => {
  if (!isAuthorised(ctx)) {
    console.log(`Unauthorised access attempt from: ${ctx.from?.id}`);
    return;
  }

  const userMessage = ctx.message.text;
  console.log(`[${new Date().toLocaleTimeString('en-GB')}] Nishant: ${userMessage}`);

  // Show typing indicator
  await ctx.sendChatAction('typing');

  try {
    // Save user message to history
    await addToHistory('user', userMessage);

    // Get Rashi's response
    const response = await askRashi(userMessage);

    // Save Rashi's response to history
    await addToHistory('assistant', response);

    // Send reply
    await ctx.reply(response, { parse_mode: 'Markdown' });

    console.log(`[${new Date().toLocaleTimeString('en-GB')}] Rashi: ${response.slice(0, 80)}...`);
  } catch (error) {
    console.error('Error generating response:', error);
    await ctx.reply("Sorry, something went wrong on my end. Give me a sec and try again.");
  }
});

// --- Send a proactive message to Nishant ---

async function sendToNishant(message) {
  try {
    await bot.telegram.sendMessage(AUTHORISED_ID, message, { parse_mode: 'Markdown' });
    await addToHistory('assistant', message);
    console.log(`[PROACTIVE] Sent message to Nishant`);
  } catch (error) {
    console.error('Failed to send proactive message:', error);
  }
}

// --- Scheduled messages ---

// Morning briefing — 7:30 AM every day
cron.schedule('30 7 * * *', async () => {
  console.log('[CRON] Generating morning briefing...');
  const briefing = await generateMorningBriefing();
  await sendToNishant(briefing);
}, { timezone: 'Europe/London' });

// Evening reflection — 9:00 PM every day
cron.schedule('0 21 * * *', async () => {
  console.log('[CRON] Generating evening prompt...');
  const prompt = await generateEveningPrompt();
  await sendToNishant(prompt);
}, { timezone: 'Europe/London' });

// --- Start bot ---

bot.launch({
  allowedUpdates: ['message'],
});

console.log('✅ Rashi is online.');
console.log(`📅 Morning briefings: 7:30 AM London time`);
console.log(`🌙 Evening reflections: 9:00 PM London time`);
console.log(`🔒 Authorised user ID: ${AUTHORISED_ID}`);

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
