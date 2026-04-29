const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const { listGifts, createGift, updateGift, deleteGift } = require('../controllers/giftController');

// Public read: listing gifts does not require auth
router.get('/', listGifts);
// Accept file upload for create and update (using express-fileupload from server.js)
router.post('/', auth, createGift);
router.put('/:id', auth, updateGift);
router.delete('/:id', auth, deleteGift);

module.exports = router;


