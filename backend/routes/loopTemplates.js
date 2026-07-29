const express = require('express');
const loopInstructions = require('../lib/loopInstructions');
const { logger } = require('../lib/logger');

const router = express.Router();

// Reusable loop instruction templates (feat-loopsv2-instructions-001).
// Mounted at /api/loop-templates behind requireAuth.

function handleError(res, err, context) {
  if (err && err.status === 400) return res.status(400).json({ error: err.message });
  logger.error({ err }, context || 'Loop templates request failed');
  return res.status(500).json({ error: 'Internal server error' });
}

router.get('/', (req, res) => {
  try { res.json(loopInstructions.listTemplates()); }
  catch (err) { handleError(res, err, 'Failed to list templates'); }
});

router.post('/', (req, res) => {
  try {
    const tpl = loopInstructions.createTemplate(req.body || {});
    res.status(201).json({ success: true, template: tpl });
  } catch (err) { handleError(res, err, 'Failed to create template'); }
});

router.put('/:id', (req, res) => {
  try {
    const tpl = loopInstructions.updateTemplate(req.params.id, req.body || {});
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true, template: tpl });
  } catch (err) { handleError(res, err, 'Failed to update template'); }
});

router.delete('/:id', (req, res) => {
  try {
    const removed = loopInstructions.deleteTemplate(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true });
  } catch (err) { handleError(res, err, 'Failed to delete template'); }
});

module.exports = router;
