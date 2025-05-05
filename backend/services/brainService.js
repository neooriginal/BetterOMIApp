const { run, get, all } = require('../models/database');

/**
 * Creates a new brain node
 * @param {string} type - Type of node (person, location, event, etc.)
 * @param {string} name - Name of the node
 * @param {Object} options - Additional options (importance, expiration, data)
 * @returns {Promise<Object>} - The created node
 */
async function createBrainNode(type, name, options = {}) {
  const { importance = 1, expires_at = null, data = null } = options;
  
  try {
    // Check if node already exists to avoid duplication
    const existingNode = await get(
      'SELECT * FROM brain_nodes WHERE type = ? AND name = ?',
      [type, name]
    );
    
    if (existingNode) {
      // Update importance if new importance is higher
      if (importance > existingNode.importance) {
        await run(
          'UPDATE brain_nodes SET importance = ? WHERE id = ?',
          [importance, existingNode.id]
        );
      }
      
      // Update expiration if it's changing from temporary to permanent
      if (!expires_at && existingNode.expires_at) {
        await run(
          'UPDATE brain_nodes SET expires_at = NULL WHERE id = ?',
          [existingNode.id]
        );
      }
      
      // Update data if provided
      if (data) {
        const newData = JSON.stringify(data);
        await run(
          'UPDATE brain_nodes SET data = ? WHERE id = ?',
          [newData, existingNode.id]
        );
      }
      
      return existingNode;
    }
    
    // Create new node if it doesn't exist
    const dataString = data ? JSON.stringify(data) : null;
    const result = await run(
      'INSERT INTO brain_nodes (type, name, importance, expires_at, data) VALUES (?, ?, ?, ?, ?)',
      [type, name, importance, expires_at, dataString]
    );
    
    return {
      id: result.id,
      type,
      name,
      importance,
      expires_at,
      data
    };
  } catch (error) {
    console.error('Error creating brain node:', error);
    throw error;
  }
}

/**
 * Creates a relationship between two nodes
 * @param {number} fromNodeId - ID of the source node
 * @param {number} toNodeId - ID of the target node
 * @param {string} relationshipType - Type of relationship
 * @returns {Promise<Object>} - The created relationship
 */
async function createRelationship(fromNodeId, toNodeId, relationshipType) {
  try {
    // Check if the relationship already exists
    const existingRelationship = await get(
      'SELECT * FROM relationships WHERE from_node_id = ? AND to_node_id = ? AND relationship_type = ?',
      [fromNodeId, toNodeId, relationshipType]
    );
    
    if (existingRelationship) {
      return existingRelationship;
    }
    
    // Create new relationship
    const result = await run(
      'INSERT INTO relationships (from_node_id, to_node_id, relationship_type) VALUES (?, ?, ?)',
      [fromNodeId, toNodeId, relationshipType]
    );
    
    return {
      id: result.id,
      from_node_id: fromNodeId,
      to_node_id: toNodeId,
      relationship_type: relationshipType
    };
  } catch (error) {
    console.error('Error creating relationship:', error);
    throw error;
  }
}

/**
 * Calculate expiration date based on days or specific date
 * @param {number|string} expiryInfo - Number of days from now or specific date string (YYYY-MM-DD)
 * @returns {string|null} - ISO date string or null if permanent
 */
function calculateExpirationDate(expiryInfo) {
  // If null, undefined, or falsy, return null (permanent)
  if (!expiryInfo) {
    return null;
  }

  try {
    // Check if it's a date string (YYYY-MM-DD format)
    if (typeof expiryInfo === 'string' && expiryInfo.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // Parse the specific date
      const date = new Date(expiryInfo);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
    
    // Otherwise treat as number of days (supports fractional days for hours)
    const days = parseFloat(expiryInfo);
    if (!isNaN(days)) {
      const date = new Date();
      // Calculate hours for fractional days
      const hours = days * 24;
      // Add the specified number of hours
      date.setTime(date.getTime() + (hours * 60 * 60 * 1000));
      return date.toISOString();
    }
    
    // Default to 30 days if unable to parse
    console.warn(`Unable to parse expiration info: ${expiryInfo}, defaulting to 30 days`);
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 30);
    return defaultDate.toISOString();
  } catch (e) {
    console.error('Error calculating expiration date:', e);
    // Default to 30 days if there's an error
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString();
  }
}

/**
 * Process extracted entities from analyzed text
 * @param {Object} analysisResult - Result from LLM analysis
 * @returns {Promise<Object>} - Created nodes and relationships
 */
