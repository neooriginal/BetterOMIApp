const express = require('express');
const router = express.Router();
const memoriesService = require('../services/memoriesService');

/**
 * Get all memories with optional filtering
 */
router.get('/', async (req, res) => {
  try {
    const { importance, sortBy, sortOrder, search } = req.query;
    
    const memories = await memoriesService.getMemories({
      importance: importance ? parseInt(importance) : undefined,
      sortBy,
      sortOrder,
      search
    });
    
    res.render('memories', {
      title: 'Memories',
      memories
    });
  } catch (error) {
    console.error('Error getting memories:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving memories',
      error: error.message
    });
  }
});

/**
 * API to get all memories
 */
router.get('/api', async (req, res) => {
  try {
    const { importance, sortBy, sortOrder, search } = req.query;
    
    const memories = await memoriesService.getMemories({
      importance: importance ? parseInt(importance) : undefined,
      sortBy,
      sortOrder,
      search
    });
    
    res.json({
      success: true,
      memories
    });
  } catch (error) {
    console.error('Error getting memories:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving memories',
      error: error.message
    });
  }
});

/**
 * Get a specific memory by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const memory = await memoriesService.getMemoryById(id);
    
    if (!memory) {
      return res.status(404).json({
        success: false,
        message: 'Memory not found'
      });
    }
    
    res.render('memoryDetail', {
      title: memory.title,
      memory
    });
  } catch (error) {
    console.error('Error getting memory:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving memory',
      error: error.message
    });
  }
});

/**
 * API to get a specific memory
 */
router.get('/api/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const memory = await memoriesService.getMemoryById(id);
    
    if (!memory) {
      return res.status(404).json({
        success: false,
        message: 'Memory not found'
      });
    }
    
    res.json({
      success: true,
      memory
    });
  } catch (error) {
    console.error('Error getting memory:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving memory',
      error: error.message
    });
  }
});

/**
 * Create a new memory
 */
router.post('/', async (req, res) => {
  try {
    const { title, content, importance, expires_at } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({
        success: false,
        message: 'Title and content are required'
      });
    }
    
    const memory = await memoriesService.createMemory({
      title,
      content,
      importance: importance ? parseInt(importance) : 1,
      expires_at
    });
    
    res.json({
      success: true,
      memory
    });
  } catch (error) {
    console.error('Error creating memory:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating memory',
      error: error.message
    });
  }
});

/**
 * Update a memory
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, importance, expires_at } = req.body;
    
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (importance !== undefined) updates.importance = parseInt(importance);
    if (expires_at !== undefined) updates.expires_at = expires_at;
    
    const memory = await memoriesService.updateMemory(id, updates);
    
    if (!memory) {
      return res.status(404).json({
        success: false,
        message: 'Memory not found'
      });
    }
    
    res.json({
      success: true,
      memory
    });
  } catch (error) {
    console.error('Error updating memory:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating memory',
      error: error.message
    });
  }
});

/**
 * Delete a memory
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const success = await memoriesService.deleteMemory(id);
    
    res.json({
      success
    });
  } catch (error) {
    console.error('Error deleting memory:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting memory',
      error: error.message
    });
  }
});

/**
 * Search memories
 */
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }
    
    const memories = await memoriesService.searchMemories(q);
    
    res.render('memories', {
      title: `Search: ${q}`,
      memories,
      searchQuery: q
    });
  } catch (error) {
    console.error('Error searching memories:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching memories',
      error: error.message
    });
  }
});

module.exports = router; 