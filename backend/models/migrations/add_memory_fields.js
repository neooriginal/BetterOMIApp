const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '../../data/genomi.db');

// Open database connection
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to database:', err);
    process.exit(1);
  }
  console.log('Connected to the database');
});

// Function to run SQL query and handle errors
function runQuery(query, message) {
  return new Promise((resolve, reject) => {
    db.run(query, function(err) {
      if (err) {
        if (err.message.includes('duplicate column')) {
          console.log(`${message} (column already exists)`);
          resolve();
        } else {
          console.error(`Error: ${message}:`, err);
          reject(err);
        }
      } else {
        console.log(`Success: ${message}`);
        resolve();
      }
    });
  });
}

// Function to check if a table exists
function tableExists(tableName) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [tableName],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(!!row);
        }
      }
    );
  });
}

// Perform migration
async function performMigration() {
  try {
    console.log('Starting migration...');
    
    // Check if memories table exists
    const memoryTableExists = await tableExists('memories');
    
    if (!memoryTableExists) {
      console.log('Memories table does not exist, creating it...');
      await runQuery(
        `CREATE TABLE memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          context TEXT,
          participants TEXT,
          key_points TEXT,
          importance INTEGER DEFAULT 1,
          expires_at TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`,
        'Creating memories table'
      );
    } else {
      console.log('Memories table already exists, adding new columns...');
      
      // Add context column
      await runQuery(
        'ALTER TABLE memories ADD COLUMN context TEXT',
        'Adding context column'
      );
      
      // Add participants column
      await runQuery(
        'ALTER TABLE memories ADD COLUMN participants TEXT',
        'Adding participants column'
      );
      
      // Add key_points column
      await runQuery(
        'ALTER TABLE memories ADD COLUMN key_points TEXT',
        'Adding key_points column'
      );
    }
    
    console.log('Migration completed successfully');
    closeDatabase(0);
  } catch (error) {
    console.error('Migration failed:', error);
    closeDatabase(1);
  }
}

// Close database connection
function closeDatabase(exitCode) {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
      process.exit(1);
    }
    console.log('Database connection closed');
    process.exit(exitCode);
  });
}

// Run the migration
performMigration(); 