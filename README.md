# 📋 Trello → Telegram Daily Task Bot

Sends a daily summary of your Trello board to a Telegram group — for free.

## What it sends every morning
- 🔴 **Overdue tasks** — things past their due date
- 🟡 **Due today** — tasks due today
- 🔵 **All incomplete tasks** — everything not done yet

---

## Setup (30 minutes, all free)

### Step 1 — Create a Trello account & board
1. Go to https://trello.com and sign up (free)
2. Create a new board (e.g. "Team Tasks")
3. Add lists like: `To Do`, `In Progress`, `Done`
4. Add cards with due dates and assign members

### Step 2 — Get your Trello API credentials
1. Go to https://trello.com/app-key
2. Copy your **API Key**
3. Click **"Token"** link on the same page → authorize → copy the **Token**
4. Get your **Board ID**: open your board, add `.json` to the URL
   e.g. `https://trello.com/b/ABC123/my-board.json` → Board ID is `ABC123`

### Step 3 — Create a Telegram Bot
1. Open Telegram, search for **@BotFather**
2. Send `/newbot`
3. Give it a name (e.g. "Team Tasks Bot") and username (e.g. `myteamtasks_bot`)
4. Copy the **token** it gives you

### Step 4 — Get your Telegram Group Chat ID
1. Add your bot to your Telegram group
2. Send any message in the group
3. Visit this URL in your browser (replace TOKEN):
   `https://api.telegram.org/botTOKEN/getUpdates`
4. Look for `"chat":{"id":` — copy that number (it's negative for groups, e.g. `-1001234567890`)

### Step 5 — Configure the bot
1. Copy `.env.example` to `.env`
2. Fill in all the values

```
TELEGRAM_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
TELEGRAM_CHAT_ID=-1001234567890
TRELLO_API_KEY=abc123...
TRELLO_TOKEN=xyz789...
TRELLO_BOARD_ID=ABC123
```

### Step 6 — Run it

```bash
npm install
node bot.js        # run once to test
node cron.js       # run with scheduler (8 AM daily)
```

---

## Deploy for Free (so it runs 24/7)

### Option A — Railway (easiest)
1. Push code to GitHub
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Add environment variables in the Railway dashboard
4. Set start command to `node cron.js`
5. Free tier gives 500 hours/month ✅

### Option B — Render
1. Push to GitHub
2. Go to https://render.com → New → Background Worker
3. Build command: `npm install`
4. Start command: `node cron.js`
5. Add environment variables
6. Free tier available ✅

### Option C — Run on your own computer
Just keep a terminal running with `node cron.js`

---

## Customize the schedule

Edit `cron.js` and change the cron expression:
- `"0 8 * * *"` = 8:00 AM every day
- `"0 9 * * 1-5"` = 9:00 AM weekdays only
- `"0 8,17 * * *"` = 8 AM and 5 PM daily

All times are in your server's timezone (UTC on Railway/Render).
For Philippine time (UTC+8), set hour to `0` for 8 AM PH time.

---

## Files
- `bot.js` — main bot logic
- `cron.js` — scheduler wrapper
- `.env.example` — config template
