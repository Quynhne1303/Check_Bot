const { Client, GatewayIntentBits, Partials } = require("discord.js");
const config = require("./config.json");
require("dotenv").config();
const moment = require("moment-timezone");
const express = require("express"); // thêm express

// =========================
// BOT DISCORD
// =========================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

let deadlines = [];

client.once("ready", () => {
  console.log(`✅ Bot đã đăng nhập với ${client.user.tag}`);
});

// =========================
// TẠO DEADLINE
// =========================
client.on("messageCreate", async (msg) => {
  if (!msg.content.startsWith("!deadline")) return;
  if (!msg.mentions.users.size && !msg.mentions.roles.size) {
    return msg.reply("❌ Bạn phải tag ít nhất 1 người hoặc 1 role.");
  }

  const args = msg.content.split(" ");
  let dueTime = null;
  let task = "";

  if (args[2].endsWith("h") || args[2].endsWith("m")) {
    const timeArg = args[2];
    task = args.slice(3).join(" ");

    let ms = 0;
    if (timeArg.endsWith("h")) ms = parseInt(timeArg) * 60 * 60 * 1000;
    else if (timeArg.endsWith("m")) ms = parseInt(timeArg) * 60 * 1000;

    dueTime = Date.now() + ms;
  } else {
    const timeStr = args[2] + " " + args[3];
    task = args.slice(4).join(" ");

    let deadlineMoment = null;
    if (timeStr.includes(":")) {
      deadlineMoment = moment.tz(timeStr, "HH:mm D/M/YYYY", "Asia/Ho_Chi_Minh");
    } else if (timeStr.includes("h")) {
      deadlineMoment = moment.tz(timeStr, "H[h]mm D/M/YYYY", "Asia/Ho_Chi_Minh");
    }

    if (!deadlineMoment || !deadlineMoment.isValid()) {
      return msg.reply("❌ Sai định dạng thời gian. Ví dụ: `30m`, `2h`, `01:23 4/10/2025` hoặc `1h11 4/10/2025`");
    }

    dueTime = deadlineMoment.valueOf();
  }

  let allMembers = [];

  for (const user of msg.mentions.users.values()) {
    const member = await msg.guild.members.fetch(user.id);
    allMembers.push(member);
  }

  for (const role of msg.mentions.roles.values()) {
    const guildMembers = await msg.guild.members.fetch();
    guildMembers.forEach(member => {
      if (member.roles.cache.has(role.id) && !allMembers.find(m => m.id === member.id)) {
        allMembers.push(member);
      }
    });
  }

  if (!allMembers.length) return msg.reply("❌ Không tìm thấy user nào trong tag hoặc role.");

  const mentionList = allMembers.map(m => `<@${m.id}>`).join(", ");
  const deadlineMsg = await msg.channel.send(
    `📌 Deadline cho ${mentionList}:\n**${task}**\nThời hạn: <t:${Math.floor(dueTime / 1000)}:F>\n\nMỗi người hãy nhấn ✅ khi hoàn thành!`
  );
  await deadlineMsg.react("✅");

  for (const member of allMembers) {
    if (member.roles.cache.has(config.roleId)) await member.roles.remove(config.roleId);

    deadlines.push({
      messageId: deadlineMsg.id,
      userId: member.id,
      due: dueTime,
      done: false,
      channelId: msg.channel.id,
      guildId: msg.guild.id,
      task: task,
      expired: false
    });
  }
});

// =========================
// REACTION ADD
// =========================
client.on("messageReactionAdd", async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;

  const dls = deadlines.filter(d => d.messageId === reaction.message.id);
  if (!dls.length) return;

  if (dls[0].expired) {
    reaction.users.remove(user.id);
    return reaction.message.channel.send(`⚠️ Deadline đã hết hạn, bạn không thể tick ✅.`);
  }

  if (reaction.emoji.name === "✅") {
    const dl = dls.find(d => d.userId === user.id);
    if (dl && !dl.done) {
      dl.done = true;
      const guildMember = await reaction.message.guild.members.fetch(user.id);
      await guildMember.roles.add(config.roleId);
      reaction.message.channel.send(`🎉 ${user} đã hoàn thành deadline!`);
    }
  }
});

// =========================
// REACTION REMOVE
// =========================
client.on("messageReactionRemove", async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;

  const dls = deadlines.filter(d => d.messageId === reaction.message.id);
  if (!dls.length) return;

  const dl = dls.find(d => d.userId === user.id);
  if (dl && dl.done && !dl.expired) {
    dl.done = false;
    const guildMember = await reaction.message.guild.members.fetch(user.id);
    if (guildMember.roles.cache.has(config.roleId)) await guildMember.roles.remove(config.roleId);
    reaction.message.channel.send(`⚠️ ${user} đã bỏ ✅, deadline vẫn chưa hoàn thành.`);
  }
});

// =========================
// KIỂM TRA DEADLINE HẾT HẠN
// =========================
setInterval(async () => {
  const now = Date.now();
  for (const dl of [...deadlines]) {
    if (!dl.expired && now >= dl.due) {
      dl.expired = true;

      try {
        const guild = await client.guilds.fetch(dl.guildId);
        const missedChannel = guild.channels.cache.find(c => c.name === "🚨-missed-deadlines");

        if (missedChannel && !dl.done) {
          missedChannel.send(
            `⏰ Deadline đã hết hạn!\n<@${dl.userId}> chưa hoàn thành nhiệm vụ: **${dl.task || "Không có mô tả"}**`
          );
        }

        const member = await guild.members.fetch(dl.userId);
        if (member.roles.cache.has(config.roleId)) await member.roles.remove(config.roleId);
      } catch (err) {
        console.error("Lỗi khi xử lý deadline hết hạn:", err);
      }
    }
  }
}, 1000);

// =========================
// WEB SERVER DUMMY (giữ bot online Replit / Web Service)
// =========================
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Bot đang chạy!");
});

app.listen(PORT, () => console.log(`🌐 Web server đang chạy trên port ${PORT}`));

// =========================
// LOGIN DISCORD
// =========================
client.login(process.env.DISCORD_TOKEN);
