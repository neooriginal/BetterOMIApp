const { run, get, all } = require('../models/database');
const transcriptionService = require('./transcriptionService');

/**
 * Create a new memory
 * @param {Object} memory - Memory details
 * @returns {Promise<Object>} - The created memory
 */
async function createMemory(memory) {
  try {
    const { 
      title, 
      content, 
      context = null, 
      participants = null, 
      key_points = null, 
      importance = 1, 
      expires_at = null 
    } = memory;
    
    // Convert arrays to JSON strings for storage
    const participantsJson = participants ? JSON.stringify(participants) : null;
    const keyPointsJson = key_points ? JSON.stringify(key_points) : null;
    
    const result = await run(
      'INSERT INTO memories (title, content, context, participants, key_points, importance, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [title, content, context, participantsJson, keyPointsJson, importance, expires_at]
    );
    
    return {
      id: result.id,
      title,
      content,
      context,
      participants,
      key_points,
      importance,
      expires_at,
      created_at: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error creating memory:', error);
    throw error;
  }
}

/**
 * Get all memories
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} - List of memories
 */
async function getMemories(options = {}) {
  try {
    const { importance, sortBy = 'importance', sortOrder = 'DESC', search } = options;
    
    let query = 'SELECT * FROM memories';
    const params = [];
    
    // Add filters
    const conditions = [];
    
    if (importance) {
      conditions.push('importance >= ?');
      params.push(importance);
    }
    
    if (search) {
      conditions.push('(title LIKE ? OR content LIKE ?)');
      params.push(`%${search}%`);
      params.push(`%${search}%`);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    // Add sorting
    query += ` ORDER BY ${sortBy} ${sortOrder}`;
    
    return await all(query, params);
  } catch (error) {
    console.error('Error retrieving memories:', error);
    throw error;
  }
}

/**
 * Get a memory by ID
 * @param {number} id - ID of the memory to retrieve
 * @returns {Promise<Object>} - The memory
 */
async function getMemoryById(id) {
  try {
    return await get('SELECT * FROM memories WHERE id = ?', [id]);
  } catch (error) {
    console.error('Error retrieving memory:', error);
    throw error;
  }
}

/**
 * Update a memory
 * @param {number} id - ID of the memory to update
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} - The updated memory
 */
async function updateMemory(id, updates) {
  try {
    const { 
      title, 
      content, 
      context, 
      participants, 
      key_points, 
      importance, 
      expires_at 
    } = updates;
    
    // Build update query dynamically based on provided fields
    const setFields = [];
    const params = [];
    
    if (title !== undefined) {
      setFields.push('title = ?');
      params.push(title);
    }
    
    if (content !== undefined) {
      setFields.push('content = ?');
      params.push(content);
    }
    
    if (context !== undefined) {
      setFields.push('context = ?');
      params.push(context);
    }
    
    if (participants !== undefined) {
      setFields.push('participants = ?');
      params.push(JSON.stringify(participants));
    }
    
    if (key_points !== undefined) {
      setFields.push('key_points = ?');
      params.push(JSON.stringify(key_points));
    }
    
    if (importance !== undefined) {
      setFields.push('importance = ?');
      params.push(importance);
    }
    
    if (expires_at !== undefined) {
      setFields.push('expires_at = ?');
      params.push(expires_at);
    }
    
    if (setFields.length === 0) {
      return await get('SELECT * FROM memories WHERE id = ?', [id]);
    }
    
    // Add id to params
    params.push(id);
    
    // Execute update
    await run(
      `UPDATE memories SET ${setFields.join(', ')} WHERE id = ?`,
      params
    );
    
    // Return updated memory
    return await get('SELECT * FROM memories WHERE id = ?', [id]);
  } catch (error) {
    console.error('Error updating memory:', error);
    throw error;
  }
}

/**
 * Delete a memory
 * @param {number} id - ID of the memory to delete
 * @returns {Promise<boolean>} - Success status
 */
async function deleteMemory(id) {
  try {
    await run('DELETE FROM memories WHERE id = ?', [id]);
    return true;
  } catch (error) {
    console.error('Error deleting memory:', error);
    throw error;
  }
}

/**
 * Process memories from LLM extraction
 * @param {Array} memories - Memories extracted by LLM
 * @param {string} sessionId - Session ID for linking transcriptions
 * @returns {Promise<Array>} - Created memories
 */
async function processMemories(memories, sessionId) {
  const results = [];
  
  try {
    if (Array.isArray(memories) && memories.length > 0) {
      console.log(`Processing ${memories.length} consolidated memories`);
      
      for (const item of memories) {
        // Skip empty memories or memories with insufficient content
        if (!item.title || !item.content || item.title.trim() === '' || item.content.trim() === '') {
          console.log('Skipping empty memory item');
          continue;
        }
        
        // Skip memories with placeholder or generic titles
        if (/^(unknown|placeholder|generic|text information|stored information)$/i.test(item.title.trim())) {
          console.log(`Skipping generic memory with title: "${item.title}"`);
          continue;
        }
        
        // Validate memory content length - ensure it's substantial
        const contentWords = item.content.split(/\s+/).length;
        const minimumWords = item.importance >= 3 ? 200 : 100;
        
        if (contentWords < minimumWords) {
          console.log(`Skipping memory with insufficient content: ${contentWords} words (minimum: ${minimumWords})`);
          continue;
        }
        
        console.log(`Processing memory: "${item.title}" (${contentWords} words)`);
        
        // Calculate expiration date if provided
        let expiresAt = null;
        if (item.expiration && item.expiration !== 'permanent') {
          try {
            // Handle both numeric days and date strings
            if (!isNaN(parseInt(item.expiration))) {
              const days = parseInt(item.expiration);
              const date = new Date();
              date.setDate(date.getDate() + days);
              expiresAt = date.toISOString();
              console.log(`Setting expiration to ${days} days from now: ${expiresAt}`);
            } else {
              // Try to parse as a date string
              expiresAt = new Date(item.expiration).toISOString();
              console.log(`Setting expiration from date string: ${expiresAt}`);
            }
          } catch (e) {
            console.warn('Invalid expiration format:', item.expiration);
          }
        }
        
        try {
          console.log(`Creating memory with importance ${item.importance || 3}`);
          
          // Handle new memory fields
          const memoryData = {
            title: item.title,
            content: item.content,
            context: item.context || null,
            participants: item.participants || null,
            key_points: item.keyPoints || item.key_points || null, // Support both formats
            importance: item.importance || 3,
            expires_at: expiresAt
          };
          
          const memory = await createMemory(memoryData);
          
          // If sessionId is provided, find the latest transcription and link it to this memory
          if (sessionId) {
            try {
              // Get all transcriptions for this session
              const transcriptions = await transcriptionService.getTranscriptions({ 
                session_id: sessionId,
                sortBy: 'created_at',
                sortOrder: 'DESC'
              });
              
              // Link the most recent transcription to this memory
              if (transcriptions && transcriptions.length > 0) {
                await transcriptionService.linkTranscriptionToMemory(transcriptions[0].id, memory.id);
                console.log(`Linked transcription ${transcriptions[0].id} to memory ${memory.id}`);
              }
            } catch (err) {
              console.error('Error linking transcription to memory:', err);
            }
          }
          
          results.push(memory);
        } catch (memoryError) {
          console.error('Error creating memory:', memoryError);
        }
      }
      
      return results;
    }
    
    return [];
  } catch (error) {
    console.error('Error processing memories:', error);
    throw error;
  }
}

/**
 * Search memories by content
 * @param {string} searchTerm - Search term
 * @returns {Promise<Array>} - List of matching memories
 */
async function searchMemories(searchTerm) {
  try {
    return await all(
      'SELECT * FROM memories WHERE title LIKE ? OR content LIKE ? ORDER BY importance DESC', 
      [`%${searchTerm}%`, `%${searchTerm}%`]
    );
  } catch (error) {
    console.error('Error searching memories:', error);
    throw error;
  }
}

module.exports = {
  createMemory,
  getMemories,
  getMemoryById,
  updateMemory,
  deleteMemory,
  processMemories,
  searchMemories
}; 