async function processEntities(analysisResult) {
  const results = {
    people: [],
    locations: [],
    events: [],
    relationships: []
  };
  
  try {
    console.log('Processing entities from LLM analysis...');
    
    // Process people
    if (analysisResult.people && Array.isArray(analysisResult.people)) {
      console.log(`Processing ${analysisResult.people.length} people`);
      
      for (const person of analysisResult.people) {
        // Determine expiration date - check specific date first, then days, or null if permanent
        let expiresAt = null;
        if (person.temporary) {
          if (person.expirationDate) {
            expiresAt = calculateExpirationDate(person.expirationDate);
          } else if (person.expirationDays) {
            expiresAt = calculateExpirationDate(person.expirationDays);
          } else {
            // Default to 30 days if temporary but no specific expiration
            expiresAt = calculateExpirationDate(30);
          }
        }
        
        console.log(`Creating person: ${person.name} (${person.temporary ? 'Temporary' : 'Permanent'}${expiresAt ? ', expires: ' + expiresAt.split('T')[0] : ''})`);
        
        const personNode = await createBrainNode('person', person.name, {
          importance: person.importance || 1,
          expires_at: expiresAt,
          data: { role: person.role }
        });
        
        results.people.push(personNode);
      }
    } else {
      console.log('No people found in analysis result');
    }
    
    // Process locations
    if (analysisResult.locations && Array.isArray(analysisResult.locations)) {
      console.log(`Processing ${analysisResult.locations.length} locations`);
      
      for (const location of analysisResult.locations) {
        // Determine expiration date - check specific date first, then days, or null if permanent
        let expiresAt = null;
        if (location.temporary) {
          if (location.expirationDate) {
            expiresAt = calculateExpirationDate(location.expirationDate);
          } else if (location.expirationDays) {
            expiresAt = calculateExpirationDate(location.expirationDays);
          } else {
            // Default to 30 days if temporary but no specific expiration
            expiresAt = calculateExpirationDate(30);
          }
        }
        
        console.log(`Creating location: ${location.name} (${location.temporary ? 'Temporary' : 'Permanent'}${expiresAt ? ', expires: ' + expiresAt.split('T')[0] : ''})`);
        
        const locationNode = await createBrainNode('location', location.name, {
          importance: location.importance || 1,
          expires_at: expiresAt,
          data: location.details
        });
        
        results.locations.push(locationNode);
      }
    } else {
      console.log('No locations found in analysis result');
    }
    
    // Process events
    if (analysisResult.events && Array.isArray(analysisResult.events)) {
      console.log(`Processing ${analysisResult.events.length} events`);
      
      for (const event of analysisResult.events) {
        // Determine expiration date - check specific date first, then days, or null if permanent
        let expiresAt = null;
        if (event.temporary) {
          if (event.expirationDate) {
            expiresAt = calculateExpirationDate(event.expirationDate);
          } else if (event.expirationDays) {
            expiresAt = calculateExpirationDate(event.expirationDays);
          } else {
            // For activity type events, default to 0.25 days (6 hours) if no expiration specified
            if (event.type === 'activity') {
              expiresAt = calculateExpirationDate(0.25); // 6 hours
            } else {
              // Default to 30 days for regular events if temporary but no specific expiration
              expiresAt = calculateExpirationDate(30);
            }
          }
        }
        
        // Determine event type and add appropriate logging
        const eventType = event.type === 'activity' ? 'activity' : 'event';
        console.log(`Creating ${eventType}: ${event.name} (${event.temporary ? 'Temporary' : 'Permanent'}${expiresAt ? ', expires: ' + expiresAt.split('T')[0] + ' ' + new Date(expiresAt).toLocaleTimeString() : ''})`);
        
        const eventNode = await createBrainNode(eventType, event.name, {
          importance: event.importance || 1,
          expires_at: expiresAt,
          data: {
            description: event.description,
            date: event.date,
            people: event.people,
            location: event.location,
            type: event.type || 'regular'
          }
        });
        
        results.events.push(eventNode);
        
        // Create relationships between event and mentioned people
        if (event.people && Array.isArray(event.people)) {
          for (const personName of event.people) {
            // Find the person node
            const personNode = results.people.find(p => p.name === personName);
            if (personNode) {
              // Create relationship
              const relationshipType = event.type === 'activity' ? 'is_doing' : 'participated_in';
              const relationship = await createRelationship(personNode.id, eventNode.id, relationshipType);
              results.relationships.push(relationship);
            }
          }
        }
        
        // Create relationship between event and location
        if (event.location) {
          const locationNode = results.locations.find(l => l.name === event.location);
          if (locationNode) {
            const relationship = await createRelationship(eventNode.id, locationNode.id, 'located_at');
            results.relationships.push(relationship);
          }
        }
      }
    } else {
      console.log('No events found in analysis result');
    }
    
    // Process explicit relationships
    if (analysisResult.relationships && Array.isArray(analysisResult.relationships)) {
      console.log(`Processing ${analysisResult.relationships.length} explicit relationships`);
      
      for (const rel of analysisResult.relationships) {
        // Find the "from" entity node
        let fromNode = null;
        results.people.forEach(person => {
          if (person.name === rel.from) fromNode = person;
        });
        if (!fromNode) {
          results.locations.forEach(location => {
            if (location.name === rel.from) fromNode = location;
          });
        }
        if (!fromNode) {
          results.events.forEach(event => {
            if (event.name === rel.from) fromNode = event;
          });
        }
        
        // Find the "to" entity node
        let toNode = null;
        results.people.forEach(person => {
          if (person.name === rel.to) toNode = person;
        });
        if (!toNode) {
          results.locations.forEach(location => {
            if (location.name === rel.to) toNode = location;
          });
        }
        if (!toNode) {
          results.events.forEach(event => {
            if (event.name === rel.to) toNode = event;
          });
        }
        
        // Create the relationship if both nodes were found
        if (fromNode && toNode) {
          console.log(`Creating relationship: ${fromNode.name} -[${rel.type}]-> ${toNode.name}`);
          const relationship = await createRelationship(fromNode.id, toNode.id, rel.type);
          results.relationships.push(relationship);
        } else {
          console.log(`Could not create relationship: ${rel.from} -[${rel.type}]-> ${rel.to} (nodes not found)`);
        }
      }
    } else {
      console.log('No explicit relationships found in analysis result');
    }
    
    console.log(`Created ${results.people.length} people, ${results.locations.length} locations, ${results.events.length} events, ${results.relationships.length} relationships`);
    return results;
  } catch (error) {
    console.error('Error processing entities:', error);
    console.error(error.stack);
    return results; // Return the results we have so far instead of failing completely
  }
}

