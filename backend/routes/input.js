const express = require('express');
const router = express.Router();

// Import services
const llmService = require('../services/llmService');
const brainService = require('../services/brainService');
const actionItemsService = require('../services/actionItemsService');
const memoriesService = require('../services/memoriesService');

/**
 * Process text input with LLM and save extracted information
 */
router.post('/process', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text || text.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Text input is required'
      });
    }
    
    console.log('Processing text input...');
    
    // Use LLM to analyze the text
    const analysisResult = await llmService.analyzeText(text);
    
    let savedActionItems = [];
    let savedMemories = [];
    
    // Process action items from both direct LLM extraction or separate extraction
    if (analysisResult.actionItems && Array.isArray(analysisResult.actionItems) && analysisResult.actionItems.length > 0) {
      // Use action items directly from main analysis
      console.log('Using action items directly from LLM analysis');
      savedActionItems = await actionItemsService.processActionItems(analysisResult.actionItems);
    } else {
      // Extract and process action items separately if not included
      console.log('Extracting action items separately');
      const actionItems = await llmService.extractActionItems(text);
      savedActionItems = await actionItemsService.processActionItems(actionItems);
    }
    
    // Process memories from both direct LLM extraction or separate extraction
    if (analysisResult.memories && Array.isArray(analysisResult.memories) && analysisResult.memories.length > 0) {
      // Use memories directly from main analysis
      console.log('Using memories directly from LLM analysis');
      savedMemories = await memoriesService.processMemories(analysisResult.memories);
    } else {
      // Extract and process memories separately if not included
      console.log('Extracting memories separately');
      const memories = await llmService.extractMemories(text);
      savedMemories = await memoriesService.processMemories(memories);
    }
    
    // Process brain entities (people, locations, events)
    const brainEntities = await brainService.processEntities(analysisResult);
    
    console.log(`Processed: ${savedActionItems.length} action items, ${savedMemories.length} memories, ${brainEntities.people.length + brainEntities.locations.length + brainEntities.events.length} brain entities, ${brainEntities.relationships.length} relationships`);
    
    // Return the processed results
    res.json({
      success: true,
      results: {
        brain: brainEntities,
        actionItems: savedActionItems,
        memories: savedMemories
      }
    });
    
  } catch (error) {
    console.error('Error processing input:', error);
    console.error(error.stack);
    
    // Return a graceful error response
    res.status(500).json({
      success: false,
      message: 'Error processing input',
      error: error.message
    });
  }
});

/**
 * API endpoint to get a summary of all extracted data for dashboard
 */
router.get('/summary', async (req, res) => {
  try {
    // Get counts of different data types
    const people = await brainService.getBrainNodesByType('person');
    const locations = await brainService.getBrainNodesByType('location');
    const events = await brainService.getBrainNodesByType('event');
    const activities = await brainService.getCurrentActivities();
    
    // Get action items
    const pendingActionItems = await actionItemsService.getActionItems({
      status: 'pending',
      sortBy: 'priority',
      sortOrder: 'DESC'
    });
    
    // Get top memories
    const importantMemories = await memoriesService.getMemories({
      importance: 3, // Only importance >= 3
      sortBy: 'importance',
      sortOrder: 'DESC'
    });
    
    // Return summary data
    res.json({
      success: true,
      summary: {
        counts: {
          people: people.length,
          locations: locations.length,
          events: events.length,
          currentActivities: activities.length,
          pendingActionItems: pendingActionItems.length,
          importantMemories: importantMemories.length
        },
        brainData: {
          recentPeople: people.slice(0, 5),
          recentLocations: locations.slice(0, 5),
          recentEvents: events.slice(0, 5),
          currentActivities: activities
        },
        topActionItems: pendingActionItems.slice(0, 5),
        topMemories: importantMemories.slice(0, 5)
      }
    });
    
  } catch (error) {
    console.error('Error getting summary:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting summary',
      error: error.message
    });
  }
});

/**
 * API endpoint to get current activities
 */
router.get('/current-activities', async (req, res) => {
  try {
    const activities = await brainService.getCurrentActivities();
    
    // Return current activities data
    res.json({
      success: true,
      activities: activities
    });
    
  } catch (error) {
    console.error('Error getting current activities:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting current activities',
      error: error.message
    });
  }
});

module.exports = router; 