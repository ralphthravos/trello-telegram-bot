require("dotenv").config();
const axios = require("axios");
const cron = require("node-cron");

// ── CONFIG ────────────────────────────────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TRELLO_API_KEY = process.env.TRELLO_API_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const TRELLO_BOARD_ID = process.env.TRELLO_BOARD_ID;
const DEFAULT_LIST_NAME = (process.env.DEFAULT_LIST_NAME || "To Do").trim();
const DONE_LIST_NAMES = (process.env.DONE_LIST_NAMES || "Done,Complete,Finished,Closed").split(",").map(s => s.trim().toLowerCase());
const REPORT_CRON = process.env.REPORT_CRON || "0 8 * * *";
const REPORT_TZ = process.env.REPORT_TZ || "America/New_York";

// ── TRELLO HELPERS ────────────────────────────────────────────────────────────
const trello = axios.create({
  baseURL: "https://api.trello.com/1",
  params: { key: TRELLO_API_KEY, token: TRELLO_TOKEN },
});

async function getBoard() {
  const { data } = await trello.get(`/boards/${TRELLO_BOARD_ID}`);
  return data;
}

async function getLists() {
  const { data } = await trello.get(`/boards/${TRELLO_BOARD_ID}/lists`);
  return data;
}

async function getCards(listId) {
  const { data } = await trello.get(`/lists/${listId}/cards`, {
    params: { fields: "name,due,dueComplete,members,url,idMembers", key: TRELLO_API_KEY, token: TRELLO_TOKEN },
  });
  return data;
}

async function getMember(memberId) {
  try {
    const { data } = await trello.get(`/members/${memberId}`, {
      params: { fields: "fullName,username", key: TRELLO_API_KEY, token: TRELLO_TOKEN },
    });
    return data.fullName || data.username;
  } catch {
    return null;
  }
}

async function createCard(name, listId) {
  const { data } = await trello.post("/cards", null, {
    params: { name, idList: listId, key: TRELLO_API_KEY, token: TRELLO_TOKEN },
  });
  return data;
}

// ── TELEGRAM HELPERS ──────────────────────────────────────────────────────────
const tg = axios.create({
  baseURL: `https://api.telegram.org/bot${TELEGRAM_TOKEN}`,
});

async function sendTgMessage(chatId, text, replyToMessageId = null) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "MarkdownV2",
    disable_web_page_preview: true,
  };
  if (replyToMessageId) payload.reply_to_message_id = replyToMessageId;
  const { data } = await tg.post("/sendMessage", payload);
  return data;
}

