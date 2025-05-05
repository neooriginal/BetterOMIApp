const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const dotenv = require('dotenv');
const http = require('http');

// Load environment variables
dotenv.config();

// Database initialization
const db = require('./models/database');
// Initialize express application
const app = express();

// Set up middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Add error handling middleware
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({
    error: 'Server error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

// Set up view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Import routes
const inputRoutes = require('./routes/input');
const actionItemsRoutes = require('./routes/actionItems');
const memoriesRoutes = require('./routes/memories');
const streamRoutes = require('./routes/stream');
const transcriptionsRoutes = require('./routes/transcriptions');

// Register routes
app.use('/input', inputRoutes);
app.use('/action-items', actionItemsRoutes);
app.use('/memories', memoriesRoutes);
app.use('/stream', streamRoutes);
app.use('/transcriptions', transcriptionsRoutes);

// Home route
app.get('/', (req, res) => {
  //temporary redirect to memories
  res.redirect("/memories");
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Create HTTP server
const server = http.createServer(app);

// Track active connections for graceful shutdown
const connections = new Set();
server.on('connection', (connection) => {
  connections.add(connection);
  connection.on('close', () => {
    connections.delete(connection);
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Implement graceful shutdown
function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  // Prevent multiple shutdown attempts
  if (server.shuttingDown) {
    console.log('Shutdown already in progress');
    return;
  }
  
  server.shuttingDown = true;
  
  // Create a shutdown timeout (force exit after 30 seconds)
  const forceExit = setTimeout(() => {
    console.error('Forcing exit after timeout');
    process.exit(1);
  }, 30000);
  
  // First, stop accepting new connections
  server.close(() => {
    console.log('HTTP server closed');
    
    // Clean up all existing connections
    for (const connection of connections) {
      try {
        connection.destroy();
      } catch (err) {
        // Ignore errors when destroying connections
      }
    }
    
    // Close database connection with a safe check
    if (db.db) {
      try {
        // Check if database is still open
        if (db.db.open) {
          db.db.close((err) => {
            if (err) {
              console.error('Error closing database:', err);
            } else {
              console.log('Database connection closed');
            }
            
            // Clear the force exit timeout and exit normally
            clearTimeout(forceExit);
            process.exit(0);
          });
        } else {
          console.log('Database already closed');
          clearTimeout(forceExit);
          process.exit(0);
        }
      } catch (err) {
        console.error('Error checking database state:', err);
        clearTimeout(forceExit);
        process.exit(0);
      }
    } else {
      clearTimeout(forceExit);
      process.exit(0);
    }
  });
}

// Handle different termination signals
['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal => {
  process.on(signal, () => gracefulShutdown(signal));
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app; 