const express = require('express');
const router = express.Router();
const brainService = require('../services/brainService');

/**
 * Render the brain visualization page
 */
router.get('/', async (req, res) => {
  try {
    res.render('brainVisualization', {
      title: 'Brain Visualization'
    });
  } catch (error) {
    console.error('Error rendering brain visualization:', error);
    res.status(500).send('Error rendering brain visualization');
  }
});

/**
 * Get all brain data for visualization
 */
router.get('/data', async (req, res) => {
  try {
    // Get all brain nodes
    const people = await brainService.getBrainNodesByType('person');
    const locations = await brainService.getBrainNodesByType('location');
    const events = await brainService.getBrainNodesByType('event');
    const activities = await brainService.getCurrentActivities();
    
    // Get all relationships
    const relationships = await getAllRelationships();
    
    // Format data for visualization
    const nodes = [
      ...people.map(p => ({ 
        id: p.id, 
        type: 'person', 
        name: p.name, 
        data: p.data,
        importance: p.importance
      })),
      ...locations.map(l => ({ 
        id: l.id, 
        type: 'location', 
        name: l.name, 
        data: l.data,
        importance: l.importance
      })),
      ...events.map(e => ({ 
        id: e.id, 
        type: 'event', 
        name: e.name, 
        data: e.data,
        importance: e.importance
      })),
      ...activities.map(a => ({ 
        id: a.id, 
        type: 'activity', 
        name: a.name, 
        data: a.data,
        importance: a.importance
      }))
    ];
    
    // Format links for visualization
    const links = relationships.map(r => ({
      source: r.from_node_id,
      target: r.to_node_id,
      type: r.relationship_type
    }));
    
    res.json({
      success: true,
      data: {
        nodes,
        links
      }
    });
    
  } catch (error) {
    console.error('Error getting brain data:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting brain data',
      error: error.message
    });
  }
});

/**
 * Helper function to get all relationships
 */
async function getAllRelationships() {
  try {
    const { all } = require('../models/database');
    return await all('SELECT * FROM relationships');
  } catch (error) {
    console.error('Error getting relationships:', error);
    return [];
  }
}

module.exports = router; 