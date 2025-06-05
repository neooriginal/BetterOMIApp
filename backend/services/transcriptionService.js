const { run, get, all } = require('../models/database');

/**
 * Create a new transcription
 * @param {string} text - Transcription text
 * @param {string} session_id - Session ID
 * @param {number} expirationDays - Number of days until expiration (default: 14)
 * @param {number|null} memory_id - Associated memory ID (optional)
 * @returns {Promise<Object>} - The created transcription
 */
async function createTranscription(text, session_id, expirationDays = 14, memory_id = null) {
  try {
    if (!text || text.trim() === '') {
      throw new Error('Transcription text cannot be empty');
    }
    
    // Calculate expiration date
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + expirationDays);
    const expires_at = expirationDate.toISOString();
    
    const created_at = new Date().toISOString();
    
    console.log(`Creating transcription: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}" for session ${session_id}`);
    
    const result = await run(
      'INSERT INTO transcriptions (text, session_id, memory_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      [text, session_id, memory_id, created_at, expires_at]
    );

    return {
      id: result.id,
      text,
      session_id,
      memory_id,
      created_at,
      expires_at
    };
  } catch (error) {
    console.error('Error creating transcription:', error);
    throw error;
  }
}

/**
 * Get all transcriptions
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} - List of transcriptions
 */
async function getTranscriptions(options = {}) {
  try {
    const { session_id, memory_id, sortBy = 'created_at', sortOrder = 'DESC', search } = options;
    
    let query = 'SELECT * FROM transcriptions WHERE expires_at > datetime("now")';
    const params = [];
    
    // Add filters
    if (session_id) {
      query += ' AND session_id = ?';
      params.push(session_id);
    }
    
    if (memory_id) {
      query += ' AND memory_id = ?';
      params.push(memory_id);
    }
    
    if (search) {
      query += ' AND text LIKE ?';
      params.push(`%${search}%`);
    }
    
    // Add sorting
    query += ` ORDER BY ${sortBy} ${sortOrder}`;
    
    return await all(query, params);
  } catch (error) {
    console.error('Error retrieving transcriptions:', error);
    throw error;
  }
}

/**
 * Get a transcription by ID
 * @param {number} id - ID of the transcription to retrieve
 * @returns {Promise<Object>} - The transcription
 */
async function getTranscriptionById(id) {
  try {
    return await get('SELECT * FROM transcriptions WHERE id = ? AND expires_at > datetime("now")', [id]);
  } catch (error) {
    console.error('Error retrieving transcription:', error);
    throw error;
  }
}

/**
 * Get transcriptions for a specific memory
 * @param {number} memory_id - ID of the memory
 * @returns {Promise<Array>} - List of transcriptions
 */
async function getTranscriptionsByMemoryId(memory_id) {
  try {
    return await all(
      'SELECT * FROM transcriptions WHERE memory_id = ? AND expires_at > datetime("now") ORDER BY created_at DESC',
      [memory_id]
    );
  } catch (error) {
    console.error('Error retrieving memory transcriptions:', error);
    throw error;
  }
}

/**
 * Update a transcription
 * @param {number} id - ID of the transcription to update
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} - The updated transcription
 */
async function updateTranscription(id, updates) {
  try {
    const { text, session_id, memory_id } = updates;
    
    // Build update query dynamically based on provided fields
    const setFields = [];
    const params = [];
    
    if (text !== undefined) {
      setFields.push('text = ?');
      params.push(text);
    }
    
    if (session_id !== undefined) {
      setFields.push('session_id = ?');
      params.push(session_id);
    }
    
    if (memory_id !== undefined) {
      setFields.push('memory_id = ?');
      params.push(memory_id);
    }
    
    if (setFields.length === 0) {
      return await get('SELECT * FROM transcriptions WHERE id = ?', [id]);
    }
    
    // Add id to params
    params.push(id);
    
    // Execute update
    await run(
      `UPDATE transcriptions SET ${setFields.join(', ')} WHERE id = ?`,
      params
    );
    
    // Return updated transcription
    return await get('SELECT * FROM transcriptions WHERE id = ?', [id]);
  } catch (error) {
    console.error('Error updating transcription:', error);
    throw error;
  }
}

/**
 * Delete a transcription
 * @param {number} id - ID of the transcription to delete
 * @returns {Promise<boolean>} - Success status
 */
async function deleteTranscription(id) {
  try {
    await run('DELETE FROM transcriptions WHERE id = ?', [id]);
    return true;
  } catch (error) {
    console.error('Error deleting transcription:', error);
    throw error;
  }
}

/**
 * Associate a transcription with a memory
 * @param {number} transcription_id - ID of the transcription
 * @param {number} memory_id - ID of the memory
 * @returns {Promise<Object>} - The updated transcription
 */
async function linkTranscriptionToMemory(transcription_id, memory_id) {
  try {
    await run(
      'UPDATE transcriptions SET memory_id = ? WHERE id = ?',
      [memory_id, transcription_id]
    );
    
    return await get('SELECT * FROM transcriptions WHERE id = ?', [transcription_id]);
  } catch (error) {
    console.error('Error linking transcription to memory:', error);
    throw error;
  }
}

/**
 * Search transcriptions
 * @param {string} searchTerm - Term to search for
 * @returns {Promise<Array>} - Matching transcriptions
 */
async function searchTranscriptions(searchTerm) {
  try {
    return await all(
      'SELECT * FROM transcriptions WHERE text LIKE ? AND expires_at > datetime("now") ORDER BY created_at DESC',
      [`%${searchTerm}%`]
    );
  } catch (error) {
    console.error('Error searching transcriptions:', error);
    throw error;
  }
}

module.exports = {
  createTranscription,
  getTranscriptions,
  getTranscriptionById,
  getTranscriptionsByMemoryId,
  updateTranscription,
  deleteTranscription,
  linkTranscriptionToMemory,
  searchTranscriptions
}; 