/**
 * Get all brain nodes of a specific type
 * @param {string} type - Type of nodes to retrieve
 * @returns {Promise<Array>} - Array of nodes
 */
async function getBrainNodesByType(type) {
  try {
    // Add filtering for non-expired nodes
    const currentDate = new Date().toISOString();
    const nodes = await all(
      'SELECT * FROM brain_nodes WHERE type = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC',
      [type, currentDate]
    );
    
    return nodes.map(node => ({
      ...node,
      data: node.data ? JSON.parse(node.data) : null
    }));
  } catch (error) {
    console.error(`Error getting brain nodes of type ${type}:`, error);
    throw error;
  }
}

/**
 * Get current activities (nodes of type 'activity')
 * @returns {Promise<Array>} - Array of activity nodes
 */
async function getCurrentActivities() {
  try {
    // Get activities that haven't expired yet
    const currentDate = new Date().toISOString();
    const nodes = await all(
      'SELECT * FROM brain_nodes WHERE type = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC',
      ['activity', currentDate]
    );
    
    return nodes.map(node => ({
      ...node,
      data: node.data ? JSON.parse(node.data) : null
    }));
  } catch (error) {
    console.error('Error getting current activities:', error);
    throw error;
  }
}

/**
 * Get a brain node by ID
 * @param {number} id - ID of the node to retrieve
 * @returns {Promise<Object>} - The node
 */
async function getBrainNodeById(id) {
  try {
    const node = await get('SELECT * FROM brain_nodes WHERE id = ?', [id]);
    
    if (!node) {
      return null;
    }
    
    return {
      ...node,
      data: node.data ? JSON.parse(node.data) : null
    };
  } catch (error) {
    console.error(`Error getting brain node with ID ${id}:`, error);
    throw error;
  }
}

/**
 * Search brain nodes by name or content
 * @param {string} searchTerm - Term to search for
 * @returns {Promise<Array>} - Array of matching nodes
 */
async function searchBrainNodes(searchTerm) {
  try {
    // Add filtering for non-expired nodes
    const currentDate = new Date().toISOString();
    const searchPattern = `%${searchTerm}%`;
    
    // Search in node name
    const nameResults = await all(
      'SELECT * FROM brain_nodes WHERE name LIKE ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY type, created_at DESC LIMIT 50',
      [searchPattern, currentDate]
    );
    
    // Search in node data (requires handling different types of data)
    const dataResults = await all(
      'SELECT * FROM brain_nodes WHERE data LIKE ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY type, created_at DESC LIMIT 50',
      [searchPattern, currentDate]
    );
    
    // Combine results and remove duplicates
    const combinedResults = [...nameResults];
    
    for (const dataNode of dataResults) {
      if (!combinedResults.some(node => node.id === dataNode.id)) {
        combinedResults.push(dataNode);
      }
    }
    
    // Parse data for each node
    return combinedResults.map(node => ({
      ...node,
      data: node.data ? JSON.parse(node.data) : null
    }));
  } catch (error) {
    console.error(`Error searching brain nodes for "${searchTerm}":`, error);
    throw error;
  }
}

module.exports = {
  createBrainNode,
  createRelationship,
  calculateExpirationDate,
  processEntities,
  getBrainNodesByType,
  getBrainNodeById,
  searchBrainNodes,
  getCurrentActivities
}; 