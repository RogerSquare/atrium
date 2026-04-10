const express = require('express');
const { loadChatMessages, getUniqueOnlineUsers } = require('../lib/chat');
const { logger } = require('../lib/logger');

const router = express.Router();

/**
 * @swagger
 * /api/chat/messages:
 *   get:
 *     summary: Get chat message history
 *     tags: [Chat]
 *     responses:
 *       200:
 *         description: Array of chat messages
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ChatMessage'
 */
router.get('/messages', (req, res) => {
  try {
    const messages = loadChatMessages();
    res.json(messages);
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/chat/online:
 *   get:
 *     summary: Get online chat users
 *     tags: [Chat]
 *     responses:
 *       200:
 *         description: Array of online usernames
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   username:
 *                     type: string
 */
router.get('/online', (req, res) => {
  try {
    res.json(getUniqueOnlineUsers());
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GIF search proxy (Tenor API v2)
/**
 * @swagger
 * /api/chat/gifs:
 *   get:
 *     summary: Search GIFs (Tenor API proxy)
 *     tags: [Chat]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search query (returns trending if empty)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Array of GIF objects
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   title:
 *                     type: string
 *                   tiny:
 *                     type: string
 *                     description: Small preview URL
 *                   full:
 *                     type: string
 *                     description: Full-size GIF URL
 */
router.get('/gifs', async (req, res) => {
  try {
    const apiKey = process.env.TENOR_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'TENOR_API_KEY not configured' });

    const q = req.query.q || '';
    const limit = req.query.limit || 20;
    const endpoint = q
      ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${apiKey}&limit=${limit}&media_filter=tinygif,gif`
      : `https://tenor.googleapis.com/v2/featured?key=${apiKey}&limit=${limit}&media_filter=tinygif,gif`;

    const response = await fetch(endpoint);
    const data = await response.json();

    const gifs = (data.results || []).map(r => ({
      id: r.id,
      title: r.title || '',
      tiny: r.media_formats?.tinygif?.url || r.media_formats?.gif?.url,
      full: r.media_formats?.gif?.url || r.media_formats?.tinygif?.url
    }));

    res.json(gifs);
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
