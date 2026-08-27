const express = require('express');
const discord = require('../discord');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    res.json({ posts: await discord.listForumPosts() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    res.json({ messages: await discord.getThreadMessages(req.params.id) });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post('/', requireAuth, async (req, res) => {
  const { title, content } = req.body || {};
  if (!String(title || '').trim() || !String(content || '').trim()) {
    return res.status(400).json({ error: 'Titre et message requis.' });
  }
  try {
    const threadId = await discord.createForumPost({
      title: title.trim(),
      content: content.trim(),
      username: req.user.displayName,
      avatarUrl: req.user.avatarUrl,
    });
    res.json({ threadId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/messages', requireAuth, async (req, res) => {
  const { content } = req.body || {};
  if (!String(content || '').trim()) {
    return res.status(400).json({ error: 'Message vide.' });
  }
  try {
    await discord.postReply({
      threadId: req.params.id,
      content: content.trim(),
      username: req.user.displayName,
      avatarUrl: req.user.avatarUrl,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
