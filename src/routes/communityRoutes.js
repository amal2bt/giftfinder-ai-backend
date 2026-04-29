const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const communityController = require('../controllers/communityController');

// ----------------------------
// Public routes (mobile)
// ----------------------------
router.get('/ideas', communityController.getIdeas); 
router.get('/ideas/:ideaId/comments', communityController.getComments);

// ----------------------------
// Authenticated routes (mobile)
// ----------------------------
router.use(authMiddleware);

router.get('/my-ideas', communityController.getIdeas);
router.post('/ideas', communityController.createIdea);
router.put('/ideas/:ideaId', communityController.updateIdea);
router.delete('/ideas/:ideaId', communityController.deleteIdea);
router.post('/ideas/:ideaId/like', communityController.likeIdea);
router.post('/ideas/:ideaId/comments', communityController.addComment);

// ----------------------------
// Admin routes (simple version)
// ----------------------------
router.get('/admin/all', authMiddleware, communityController.getIdeas);
router.delete('/admin/delete/:ideaId', authMiddleware, communityController.deleteIdea);
router.delete('/admin/delete-flagged', authMiddleware, communityController.deleteAllFlagged);

module.exports = router;