// ── DATE HELPERS ──────────────────────────────────────────────────────────────
function isToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return d < now;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── MARKDOWN HELPERS ──────────────────────────────────────────────────────────
function escMd(text) {
  return String(text).replace(/[_*[\]()~`>#+=|{}.!\\-]/g, "\\$&");
}

// ── REPORT ────────────────────────────────────────────────────────────────────
async function buildReport() {
  const board = await getBoard();
  const lists = await getLists();
  const activeLists = lists.filter(l => !DONE_LIST_NAMES.includes(l.name.toLowerCase()));

  const overdueCards = [];
  const dueTodayCards = [];
  const allIncompleteCards = [];

  const memberCache = {};
  async function cachedMember(id) {
    if (!memberCache[id]) memberCache[id] = await getMember(id);
    return memberCache[id];
  }

  for (const list of activeLists) {
    const cards = await getCards(list.id);
    for (const card of cards) {
      if (card.dueComplete) continue;

      const assignees = card.idMembers && card.idMembers.length > 0
        ? (await Promise.all(card.idMembers.map(cachedMember))).filter(Boolean)
        : [];

      const entry = { name: card.name, list: list.name, due: card.due, assignees, url: card.url };

      allIncompleteCards.push(entry);
      if (card.due && isOverdue(card.due) && !card.dueComplete) overdueCards.push(entry);
      if (card.due && isToday(card.due)) dueTodayCards.push(entry);
    }
  }

  return { board, overdueCards, dueTodayCards, allIncompleteCards };
}

function formatCard(card, emoji = "•") {
  let line = `${emoji} *${escMd(card.name)}*`;
  if (card.list) line += ` _\\(${escMd(card.list)}\\)_`;
  if (card.due) line += `\n   📅 Due: ${escMd(formatDate(card.due))}`;
  if (card.assignees.length > 0) line += `\n   👤 ${card.assignees.map(escMd).join(", ")}`;
  return line;
}

function splitMessage(text, maxLen) {
  const chunks = [];
  while (text.length > maxLen) {
    let split = text.lastIndexOf("\n\n", maxLen);
    if (split === -1) split = maxLen;
    chunks.push(text.slice(0, split));
    text = text.slice(split).trim();
  }
  if (text) chunks.push(text);
  return chunks;
}

async function sendDailyReport() {
  const { board, overdueCards, dueTodayCards, allIncompleteCards } = await buildReport();

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  let msg = `📋 *Daily Task Report* — ${escMd(board.name)}\n`;
  msg += `🗓 ${escMd(today)}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (overdueCards.length > 0) {
    msg += `🔴 *OVERDUE TASKS* \\(${overdueCards.length}\\)\n`;
    msg += overdueCards.map(c => formatCard(c, "🔴")).join("\n\n") + "\n\n";
  } else {
    msg += `✅ No overdue tasks\\!\n\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  if (dueTodayCards.length > 0) {
    msg += `🟡 *DUE TODAY* \\(${dueTodayCards.length}\\)\n`;
    msg += dueTodayCards.map(c => formatCard(c, "🟡")).join("\n\n") + "\n\n";
  } else {
    msg += `🟡 *DUE TODAY* — Nothing due today\\.\n\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🔵 *ALL INCOMPLETE TASKS* \\(${allIncompleteCards.length}\\)\n`;
  if (allIncompleteCards.length === 0) {
    msg += `🎉 All tasks are done\\!\n`;
  } else {
    msg += allIncompleteCards.map(c => formatCard(c, "🔵")).join("\n\n") + "\n";
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━━\n_Powered by your friendly task bot_ 🤖`;

  const chunks = splitMessage(msg, 4000);
  for (const chunk of chunks) {
    await sendTgMessage(TELEGRAM_CHAT_ID, chunk);
  }

  console.log(`✅ Report sent — ${allIncompleteCards.length} incomplete, ${overdueCards.length} overdue, ${dueTodayCards.length} due today`);
}

// ── COMMAND HANDLING ──────────────────────────────────────────────────────────
// Syntax: /task Task name
//         /task Task name > List name
//         /task Task name → List name
function parseTaskCommand(text) {
  const match = text.match(/^\/task(?:@\S+)?\s+(.+?)(?:\s*[→>]\s*(.+))?$/i);
  if (!match) return null;
  return {
    name: match[1].trim(),
    list: match[2] ? match[2].trim() : null,
  };
}

async function handleTaskCommand(msg) {
  const parsed = parseTaskCommand(msg.text);
  if (!parsed) {
    await sendTgMessage(
      msg.chat.id,
      `❓ *Usage:*\n/task Task name\n/task Task name \\> List name`,
      msg.message_id
    );
    return;
  }

  const lists = await getLists();

  let targetList;
  if (parsed.list) {
    const lower = parsed.list.toLowerCase();
    targetList = lists.find(l => l.name.toLowerCase() === lower);
    if (!targetList) {
      const available = lists.map(l => escMd(l.name)).join(", ");
      await sendTgMessage(
        msg.chat.id,
        `❌ List *${escMd(parsed.list)}* not found\\.\n📂 Available: ${available}`,
        msg.message_id
      );
      return;
    }
  } else {
    const lower = DEFAULT_LIST_NAME.toLowerCase();
    targetList = lists.find(l => l.name.toLowerCase() === lower) || lists[0];
  }

  const card = await createCard(parsed.name, targetList.id);

  await sendTgMessage(
    msg.chat.id,
    `✅ Task created\\!\n📌 *${escMd(card.name)}*\n📂 List: *${escMd(targetList.name)}*\n🔗 [Open in Trello](${card.url})`,
    msg.message_id
  );

  console.log(`📌 Card created: "${card.name}" → ${targetList.name}`);
}

// ── POLLING LOOP ──────────────────────────────────────────────────────────────
let offset = 0;

async function handleUpdate(update) {
  const msg = update.message || update.channel_post;
  if (!msg || !msg.text) return;

  // Only respond to the configured chat
  if (String(msg.chat.id) !== String(TELEGRAM_CHAT_ID)) return;

  if (msg.text.startsWith("/task")) {
    await handleTaskCommand(msg);
  }
}

async function poll() {
  console.log("👂 Listening for /task commands...");
  while (true) {
    try {
      const { data } = await tg.get("/getUpdates", {
        params: { offset, timeout: 30, allowed_updates: ["message", "channel_post"] },
        timeout: 35000,
      });
      for (const update of data.result) {
        offset = update.update_id + 1;
        handleUpdate(update).catch(err =>
          console.error("Update handler error:", err.response?.data || err.message)
        );
      }
    } catch (err) {
      if (err.code !== "ECONNABORTED") {
        console.error("Polling error:", err.response?.data || err.message);
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ── ENTRY ─────────────────────────────────────────────────────────────────────
console.log("🤖 Bot started.");
console.log(`📅 Daily report scheduled: ${REPORT_CRON} (${REPORT_TZ})`);
console.log(`📋 Default task list: "${DEFAULT_LIST_NAME}"`);

cron.schedule(REPORT_CRON, () => {
  console.log(`⏰ Running daily report at ${new Date().toISOString()}`);
  sendDailyReport().catch(err =>
    console.error("Report error:", err.response?.data || err.message)
  );
}, { timezone: REPORT_TZ });

poll().catch(err => {
  console.error("Fatal polling error:", err.message);
  process.exit(1);
});
