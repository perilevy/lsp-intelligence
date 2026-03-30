const express = require('express');
const router = express.Router();

/** GET /api/users — list all users */
router.get('/api/users', (req, res) => {
  res.json({ users: [] });
});

/** POST /api/users — create a user */
router.post('/api/users', (req, res) => {
  res.status(201).json({ id: 1 });
});

/** GET /api/items/:id — get item by ID */
router.get('/api/items/:id', (req, res) => {
  res.json({ id: req.params.id });
});

/** PUT /api/items/:id/status — update item status */
router.put('/api/items/:id/status', (req, res) => {
  res.json({ updated: true });
});

/** DELETE /api/items/:id — delete item */
router.delete('/api/items/:id', (req, res) => {
  res.status(204).send();
});

module.exports = router;
