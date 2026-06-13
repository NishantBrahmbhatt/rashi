# Rashi 🤍
*Your personal AI secretary. Lives in Telegram. Runs your life.*

---

## What Rashi does

- Sends you a morning briefing every day at 7:30 AM
- Prompts an evening reflection at 9:00 PM
- Answers any message instantly — calendar questions, task creation, planning, brainstorming
- Has full read/write access to your TickTick calendar
- Remembers conversation history and knows you from your context files

---

## Setup (do this once)

### 1. Create your Telegram bot

1. Open Telegram and message **@BotFather**
2. Send `/newbot`
3. Give it a name: `Rashi` and a username: `rashi_yourname_bot`
4. BotFather gives you a token — copy it

### 2. Get your Telegram chat ID

1. Message **@userinfobot** on Telegram
2. It replies with your user ID — copy the number

### 3. Get your Gemini API key

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Click **Get API key** → Create API key
3. Copy it

### 4. Set up environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in:
```
TELEGRAM_BOT_TOKEN=    # from BotFather
TELEGRAM_CHAT_ID=      # your user ID number
GEMINI_API_KEY=        # from AI Studio
TICKTICK_TOKEN=        # already filled in
```

### 5. Install and run

```bash
npm install
npm run dev
```

Rashi is online. Message her on Telegram.

---

## Deploy to Railway (so she runs 24/7)

1. Push this folder to a GitHub repo (private)
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add your `.env` variables in Railway's environment settings
4. Deploy — done. Rashi runs forever for free.

---

## Project structure

```
rashi/
├── src/
│   ├── index.js        # Telegram bot + cron jobs
│   ├── rashi.js        # Gemini AI brain + personality
│   ├── ticktick.js     # TickTick MCP integration
│   └── memory.js       # Context file reader/writer
├── context/
│   ├── profile.md      # Who Nishant is — always loaded
│   ├── projects.md     # Active projects — always loaded
│   ├── reflections.md  # Evening reflections log — loaded when relevant
│   └── conversation.json  # Last 20 messages (auto-managed)
├── .env                # Your secrets (never commit this)
├── .env.example        # Template
└── package.json
```

---

## Customising Rashi

**Change briefing/reflection times:**
Edit the cron schedules in `src/index.js`:
```js
// Morning briefing — currently 7:30 AM
cron.schedule('30 7 * * *', ...)

// Evening reflection — currently 9:00 PM
cron.schedule('0 21 * * *', ...)
```

**Update your profile:**
Edit `context/profile.md` directly, or just tell Rashi in chat — she'll update it.

**Adjust Rashi's personality:**
Edit the system prompt in `src/rashi.js` → `buildSystemPrompt()`

---

## Things you can say to Rashi

- *"What's on today?"*
- *"Add a task: finish nishant.build hero section, tomorrow 10am, high priority"*
- *"Mark the Costco prep task as done"*
- *"I have 3 projects to work on this week — help me plan them out"*
- *"Move everything from today to tomorrow, I'm not feeling it"*
- *"What should I focus on this week?"*
- *"I want to start waking up at 6am — help me build toward that"*
