const { Client, GatewayIntentBits, Partials } = require("discord.js");
const config = require("./config.json");
require("dotenv").config();
const moment = require("moment-timezone");

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

client.on("messageCreate", async (msg) => {
  if (!msg.content.startsWith("!deadline")) return;
  if (!msg.mentions.users.size) {
    return msg.reply("❌ Bạn phải tag người thực hiện.");
  }

  const args = msg.content.split(" ");
  const targetUser = msg.mentions.users.first();

  let dueTime = null;
  let task = "";

  // 👉 Nếu nhập kiểu thời lượng: !deadline @user 30m Nhiệm vụ
  if (args[2].endsWith("h") || args[2].endsWith("m")) {
    const timeArg = args[2];
    task = args.slice(3).join(" ");

    let ms = 0;
    if (timeArg.endsWith("h")) ms = parseInt(timeArg) * 60 * 60 * 1000;
    else if (timeArg.endsWith("m")) ms = parseInt(timeArg) * 60 * 1000;

    dueTime = Date.now() + ms;
  }
  // 👉 Nếu nhập kiểu ngày giờ
  else {
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

  const guildMember = await msg.guild.members.fetch(targetUser.id);

  // ✅ Xóa role "Đã hoàn thành" nếu user có deadline mới
  if (guildMember.roles.cache.has(config.roleId)) {
    await guildMember.roles.remove(config.roleId);
  }

  const deadlineMsg = await msg.channel.send(
    `📌 Deadline cho ${targetUser}:\n**${task}**\nThời hạn: <t:${Math.floor(dueTime / 1000)}:F>\n\nNhấn ✅ nếu hoàn thành!`
  );

  await deadlineMsg.react("✅");

  deadlines.push({
    messageId: deadlineMsg.id,
    userId: targetUser.id,
    due: dueTime,
    done: false,
    channelId: msg.channel.id,
    guildId: msg.guild.id,
    task: task
  });
});

client.on("messageReactionAdd", async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();

  const dl = deadlines.find(d => d.messageId === reaction.message.id);
  if (!dl) return;

  if (reaction.emoji.name === "✅") {
    if (user.id === dl.userId) {
      dl.done = true;
      const guildMember = await reaction.message.guild.members.fetch(user.id);
      await guildMember.roles.add(config.roleId);
      reaction.message.channel.send(`🎉 ${user} đã hoàn thành deadline!`);
    } else {
      reaction.users.remove(user.id);
      reaction.message.channel.send(`⚠️ Chỉ <@${dl.userId}> mới có thể tick ✅`);
    }
  }
});

// ✅ Kiểm tra deadline mỗi giây
setInterval(async () => {
  const now = Date.now();
  for (const dl of [...deadlines]) {
    if (!dl.done && now >= dl.due) {
      try {
        // 🔍 Lấy guild từ dl.guildId
        const guild = await client.guilds.fetch(dl.guildId);
        // 🔍 Tìm kênh có tên "🚨-missed-deadlines"
        const missedChannel = guild.channels.cache.find(
          c => c.name === "🚨-missed-deadlines"
        );

        if (missedChannel) {
          missedChannel.send(
            `⏰ Deadline đã hết hạn!\n<@${dl.userId}> chưa hoàn thành nhiệm vụ: **${dl.task || "Không có mô tả"}**`
          );
        } else {
          console.warn(`⚠️ Không tìm thấy kênh 🚨-missed-deadlines trong server ${guild.name}`);
        }

        // ✅ Gỡ role "Đã hoàn thành" nếu user vẫn còn giữ
        const member = await guild.members.fetch(dl.userId);
        if (member.roles.cache.has(config.roleId)) {
          await member.roles.remove(config.roleId);
        }
      } catch (err) {
        console.error("Lỗi khi xử lý deadline hết hạn:", err);
      }

      deadlines = deadlines.filter(d => d !== dl);
    }
  }
}, 1000);

client.login(process.env.DISCORD_TOKEN);