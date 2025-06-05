const express = require('express');
const router = express.Router();
const transcriptionService = require('../services/transcriptionService');
const llmService = require('../services/llmService');
const brainService = require('../services/brainService');
const actionItemsService = require('../services/actionItemsService');
const memoriesService = require('../services/memoriesService');

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
 * Process a text input for memory and action item extraction
 */
router.post('/process', async (req, res) => {
  try {
    const { text, session_id } = req.body;
    
    if (!text || !session_id) {
      return res.status(400).json({
        success: false,
        message: 'Text and session_id are required'
      });
    }
    
    // Create a transcription record first
    const transcription = await transcriptionService.createTranscription(text, session_id);
    
    // Asynchronously extract memories, action items, and brain entities
    const [memories, actionItems, brainEntitiesResult] = await Promise.all([
      llmService.extractMemories(transcription.text),
      llmService.extractActionItems(transcription.text),
      llmService.analyzeBrainEntities(transcription.text)
    ]);
    
    console.log(`Extracted ${memories.length} memories, ${actionItems.length} action items, and analyzed brain entities.`);
    
    // Process and save the extracted content
    const [savedMemories, savedActionItems, savedBrainEntities] = await Promise.all([
      memoriesService.processMemories(memories, session_id, transcription.id),
      actionItemsService.processActionItems(actionItems),
      brainService.processEntities(brainEntitiesResult)
    ]);

    console.log(`Saved ${savedMemories.length} memories, ${savedActionItems.length} action items, and ${savedBrainEntities.length} brain entities.`);
    
    res.json({
      success: true,
      transcription,
      memories: savedMemories,
      actionItems: savedActionItems,
      brain: savedBrainEntities
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