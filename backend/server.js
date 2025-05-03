const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Database initialization
const db = require('./models/database');

// Initialize express application
const app = express();

// Set up middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Set up view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Import routes
const inputRoutes = require('./routes/input');
const actionItemsRoutes = require('./routes/actionItems');
const memoriesRoutes = require('./routes/memories');
const streamRoutes = require('./routes/stream');

// Register routes
app.use('/input', inputRoutes);
app.use('/action-items', actionItemsRoutes);
app.use('/memories', memoriesRoutes);
app.use('/stream', streamRoutes);

// Home route
app.get('/', (req, res) => {
  res.render('index');
});

// Stream demo page
app.get('/stream-demo', (req, res) => {
  res.render('stream_demo');
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Handle errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

module.exports = app; 