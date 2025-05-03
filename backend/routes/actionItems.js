const express = require('express');
const router = express.Router();
const actionItemsService = require('../services/actionItemsService');

/**
 * Get all action items with optional filtering
 */
router.get('/', async (req, res) => {
  try {
    const { status, priority, sortBy, sortOrder } = req.query;
    
    const actionItems = await actionItemsService.getActionItems({
      status,
      priority: priority ? parseInt(priority) : undefined,
      sortBy,
      sortOrder
    });
    
    res.render('actionItems', {
      title: 'Action Items',
      actionItems
    });
  } catch (error) {
    console.error('Error getting action items:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving action items',
      error: error.message
    });
  }
});

/**
 * API to get all action items
 */
router.get('/api', async (req, res) => {
  try {
    const { status, priority, sortBy, sortOrder } = req.query;
    
    const actionItems = await actionItemsService.getActionItems({
      status,
      priority: priority ? parseInt(priority) : undefined,
      sortBy,
      sortOrder
    });
    
    res.json({
      success: true,
      actionItems
    });
  } catch (error) {
    console.error('Error getting action items:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving action items',
      error: error.message
    });
  }
});

/**
 * Create a new action item
 */
router.post('/', async (req, res) => {
  try {
    const { title, description, due_date, priority } = req.body;
    
    if (!title) {
      return res.status(400).json({
        success: false,
        message: 'Title is required'
      });
    }
    
    const actionItem = await actionItemsService.createActionItem({
      title,
      description,
      due_date,
      priority: priority ? parseInt(priority) : 1
    });
    
    res.json({
      success: true,
      actionItem
    });
  } catch (error) {
    console.error('Error creating action item:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating action item',
      error: error.message
    });
  }
});

/**
 * Update an action item
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, due_date, priority, status } = req.body;
    
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (due_date !== undefined) updates.due_date = due_date;
    if (priority !== undefined) updates.priority = parseInt(priority);
    if (status !== undefined) updates.status = status;
    
    const actionItem = await actionItemsService.updateActionItem(id, updates);
    
    if (!actionItem) {
      return res.status(404).json({
        success: false,
        message: 'Action item not found'
      });
    }
    
    res.json({
      success: true,
      actionItem
    });
  } catch (error) {
    console.error('Error updating action item:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating action item',
      error: error.message
    });
  }
});

/**
 * Delete an action item
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const success = await actionItemsService.deleteActionItem(id);
    
    res.json({
      success
    });
  } catch (error) {
    console.error('Error deleting action item:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting action item',
      error: error.message
    });
  }
});

/**
 * Mark an action item as complete
 */
router.post('/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    
    const actionItem = await actionItemsService.completeActionItem(id);
    
    if (!actionItem) {
      return res.status(404).json({
        success: false,
        message: 'Action item not found'
      });
    }
    
    res.json({
      success: true,
      actionItem
    });
  } catch (error) {
    console.error('Error completing action item:', error);
    res.status(500).json({
      success: false,
      message: 'Error completing action item',
      error: error.message
    });
  }
});

module.exports = router; 