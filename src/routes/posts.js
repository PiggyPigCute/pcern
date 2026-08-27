const express = require('express');
const discord = require('../discord');
const { requireAuth, requireVerified } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    res.json({ posts: await discord.listForumPosts() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const [post, messages] = await Promise.all([
      discord.getThreadPost(req.params.id),
      discord.getThreadMessages(req.params.id),
    ]);
    res.json({ post, messages });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post('/', requireAuth, requireVerified, async (req, res) => {
  const { title, content } = req.body || {};
  if (!String(title || '').trim() || !String(content || '').trim()) {
    return res.status(400).json({ error: 'Titre et message requis.' });
  }
  try {
    const post = await discord.createForumPost({
      title: title.trim(),
      content: content.trim(),
      username: req.user.displayName,
      avatarUrl: req.user.avatarUrl,
    });
    res.json({ post });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/messages', requireAuth, requireVerified, async (req, res) => {
  const { content } = req.body || {};
  if (!String(content || '').trim()) {
    return res.status(400).json({ error: 'Message vide.' });
  }
  try {
    const message = await discord.postReply({
      threadId: req.params.id,
      content: content.trim(),
      username: req.user.displayName,
      avatarUrl: req.user.avatarUrl,
    });
    res.json({ message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
