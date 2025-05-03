const express = require('express');
const router = express.Router();

// Import services
const llmService = require('../services/llmService');
const brainService = require('../services/brainService');
const actionItemsService = require('../services/actionItemsService');
const memoriesService = require('../services/memoriesService');

// Store streaming text buffers by session ID
const streamBuffers = new Map();
// Store timeouts for processing buffers
const streamTimeouts = new Map();

// Define inactivity timeout (5 minutes in milliseconds)
const INACTIVITY_TIMEOUT = 5 * 60 * 1000;

/**
 * Endpoint to stream text fragments that will be processed after inactivity
 */
router.post('/', async (req, res) => {
  try {
    const { text, sessionId } = req.body;
    
    if (!text || text.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Text fragment is required'
      });
    }
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required to maintain streaming context'
      });
    }

    console.log('Received text fragment:', text);
    
    
    // Get or create buffer for this session
    let buffer = streamBuffers.get(sessionId) || '';
    
    // Append text fragment to buffer
    buffer += ' ' + text.trim();
    
    // Update buffer in storage
    streamBuffers.set(sessionId, buffer);
    
    // Clear existing timeout if there is one
    if (streamTimeouts.has(sessionId)) {
      clearTimeout(streamTimeouts.get(sessionId));
    }
    
    // Set timeout to process text after inactivity
    const timeout = setTimeout(async () => {
      try {
        console.log(`Processing text stream for session ${sessionId} after inactivity timeout`);
        
        // Get the complete buffer text
        const fullText = streamBuffers.get(sessionId);
        
        if (fullText && fullText.trim().length > 0) {
          // Process the accumulated text using the existing services
          const analysisResult = await llmService.analyzeText(fullText);
          
          // Process brain entities
          await brainService.processEntities(analysisResult);
          
          // Process action items
          if (analysisResult.actionItems && Array.isArray(analysisResult.actionItems) && analysisResult.actionItems.length > 0) {
            await actionItemsService.processActionItems(analysisResult.actionItems);
          } else {
            const actionItems = await llmService.extractActionItems(fullText);
            await actionItemsService.processActionItems(actionItems);
          }
          
          // Process memories
          if (analysisResult.memories && Array.isArray(analysisResult.memories) && analysisResult.memories.length > 0) {
            await memoriesService.processMemories(analysisResult.memories);
          } else {
            const memories = await llmService.extractMemories(fullText);
            await memoriesService.processMemories(memories);
          }
          
          // Clear the buffer
          streamBuffers.delete(sessionId);
        }
      } catch (error) {
        console.error(`Error processing stream for session ${sessionId}:`, error);
      }
      
      // Remove timeout
      streamTimeouts.delete(sessionId);
    }, INACTIVITY_TIMEOUT);
    
    // Store the timeout
    streamTimeouts.set(sessionId, timeout);
    
    // Return success response
    res.json({
      success: true,
      message: 'Text fragment received',
      bufferedCharacters: buffer.length
    });
    
  } catch (error) {
    console.error('Error streaming text:', error);
    
    // Return a graceful error response
    res.status(500).json({
      success: false,
      message: 'Error processing text stream',
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
      memories = await memoriesService.processMemories(analysisResult.memories);
    } else {
      const extractedMemories = await llmService.extractMemories(fullText);
      memories = await memoriesService.processMemories(extractedMemories);
    }
    
    // Clear the buffer
    streamBuffers.delete(sessionId);
    
    // Return the processed results
    res.json({
      success: true,
      sessionId,
      results: {
        brain: brainEntities,
        actionItems: actionItems,
        memories: memories
      }
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