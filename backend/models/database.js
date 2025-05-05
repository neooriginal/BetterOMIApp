const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Database connection configuration
const DB_RETRY_INTERVAL = 5000; // 5 seconds
const MAX_RETRY_ATTEMPTS = 3;
let retryAttempts = 0;
let db = null;

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// Database file path
const dbPath = path.join(dataDir, 'genomi.db');

/**
 * Initialize database connection with retry logic
 */
function connectDatabase() {
  return new Promise((resolve, reject) => {
    // Close existing connection if one exists
    if (db) {
      try {
        db.close();
      } catch (err) {
        console.error('Error closing existing database connection:', err.message);
      }
    }
    
    // Create a new database connection
    db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, async (err) => {
      if (err) {
        console.error('Error connecting to database:', err.message);
        
        // Check if we should retry
        if (retryAttempts < MAX_RETRY_ATTEMPTS) {
          retryAttempts++;
          console.log(`Retrying database connection in ${DB_RETRY_INTERVAL/1000}s... (Attempt ${retryAttempts}/${MAX_RETRY_ATTEMPTS})`);
          
          // Retry after delay
          setTimeout(() => {
            connectDatabase()
              .then(resolve)
              .catch(reject);
          }, DB_RETRY_INTERVAL);
        } else {
          console.error(`Failed to connect to database after ${MAX_RETRY_ATTEMPTS} attempts`);
          reject(err);
        }
      } else {
        console.log('Connected to the SQLite database');
        
        // Reset retry counter on successful connection
        retryAttempts = 0;
        
        try {
          // Initialize database tables
          await initDatabase();
          resolve(db);
        } catch (initErr) {
          console.error('Error initializing database:', initErr);
          reject(initErr);
        }
      }
    });
    
    // Configure database for better concurrency
    db.configure('busyTimeout', 5000); // 5 second timeout for busy operations
  });
}

// Initialize database tables
async function initDatabase() {
  // Create the tables if they don't exist
  return Promise.all([
    run(`CREATE TABLE IF NOT EXISTS brain_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      importance INTEGER DEFAULT 1,
      data TEXT
    )`),
    
    run(`CREATE TABLE IF NOT EXISTS action_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      due_date DATETIME,
      priority INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    
    run(`CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      context TEXT,
      participants TEXT,
      key_points TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      importance INTEGER DEFAULT 1,
      expires_at DATETIME
    )`),
    
    run(`CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_node_id INTEGER,
      to_node_id INTEGER,
      relationship_type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (from_node_id) REFERENCES brain_nodes (id),
      FOREIGN KEY (to_node_id) REFERENCES brain_nodes (id)
    )`),
    
    run(`CREATE TABLE IF NOT EXISTS transcriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      session_id TEXT,
      memory_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      FOREIGN KEY (memory_id) REFERENCES memories (id) ON DELETE SET NULL
    )`)
  ]).then(() => {
    console.log('Database tables initialized');
  });
}

/**
 * Ensure database connection before performing any operation
 * @returns {Promise<sqlite3.Database>} - Database connection
 */
async function ensureConnection() {
  if (!db) {
    return connectDatabase();
  }
  return db;
}

// Utility function for running SQL with parameters
async function run(sql, params = []) {
  await ensureConnection();
  
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        console.error('Error running SQL:', sql);
        console.error(err);
        reject(err);
      } else {
        resolve({ id: this.lastID });
      }
    });
  });
}

// Utility function for getting a single row
async function get(sql, params = []) {
  await ensureConnection();
  
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, result) => {
      if (err) {
        console.error('Error running SQL:', sql);
        console.error(err);
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

// Utility function for getting multiple rows
async function all(sql, params = []) {
  await ensureConnection();
  
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error('Error running SQL:', sql);
        console.error(err);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Function to clean up expired items
async function cleanupExpiredItems() {
  try {
    await ensureConnection();
    const now = new Date().toISOString();
    
    // Delete expired brain nodes
    await run(`DELETE FROM brain_nodes WHERE expires_at IS NOT NULL AND expires_at < ?`, [now]);
    
    // Delete expired memories
    await run(`DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?`, [now]);
    
    // Delete expired transcriptions
    await run(`DELETE FROM transcriptions WHERE expires_at IS NOT NULL AND expires_at < ?`, [now]);
    
    console.log('Cleanup of expired items completed');
  } catch (error) {
    console.error('Error during cleanup of expired items:', error);
  }
}

// Run cleanup periodically (once a day)
setInterval(cleanupExpiredItems, 24 * 60 * 60 * 1000);

// Handle cleanup on process exit
process.on('exit', () => {
  if (db) {
    try {
      // Check if the database is not already closed
      if (db.open) {
        db.close();
        console.log('Database connection closed on exit');
      }
    } catch (err) {
      // Ignore errors during shutdown
      console.error('Error closing database on exit:', err.message);
    }
  }
});

// Initialize the database connection immediately
connectDatabase().catch(err => {
  console.error('Initial database connection failed:', err);
});

module.exports = {
  db,
  run,
  get,
  all,
  cleanupExpiredItems,
  ensureConnection
}; 