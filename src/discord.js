const {
  Client,
  GatewayIntentBits,
  ChannelType,
  WebhookClient,
} = require('discord.js');
const { loadJSON, saveJSON } = require('./store');

const WEBHOOK_FILE = 'webhook.json';
const WEBHOOK_NAME = 'PCErn';

let client = null;
let forumChannelId = null;
let onEvent = () => {}; // (type, payload) => void, wired by server.js via ws.js

function init({ token, guild, forumChannel, onEvent: handler }) {
  if (!token) throw new Error('DISCORD_TOKEN manquant.');
  if (!guild) throw new Error('GUILD_ID manquant.');
  if (!forumChannel) throw new Error('FORUM_CHANNEL_ID manquant.');

  forumChannelId = forumChannel;
  if (handler) onEvent = handler;

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on('threadCreate', async thread => {
    if (thread.parentId !== forumChannelId) return;
    onEvent('newPost', { post: await threadToPost(thread) });
  });

  client.on('messageCreate', async message => {
    if (!message.channel.isThread()) return;
    if (message.channel.parentId !== forumChannelId) return;
    onEvent('newMessage', { threadId: message.channel.id, message: await messageToJSON(message) });
  });

  return client.login(token).then(() => waitReady());
}

function waitReady() {
  if (client.isReady()) return Promise.resolve();
  return new Promise(resolve => client.once('ready', resolve));
}

function getForumChannel() {
  const channel = client.channels.cache.get(forumChannelId);
  if (!channel) throw new Error('Salon forum introuvable (vérifie FORUM_CHANNEL_ID et les permissions du bot).');
  if (channel.type !== ChannelType.GuildForum) throw new Error('Le salon configuré n\'est pas un salon forum.');
  return channel;
}

function tagNames(channel, appliedTags) {
  const byId = new Map(channel.availableTags.map(t => [t.id, t.name]));
  return (appliedTags || []).map(id => byId.get(id)).filter(Boolean);
}

async function threadToPost(thread) {
  const channel = getForumChannel();
  let excerpt = '';
  let authorId = thread.ownerId;
  try {
    const starter = await thread.fetchStarterMessage();
    if (starter) {
      excerpt = starter.content;
      authorId = starter.author.id;
    }
  } catch {
    // le message de départ peut avoir été supprimé
  }

  return {
    id: thread.id,
    title: thread.name,
    authorId,
    excerpt,
    tags: tagNames(channel, thread.appliedTags),
    messageCount: thread.messageCount ?? 0,
    archived: thread.archived,
    locked: thread.locked,
    createdAt: thread.createdAt,
  };
}

async function resolveDisplayName(message) {
  if (message.webhookId) return message.author.username; // pas un vrai membre du serveur
  if (message.member) return message.member.displayName;
  try {
    const member = await message.guild.members.fetch(message.author.id);
    return member.displayName;
  } catch {
    return message.author.username; // n'est peut-être plus sur le serveur
  }
}

async function messageToJSON(message) {
  return {
    id: message.id,
    authorId: message.author.id,
    authorName: await resolveDisplayName(message),
    authorAvatar: message.author.displayAvatarURL(),
    content: message.content,
    createdAt: message.createdAt,
    viaWebhook: Boolean(message.webhookId),
  };
}

async function listForumPosts() {
  const channel = getForumChannel();
  const [active, archived] = await Promise.all([
    channel.threads.fetchActive(),
    channel.threads.fetchArchived(),
  ]);
  const threads = [...active.threads.values(), ...archived.threads.values()];
  threads.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
  return Promise.all(threads.map(threadToPost));
}

async function fetchOwnThread(threadId) {
  const thread = await client.channels.fetch(threadId);
  if (!thread || !thread.isThread() || thread.parentId !== forumChannelId) {
    throw new Error('Post introuvable.');
  }
  return thread;
}

async function getThreadPost(threadId) {
  return threadToPost(await fetchOwnThread(threadId));
}

async function getThreadMessages(threadId) {
  const thread = await fetchOwnThread(threadId);
  const messages = await thread.messages.fetch({ limit: 100 });
  return Promise.all([...messages.values()].reverse().map(messageToJSON));
}

async function ensureWebhook() {
  const cached = loadJSON(WEBHOOK_FILE, null);
  if (cached) return new WebhookClient({ id: cached.id, token: cached.token });

  const channel = getForumChannel();
  const existing = (await channel.fetchWebhooks()).find(w => w.name === WEBHOOK_NAME);
  const webhook = existing || (await channel.createWebhook({ name: WEBHOOK_NAME }));

  saveJSON(WEBHOOK_FILE, { id: webhook.id, token: webhook.token });
  return new WebhookClient({ id: webhook.id, token: webhook.token });
}

async function createForumPost({ title, content, username, avatarUrl }) {
  const webhookClient = await ensureWebhook();
  const result = await webhookClient.send({
    content,
    username,
    avatarURL: avatarUrl || undefined,
    threadName: title.slice(0, 100),
    allowedMentions: { parse: [] },
    wait: true,
  });
  const thread = await client.channels.fetch(result.channelId);
  const post = await threadToPost(thread);
  // diffusé tout de suite avec les infos qu'on connaît nous-mêmes (pseudo/
  // avatar exacts) plutôt que d'attendre le seul écho du gateway Discord,
  // qui ne renvoie pas de façon fiable l'avatar personnalisé d'un webhook
  onEvent('newPost', { post });
  return post;
}

async function postReply({ threadId, content, username, avatarUrl }) {
  await fetchOwnThread(threadId);
  const webhookClient = await ensureWebhook();
  const result = await webhookClient.send({
    content,
    username,
    avatarURL: avatarUrl || undefined,
    threadId,
    allowedMentions: { parse: [] },
    wait: true,
  });
  // le Message renvoyé par WebhookClient#send n'est pas hydraté par le
  // client complet (pas de UserManager) : result.author n'a pas les
  // méthodes de User (ex. displayAvatarURL) — on reconstruit le JSON à
  // partir de ce qu'on a nous-mêmes envoyé plutôt que de le lire dessus
  const message = {
    id: result.id,
    authorId: result.author?.id ?? null,
    authorName: username,
    authorAvatar: avatarUrl,
    content: result.content,
    createdAt: new Date().toISOString(),
    viaWebhook: true,
  };
  // même logique que createForumPost : on diffuse nous-mêmes l'avatar exact
  // plutôt que de compter sur l'écho gateway (message.author.displayAvatarURL()
  // n'y reflète pas de façon fiable l'avatar personnalisé du webhook — Discord
  // ne renvoie pas toujours un hash d'avatar pour ces messages, et retombe
  // alors sur son propre avatar générique)
  onEvent('newMessage', { threadId, message });
  return message;
}

module.exports = {
  init,
  listForumPosts,
  getThreadPost,
  getThreadMessages,
  createForumPost,
  postReply,
};
