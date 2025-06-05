const { run, get, all } = require('../models/database');
const { calculateSimilarity, normalizeText } = require('../utils/textUtils');

/**
 * Create a new action item
 * @param {Object} actionItem - Action item details
 * @returns {Promise<Object>} - The created action item
 */
async function createActionItem(actionItem) {
  try {
    const { title, description, due_date, priority = 1, expires_at } = actionItem;
    
    const normalizedTitle = normalizeText(title);
    const normalizedDescription = normalizeText(description);

    const result = await run(
      'INSERT INTO action_items (title, description, due_date, priority, expires_at) VALUES (?, ?, ?, ?, ?)',
      [normalizedTitle, normalizedDescription, due_date, priority, expires_at]
    );
    
    return {
      id: result.id,
      title: normalizedTitle,
      description: normalizedDescription,
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
    // Look for recent pending action items to check against.
    const recentActionItems = await all(
      'SELECT * FROM action_items WHERE status = "pending" ORDER BY created_at DESC LIMIT 15'
    );

    if (!recentActionItems || recentActionItems.length === 0) {
      return false;
    }

    const normalizedTitle = normalizeText(actionItem.title);

    // Use a title similarity check on recent items
    for (const existingItem of recentActionItems) {
      const titleSimilarity = calculateSimilarity(
        normalizeText(existingItem.title),
        normalizedTitle
      );
      
      if (titleSimilarity > 0.85) { // 85% similarity threshold for titles
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
        const normalizedTitle = normalizeText(item.title);
        // Skip empty items
        if (!normalizedTitle || normalizedTitle.trim() === '') {
          continue;
        }
        
        // Format due date if provided
        let dueDate = null;
        let expiresAt = null;
        
        if (item.dueDate || item.due_date) {
          const dateStr = item.dueDate || item.due_date;
          
          try {
            // First try direct parsing (for ISO dates, etc.)
            const parsedDate = new Date(dateStr);
            if (!isNaN(parsedDate.getTime())) {
              dueDate = parsedDate.toISOString();
              
              // Set expiration to 7 days after due date
              const expiration = new Date(parsedDate);
              expiration.setDate(parsedDate.getDate() + 7);
              expiresAt = expiration.toISOString();
            } else {
              // Handle natural language date references
              const today = new Date();
              const lowerDateStr = dateStr.toLowerCase();
              
              if (lowerDateStr.includes('asap') || lowerDateStr.includes('as soon as possible')) {
                // Set to today
                dueDate = today.toISOString();
                // Expire in 3 days
                const expiration = new Date(today);
                expiration.setDate(today.getDate() + 3);
                expiresAt = expiration.toISOString();
              } else if (lowerDateStr.includes('tomorrow')) {
                const tomorrow = new Date(today);
                tomorrow.setDate(today.getDate() + 1);
                dueDate = tomorrow.toISOString();
                // Expire in 4 days
                const expiration = new Date(today);
                expiration.setDate(today.getDate() + 4);
                expiresAt = expiration.toISOString();
              } else if (lowerDateStr.includes('next week')) {
                const nextWeek = new Date(today);
                nextWeek.setDate(today.getDate() + 7);
                dueDate = nextWeek.toISOString();
                // Expire in 14 days
                const expiration = new Date(today);
                expiration.setDate(today.getDate() + 14);
                expiresAt = expiration.toISOString();
              } else if (lowerDateStr.includes('next month')) {
                const nextMonth = new Date(today);
                nextMonth.setMonth(today.getMonth() + 1);
                dueDate = nextMonth.toISOString();
                // Expire in 45 days
                const expiration = new Date(today);
                expiration.setDate(today.getDate() + 45);
                expiresAt = expiration.toISOString();
              } else if (lowerDateStr.includes('days') || lowerDateStr.includes('day')) {
                // Extract number of days if present
                const match = lowerDateStr.match(/(\d+)\s+days?/);
                if (match && match[1]) {
                  const days = parseInt(match[1]);
                  const future = new Date(today);
                  future.setDate(today.getDate() + days);
                  dueDate = future.toISOString();
                  // Expire in days + 7 days
                  const expiration = new Date(today);
                  expiration.setDate(today.getDate() + days + 7);
                  expiresAt = expiration.toISOString();
                } else {
                  // Default to 3 days if no specific number
                  const threeDays = new Date(today);
                  threeDays.setDate(today.getDate() + 3);
                  dueDate = threeDays.toISOString();
                  // Expire in 10 days
                  const expiration = new Date(today);
                  expiration.setDate(today.getDate() + 10);
                  expiresAt = expiration.toISOString();
                }
              } else if (lowerDateStr.includes('hour') || lowerDateStr.includes('hrs')) {
                // For "hours" references, set to tomorrow
                const tomorrow = new Date(today);
                tomorrow.setDate(today.getDate() + 1);
                dueDate = tomorrow.toISOString();
                // Expire in 4 days
                const expiration = new Date(today);
                expiration.setDate(today.getDate() + 4);
                expiresAt = expiration.toISOString();
              } else {
                // For other natural language dates, default to 3 days from now
                console.log(`Converting natural language date "${dateStr}" to 3 days from now`);
                const threeDays = new Date(today);
                threeDays.setDate(today.getDate() + 3);
                dueDate = threeDays.toISOString();
                // Expire in 10 days
                const expiration = new Date(today);
                expiration.setDate(today.getDate() + 10);
                expiresAt = expiration.toISOString();
              }
            }
          } catch (e) {
            console.warn('Invalid due date format:', dateStr);
            // Default to 3 days from now
            const threeDays = new Date();
            threeDays.setDate(threeDays.getDate() + 3);
            dueDate = threeDays.toISOString();
            // Expire in 10 days
            const expiration = new Date();
            expiration.setDate(expiration.getDate() + 10);
            expiresAt = expiration.toISOString();
          }
        } else {
          // If no due date, set expiration to 30 days from now for cleanup
          const expiration = new Date();
          expiration.setDate(expiration.getDate() + 30);
          expiresAt = expiration.toISOString();
        }
        
        // Check for duplicates before creating
        const actionItemData = {
          title: normalizedTitle,
          description: normalizeText(item.description) || '',
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
}; 