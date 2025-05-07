const express = require('express');
const router = express.Router();
const transcriptionService = require('../services/transcriptionService');
const llmService = require('../services/llmService');
const brainService = require('../services/brainService');
const actionItemsService = require('../services/actionItemsService');

/**
 * Get all transcriptions with optional filtering
 */
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    
    const transcriptions = await transcriptionService.getTranscriptions({
      search
    });
    
    res.render('transcriptions', {
      title: 'Transcriptions',
      transcriptions
    });
  } catch (error) {
    console.error('Error getting transcriptions:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving transcriptions',
      error: error.message
    });
  }
});

/**
 * API to get all transcriptions
 */
router.get('/api', async (req, res) => {
  try {
    const { search, memory_id, session_id } = req.query;
    
    const transcriptions = await transcriptionService.getTranscriptions({
      search,
      memory_id,
      session_id
    });
    
    res.json({
      success: true,
      transcriptions
    });
  } catch (error) {
    console.error('Error getting transcriptions:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving transcriptions',
      error: error.message
    });
  }
});

/**
 * API to get a specific transcription
 */
router.get('/api/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const transcription = await transcriptionService.getTranscriptionById(id);
    
    if (!transcription) {
      return res.status(404).json({
        success: false,
        message: 'Transcription not found'
      });
    }
    
    res.json({
      success: true,
      transcription
    });
  } catch (error) {
    console.error('Error getting transcription:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving transcription',
      error: error.message
    });
  }
});

/**
 * API to get transcriptions for a specific memory
 */
router.get('/memory/:memory_id', async (req, res) => {
  try {
    const { memory_id } = req.params;
    
    const transcriptions = await transcriptionService.getTranscriptionsByMemoryId(memory_id);
    
    res.json({
      success: true,
      transcriptions
    });
  } catch (error) {
    console.error('Error getting memory transcriptions:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving memory transcriptions',
      error: error.message
    });
  }
});

/**
 * Search transcriptions
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
    
    const transcriptions = await transcriptionService.searchTranscriptions(q);
    
    res.render('transcriptions', {
      title: `Search: ${q}`,
      transcriptions,
      searchQuery: q
    });
  } catch (error) {
    console.error('Error searching transcriptions:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching transcriptions',
      error: error.message
    });
  }
});

/**
 * Process text into separate brain, memory, and action items
 */
router.post('/process', async (req, res) => {
  try {
    const { text, session_id } = req.body;
    
    if (!text) {
      return res.status(400).json({
        success: false,
        message: 'Text is required'
      });
    }
    
    console.log('Processing text input with separate AI requests...');
    
    // Create a transcription for the input
    const transcription = await transcriptionService.createTranscription(text, session_id);
    
    // Process with separate API requests
    const [brainEntities, memories, actionItems] = await Promise.all([
      // Brain entities request
      llmService.analyzeBrainEntities(text).then(async (result) => {
        console.log(`Brain analysis complete: ${result.people.length} people, ${result.locations.length} locations, ${result.events.length} events`);
        try {
          // Process entities into brain nodes
          const processedEntities = await brainService.processEntities(result);
          return processedEntities;
        } catch (error) {
          console.error('Error processing brain entities:', error);
          return null;
        }
      }),
      
      // Memories request
      llmService.extractMemories(text).then(async (memories) => {
        console.log(`Memory extraction complete: ${memories.length} memories`);
        // Just return the memories, they will be saved elsewhere
        return memories;
      }),
      
      // Action items request
      llmService.extractActionItems(text).then(async (items) => {
        console.log(`Action item extraction complete: ${items.length} action items`);
        // Create action items in the database
        const savedItems = [];
        for (const item of items) {
          try {
            const savedItem = await actionItemsService.createActionItem({
              title: item.title,
              description: item.description,
              due_date: item.dueDate,
              priority: item.priority
            });
            savedItems.push(savedItem);
          } catch (error) {
            console.error('Error saving action item:', error);
          }
        }
        return savedItems;
      })
    ]);
    
    res.json({
      success: true,
      transcription,
      brain: brainEntities,
      memories,
      actionItems
    });
  } catch (error) {
    console.error('Error processing text input:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing text input',
      error: error.message
    });
  }
});

module.exports = router; 