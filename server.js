require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const authRoutes = require('./src/routes/authRoutes');
const giftRoutes = require('./src/routes/giftRoutes');
const analyticsRoutes = require('./src/routes/analyticsRoutes');
const feedbackRoutes = require('./src/routes/feedbackRoutes');
const wishlistRoutes = require('./src/routes/wishlistRoutes');
const cartRoutes = require('./src/routes/cartRoutes');

const communityRoutes = require('./src/routes/communityRoutes');
const remindersRoutes = require('./src/routes/remindersRoutes');
const orderRoutes = require('./src/routes/orderRoutes');
const chatRoutes = require('./src/routes/chatRoutes');
const notificationsRoutes = require('./src/routes/notificationsRoutes');
const profileRoutes = require('./src/routes/profileRoutes');
const deliveryRoutes = require('./src/routes/deliveryRoutes');

const fileUpload = require('express-fileupload');

const app = express();

app.use(
  cors({
    origin: true,        // ✅ ngrok + Expo + mobile safe
    credentials: true,
  })
);



// Add VERY EARLY request logging to catch all requests
app.use((req, res, next) => {
  if (req.method === 'PUT' && req.path.includes('profile')) {
    console.log('🔵 [VERY EARLY] PUT /profile request detected');
    console.log('🔵 [VERY EARLY] Content-Type:', req.headers['content-type']);
    console.log('🔵 [VERY EARLY] Content-Length:', req.headers['content-length']);
  }
  next();
});

// Configure file upload BEFORE body parser to handle multipart/form-data
// parseNested: true allows parsing nested form fields
app.use(
  fileUpload({
    createParentPath: true,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    abortOnLimit: true,
    parseNested: true,
    useTempFiles: false, // Use memory storage for React Native compatibility
    debug: false,
    safeFileNames: true,
    preserveExtension: true,
  })
);

// Body parser for JSON (only for non-multipart requests)
// Conditionally apply body parsers - skip for multipart/form-data
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType && contentType.includes('multipart/form-data')) {
    // Skip body parsing for multipart requests - express-fileupload handles it
    return next();
  }
  // For non-multipart requests, apply body parsers
  bodyParser.json({ limit: '10mb' })(req, res, (err) => {
    if (err) return next(err);
    bodyParser.urlencoded({ extended: true, limit: '10mb' })(req, res, next);
  });
});

// Add request logging middleware EARLY for debugging (before routes)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  console.log(`Content-Type: ${req.headers['content-type'] || 'none'}`);
  console.log(`Content-Length: ${req.headers['content-length'] || 'none'}`);
  next();
});

// Log origin for CORS debugging
app.use((req, res, next) => {
  const origin = req.headers.origin || 'unknown';
  console.log(`🌐 Request origin: ${origin}`);
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/gifts', giftRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/cart', cartRoutes);

app.use('/api/community', communityRoutes);
app.use('/api/reminders', remindersRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/delivery', deliveryRoutes);

// Error handling middleware (must be after routes)
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);
  console.error('Error stack:', err.stack);
  res.status(500).json({ 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Catch-all route for debugging 404 errors
app.use('*', (req, res) => {
  console.error(`❌ 404 - Route not found: ${req.method} ${req.originalUrl}`);
  console.error('Available routes:');
  console.error('  Auth: POST /api/auth/signup, /api/auth/mobile-login, /api/auth/verify-code, /api/auth/login');
  console.error('  Wishlist: GET /api/wishlist, POST /api/wishlist/:giftId, DELETE /api/wishlist/:giftId');
  console.error('  Cart: GET /api/cart, POST /api/cart/:giftId, DELETE /api/cart/:giftId, POST /api/cart/checkout');
  console.error('  Orders: GET /api/orders?all=true, GET /api/orders/:id, PUT /api/orders/:id/status');
  console.error('  Community: GET /api/community/ideas, POST /api/community/ideas, POST /api/community/ideas/:ideaId/like');
  res.status(404).json({ 
    message: '404 page not found',
    requestedPath: req.originalUrl,
    method: req.method
  });
});

// Start notification scheduler
const { startScheduler } = require('./src/services/notificationScheduler');
startScheduler();

// Start password reminder scheduler
const { startPasswordReminderScheduler } = require('./src/services/passwordReminderScheduler');
startPasswordReminderScheduler();

const port = process.env.PORT || 4000;
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on port ${port}`);
  console.log('Server accessible at:');
  console.log(`  - http://localhost:${port}`);
 console.log(`  - http://192.168.1.102:${port}`);

});

// Handle port already in use error
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port ${port} is already in use.`);
    console.error(`\nTo fix this, you can:`);
    console.error(`  1. Kill the process using port ${port}:`);
    console.error(`     Windows: netstat -ano | findstr :${port}`);
    console.error(`     Then: taskkill /PID <PID> /F`);
    console.error(`  2. Or use a different port by setting PORT environment variable`);
    console.error(`     Example: set PORT=4001 && npm run dev\n`);
    process.exit(1);
  } else {
    console.error('Server error:', error);
    process.exit(1);
  }
});