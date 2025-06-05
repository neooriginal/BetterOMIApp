const { run, get, all } = require('../models/database');
const chrono = require('chrono-node');

/**
 * Create a new action item
 * @param {Object} actionItem - Action item details
 * @returns {Promise<Object>} - The created action item
 */
async function createActionItem(actionItem) {
  try {
    const { title, description, due_date, priority = 1, expires_at } = actionItem;
    
    const result = await run(
      'INSERT INTO action_items (title, description, due_date, priority, expires_at) VALUES (?, ?, ?, ?, ?)',
      [title, description, due_date, priority, expires_at]
    );
    
    return {
      id: result.id,
      title,
      description,
      due_date,
      priority,
      status: 'pending',
      created_at: new Date().toISOString(),
      expires_at
    };
  } catch (error) {
    console.error('Error creating action item:', error);
    throw error;
  }
}

/**
 * Get all action items
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} - List of action items
 */
async function getActionItems(options = {}) {
  try {
    const { status, priority, sortBy = 'priority', sortOrder = 'DESC' } = options;
    
    let query = 'SELECT * FROM action_items';
    const params = [];
    
    // Add filters
    const conditions = [];
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    
    if (priority) {
      conditions.push('priority = ?');
      params.push(priority);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    // Add sorting
    query += ` ORDER BY ${sortBy} ${sortOrder}`;
    
    return await all(query, params);
  } catch (error) {
    console.error('Error retrieving action items:', error);
    throw error;
  }
}

/**
 * Update an action item
 * @param {number} id - ID of the action item to update
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} - The updated action item
 */
async function updateActionItem(id, updates) {
  try {
    const { title, description, due_date, priority, status, expires_at } = updates;
    
    // Build update query dynamically based on provided fields
    const setFields = [];
    const params = [];
    
    if (title !== undefined) {
      setFields.push('title = ?');
      params.push(title);
    }
    
    if (description !== undefined) {
      setFields.push('description = ?');
      params.push(description);
    }
    
    if (due_date !== undefined) {
      setFields.push('due_date = ?');
      params.push(due_date);
    }
    
    if (priority !== undefined) {
      setFields.push('priority = ?');
      params.push(priority);
    }
    
    if (status !== undefined) {
      setFields.push('status = ?');
      params.push(status);
    }
    
    if (expires_at !== undefined) {
      setFields.push('expires_at = ?');
      params.push(expires_at);
    }
    
    if (setFields.length === 0) {
      return await get('SELECT * FROM action_items WHERE id = ?', [id]);
    }
    
    // Add id to params
    params.push(id);
    
    // Execute update
    await run(
      `UPDATE action_items SET ${setFields.join(', ')} WHERE id = ?`,
      params
    );
    
    // Return updated item
    return await get('SELECT * FROM action_items WHERE id = ?', [id]);
  } catch (error) {
    console.error('Error updating action item:', error);
    throw error;
  }
}

/**
 * Delete an action item
 * @param {number} id - ID of the action item to delete
 * @returns {Promise<boolean>} - Success status
 */
async function deleteActionItem(id) {
  try {
    await run('DELETE FROM action_items WHERE id = ?', [id]);
    return true;
  } catch (error) {
    console.error('Error deleting action item:', error);
    throw error;
  }
}

/**
 * Mark an action item as complete
 * @param {number} id - ID of the action item
 * @returns {Promise<Object>} - The updated action item
 */
async function completeActionItem(id) {
  try {
    await run(
      'UPDATE action_items SET status = ? WHERE id = ?',
      ['completed', id]
    );
    
    return await get('SELECT * FROM action_items WHERE id = ?', [id]);
  } catch (error) {
    console.error('Error completing action item:', error);
    throw error;
  }
}

/**
 * Check if a similar action item already exists to prevent duplicates
 * @param {Object} actionItem - Action item details to check
 * @returns {Promise<boolean>} - Whether a similar action item exists
 */
async function checkForDuplicateActionItem(actionItem) {
  try {
    // Look for action items with the same title or very similar titles
    // Limit to pending items only so completed ones can be recreated
    const similarActionItems = await all(
      'SELECT * FROM action_items WHERE status = "pending" AND title = ? ORDER BY created_at DESC LIMIT 3',
      [actionItem.title]
    );
    
    if (similarActionItems && similarActionItems.length > 0) {
      console.log(`Found ${similarActionItems.length} potential duplicate action items with title: ${actionItem.title}`);
      return true;
    }
    
    // Also check for fuzzy matches on title to catch slight variations
    const fuzzyMatches = await all(
      'SELECT * FROM action_items WHERE status = "pending" ORDER BY created_at DESC LIMIT 20'
    );
    
    // Use a title similarity check on recent items
    for (const existingItem of fuzzyMatches) {
      const titleSimilarity = calculateTitleSimilarity(
        existingItem.title.toLowerCase(),
        actionItem.title.toLowerCase()
      );
      
      if (titleSimilarity > 0.8) { // 80% similarity threshold for titles
        console.log(`Found similar action item: "${existingItem.title}" with ${Math.round(titleSimilarity * 100)}% title similarity`);
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('Error checking for duplicate action item:', error);
    return false; // Proceed with creation in case of error
  }
}

/**
 * Calculate title similarity using a simple approach
 * @param {string} title1 - First title
 * @param {string} title2 - Second title
 * @returns {number} - Similarity ratio between 0 and 1
 */
function calculateTitleSimilarity(title1, title2) {
  if (!title1 || !title2) return 0;
  
  // Use a simple word-based approach for titles
  const words1 = title1.split(/\s+/).filter(Boolean);
  const words2 = title2.split(/\s+/).filter(Boolean);
  
  // Count matching words
  let matchCount = 0;
  for (const word of words1) {
    if (words2.includes(word)) {
      matchCount++;
    }
  }
  
  // Calculate similarity as a ratio of matching words to total unique words
  const totalUniqueWords = new Set([...words1, ...words2]).size;
  
  return matchCount / totalUniqueWords;
}

/**
 * Process action items from LLM extraction
 * @param {Array} actionItems - Action items extracted by LLM
 * @returns {Promise<Array>} - Created action items
 */
async function processActionItems(actionItems) {
  const results = [];
  
  try {
    if (Array.isArray(actionItems)) {
      console.log(`Processing ${actionItems.length} extracted action items`);
      
      for (const item of actionItems) {
        // Skip empty items
        if (!item.title || item.title.trim() === '') {
          continue;
        }
        
        // Format due date if provided
        let dueDate = null;
        let expiresAt = null;
        
        if (item.dueDate || item.due_date) {
          const dateStr = item.dueDate || item.due_date;

          const parsed = chrono.parseDate(dateStr, new Date(), { forwardDate: true });
          if (parsed) {
            dueDate = parsed.toISOString();
            const expiration = new Date(parsed);
            expiration.setDate(expiration.getDate() + 7);
            expiresAt = expiration.toISOString();
          } else {
            console.warn('Unable to parse due date:', dateStr);
          }
        }

        if (!expiresAt) {
          const base = dueDate ? new Date(dueDate) : new Date();
          base.setDate(base.getDate() + 30);
          expiresAt = base.toISOString();
        }
        
        // Check for duplicates before creating
        const actionItemData = {
          title: item.title,
          description: item.description || '',
          due_date: dueDate,
          priority: item.priority || 3, // Default to medium priority if not specified,
          expires_at: expiresAt
        };
        
        const isDuplicate = await checkForDuplicateActionItem(actionItemData);
        if (isDuplicate) {
          console.log(`Skipping duplicate action item: "${item.title}"`);
          continue;
        }

        const createdItem = await createActionItem(actionItemData);
        results.push(createdItem);
      }
    }
    
    console.log(`Created ${results.length} unique action items`);
    return results;
  } catch (error) {
    console.error('Error processing action items:', error);
    throw error;
  }
}

module.exports = {
  createActionItem,
  getActionItems,
  updateActionItem,
  deleteActionItem,
  completeActionItem,
  processActionItems,
  checkForDuplicateActionItem,
  calculateTitleSimilarity
}; 