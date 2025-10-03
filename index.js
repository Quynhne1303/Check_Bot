const { Client, GatewayIntentBits, Partials } = require("discord.js");
const fs = require("fs");
const config = require("./config.json");
require("dotenv").config();

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
  const timeArg = args[2];
  const task = args.slice(3).join(" ");
  const targetUser = msg.mentions.users.first();

  let ms = 0;
  if (timeArg.endsWith("h")) ms = parseInt(timeArg) * 60 * 60 * 1000;
  else if (timeArg.endsWith("m")) ms = parseInt(timeArg) * 60 * 1000;

  const guildMember = await msg.guild.members.fetch(targetUser.id);

  // ✅ Xóa role "Đã hoàn thành" nếu user có deadline mới
  if (guildMember.roles.cache.has(config.roleId)) {
    await guildMember.roles.remove(config.roleId);
  }

  const deadlineMsg = await msg.channel.send(
    `📌 Deadline cho ${targetUser}:\n**${task}**\nThời hạn: ${timeArg}\n\nNhấn ✅ nếu hoàn thành!`
  );

  await deadlineMsg.react("✅");

  deadlines.push({
    messageId: deadlineMsg.id,
    userId: targetUser.id,
    due: Date.now() + ms,
    done: false,
    channelId: msg.channel.id
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

// ✅ Cách 2: kiểm tra mỗi giây để chính xác đến phút/giây
setInterval(async () => {
  const now = Date.now();
  for (const dl of [...deadlines]) {
    if (!dl.done && now >= dl.due) {
      const channel = await client.channels.fetch(dl.channelId);
      channel.send(
        `⏰ Deadline đã hết hạn!\n<@${dl.userId}> chưa hoàn thành nhiệm vụ.`
      );

      // ✅ Gỡ role "Đã hoàn thành" nếu user vẫn còn giữ
      try {
        const guild = channel.guild;
        const member = await guild.members.fetch(dl.userId);
        if (member.roles.cache.has(config.roleId)) {
          await member.roles.remove(config.roleId);
        }
      } catch (err) {
        console.error("Lỗi khi gỡ role:", err);
      }

      // Xóa deadline khỏi danh sách
      deadlines = deadlines.filter(d => d !== dl);
    }
  }
}, 1000);

client.login(process.env.DISCORD_TOKEN);
