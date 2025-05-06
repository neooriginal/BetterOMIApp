const express = require('express');
const router = express.Router();

// Import services
const llmService = require('../services/llmService');
const brainService = require('../services/brainService');
const actionItemsService = require('../services/actionItemsService');
const memoriesService = require('../services/memoriesService');
const deepgramService = require('../services/deepgramService');

/**
 * Endpoint to receive audio data from Omi device
 */
router.post('/audio', async (req, res) => {
  try {
    const { audioData, sessionId } = req.body;
    
    if (!audioData) {
      return res.status(400).json({
        success: false,
        message: 'Audio data is required'
      });
    }
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }
    try {
      // Pass audio data to Deepgram service for transcription
      await deepgramService.processAudio(audioData, sessionId);
      
      // Return success response
      res.json({
        success: true,
        message: 'Audio data received and processing'
      });
    } catch (error) {
      console.error('Deepgram service error:', error);
      
      res.status(500).json({
        success: false,
        message: 'Error processing audio with Deepgram',
        error: error.message
      });
    }
    
  } catch (error) {
    console.error('Error processing audio data:', error);
    
    res.status(500).json({
      success: false,
      message: 'Error processing audio data',
      error: error.message
    });
  }
});

/**
 * Endpoint to process text from transcription
 */
router.post('/', async (req, res) => {
  try {
    const { text, sessionId } = req.body;
    
    if (!text || text.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Text is required'
      });
    }
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    console.log(`Received text for session ${sessionId}, length: ${text.length} characters`);
    
    // Process the text using the existing services
    try {
      // Process the text
      const analysisResult = await llmService.analyzeText(text);
      
      // Process brain entities
      await brainService.processEntities(analysisResult);
      
      // Process action items
      if (analysisResult.actionItems && Array.isArray(analysisResult.actionItems) && analysisResult.actionItems.length > 0) {
        await actionItemsService.processActionItems(analysisResult.actionItems);
      } else {
        const actionItems = await llmService.extractActionItems(text);
        await actionItemsService.processActionItems(actionItems);
      }
      
      // Process memories
      if (analysisResult.memories && Array.isArray(analysisResult.memories) && analysisResult.memories.length > 0) {
        await memoriesService.processMemories(analysisResult.memories, sessionId);
      } else {
        const memories = await llmService.extractMemories(text);
        await memoriesService.processMemories(memories, sessionId);
      }
    } catch (error) {
      console.error('Error processing text:', error);
      // Continue to return success to client even if processing failed
    }
    
    // Return success response
    res.json({
      success: true,
      message: 'Text received and processed'
    });
    
  } catch (error) {
    console.error('Error processing text:', error);
    
    // Return a graceful error response
    res.status(500).json({
      success: false,
      message: 'Error processing text',
      error: error.message
    });
  }
});

/**
 * Endpoint to check stream status and force process
 */
router.get('/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  if (!sessionId) {
    return res.status(400).json({
      success: false,
      message: 'Session ID is required'
    });
  }
  
  const buffer = streamBuffers.get(sessionId) || '';
  const hasTimeout = streamTimeouts.has(sessionId);
  
  res.json({
    success: true,
    sessionId,
    bufferLength: buffer.length,
    bufferWords: buffer.split(/\s+/).length,
    processingScheduled: hasTimeout,
    remainingTimeMs: hasTimeout ? INACTIVITY_TIMEOUT - (Date.now() - streamTimeouts.get(sessionId)._idleStart) : 0
  });
});

/**
 * Endpoint to force process a stream immediately
 */
router.post('/process-now/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }
    
    // Check if there's text for this session
    if (!streamBuffers.has(sessionId)) {
      return res.status(404).json({
        success: false,
        message: 'No text stream found for this session'
      });
    }
    
    // Clear existing timeout if there is one
    if (streamTimeouts.has(sessionId)) {
      clearTimeout(streamTimeouts.get(sessionId));
      streamTimeouts.delete(sessionId);
    }
    
    // Get the buffer text
    const fullText = streamBuffers.get(sessionId);
    console.log(`Processing full text of ${fullText.length} characters for session ${sessionId} (manual trigger)`);
    
    // Process the text
    const analysisResult = await llmService.analyzeText(fullText);
    
    // Process entities
    const brainEntities = await brainService.processEntities(analysisResult);
    
    // Process action items
    let actionItems = [];
    if (analysisResult.actionItems && Array.isArray(analysisResult.actionItems) && analysisResult.actionItems.length > 0) {
      actionItems = await actionItemsService.processActionItems(analysisResult.actionItems);
    } else {
      const extractedItems = await llmService.extractActionItems(fullText);
      actionItems = await actionItemsService.processActionItems(extractedItems);
    }
    
    // Process memories
    let memories = [];
    if (analysisResult.memories && Array.isArray(analysisResult.memories) && analysisResult.memories.length > 0) {
      memories = await memoriesService.processMemories(analysisResult.memories, sessionId);
    } else {
      const extractedMemories = await llmService.extractMemories(fullText);
      memories = await memoriesService.processMemories(extractedMemories, sessionId);
    }
    
    // Clear the buffer after processing
    streamBuffers.delete(sessionId);
    
    // Return the processed results
    res.json({
      success: true,
      sessionId,
      results: {
        brain: brainEntities,
        actionItems: actionItems,
        memories: memories
      },
      textLength: fullText.length
    });
    
  } catch (error) {
    console.error('Error processing stream immediately:', error);
    
    // Return a graceful error response
    res.status(500).json({
      success: false,
      message: 'Error processing text stream',
      error: error.message
    });
  }
});

/**
 * Endpoint to clear a stream without processing
 */
router.delete('/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  if (!sessionId) {
    return res.status(400).json({
      success: false,
      message: 'Session ID is required'
    });
  }
  
  // Clear timeout if exists
  if (streamTimeouts.has(sessionId)) {
    clearTimeout(streamTimeouts.get(sessionId));
    streamTimeouts.delete(sessionId);
  }
  
  // Clear buffer
  streamBuffers.delete(sessionId);
  
  res.json({
    success: true,
    message: 'Stream cleared successfully'
  });
});

module.exports = router; 