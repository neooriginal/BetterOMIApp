const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create a database connection
const dbPath = path.join(__dirname, '..', 'data', 'genomi.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to database:', err.message);
  } else {
    console.log('Connected to the SQLite database');
    initDatabase();
  }
});

// Initialize database tables
function initDatabase() {
  // Create directory for database if it doesn't exist
  const fs = require('fs');
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
  }

  // Brain nodes table (entities: people, locations, etc.)
  db.run(`CREATE TABLE IF NOT EXISTS brain_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    importance INTEGER DEFAULT 1,
    data TEXT
  )`);

  // Action items table (todo items)
  db.run(`CREATE TABLE IF NOT EXISTS action_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    due_date DATETIME,
    priority INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Memories table (conversations and important info)
  db.run(`CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    context TEXT,
    participants TEXT,
    key_points TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    importance INTEGER DEFAULT 1,
    expires_at DATETIME
  )`);

  // Relationships table (connections between nodes)
  db.run(`CREATE TABLE IF NOT EXISTS relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_node_id INTEGER,
    to_node_id INTEGER,
    relationship_type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_node_id) REFERENCES brain_nodes (id),
    FOREIGN KEY (to_node_id) REFERENCES brain_nodes (id)
  )`);

  console.log('Database tables initialized');
}

// Utility function for running SQL with parameters
function run(sql, params = []) {
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
function get(sql, params = []) {
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
function all(sql, params = []) {
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
function cleanupExpiredItems() {
  const now = new Date().toISOString();
  
  // Delete expired brain nodes
  run(`DELETE FROM brain_nodes WHERE expires_at IS NOT NULL AND expires_at < ?`, [now]);
  
  // Delete expired memories
  run(`DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?`, [now]);
  
  console.log('Cleanup of expired items completed');
}

// Run cleanup periodically (once a day)
setInterval(cleanupExpiredItems, 24 * 60 * 60 * 1000);

module.exports = {
  db,
  run,
  get,
  all,
  cleanupExpiredItems
}; 