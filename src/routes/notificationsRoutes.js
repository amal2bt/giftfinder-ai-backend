const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const { getAll, markAsRead, markAllAsRead, getUnreadCount } = require('../controllers/notificationsController');

router.get('/', auth, getAll);
router.get('/unread-count', auth, getUnreadCount);
router.put('/:id/read', auth, markAsRead);
router.put('/read-all', auth, markAllAsRead);

module.exports = router;

