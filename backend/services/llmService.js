const OpenAI = require('openai');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Make sure to set this in .env file
});

/**
 * Analyze text input and extract structured information
 * @param {string} text - The input text to analyze
 * @returns {Promise<Object>} - Structured information extracted from the text
 */
async function analyzeText(text) {
  try {
    console.log('Analyzing text with LLM...');
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // Or another suitable model
      messages: [
        {
          role: "system",
          content: `You are an AI assistant that analyzes text and extracts structured information. 
          Extract the following entities:
          
          1. People mentioned (names, roles)
          2. Locations mentioned
          3. Events mentioned (with dates if available)
          4. Current activities or states (what the person is doing/experiencing right now)
          5. Action items/tasks that need to be done (IMPORTANT: Be thorough in identifying anything that could be considered a task or action)
          6. Relationships between entities (IMPORTANT: Identify how entities are connected to each other)
          
          For each entity, provide:
          - Name (required)
          - Importance score from 1-5 (5 being highest)
          - Whether it should be permanent or temporary (boolean field "temporary")
          - If temporary, suggest an expiration time in days or a specific date (field "expirationDays" or "expirationDate")
          - Additional relevant details specific to the entity type
          
          IMPORTANT: For current activities (what someone is doing right now), ALWAYS:
          - Create a special "activity" event
          - Mark it as temporary with a short expiration time (typically 2-6 hours)
          - Set proper importance based on the nature of the activity
          - Include detailed context to make it useful for recall later
          - Connect it to relevant people, locations, and other entities
          
          Examples of current activities to identify:
          - Eating (what food, where, with whom)
          - Working on specific tasks
          - Meeting with people
          - Traveling or commuting
          - Experiencing specific emotions or states
          - Reading, watching, or consuming content
          - Current location or physical context
          
          IMPORTANT: Carefully decide whether each entity should be permanent or temporary based on its significance:
          - Mark as permanent (temporary = false): key people, important locations, major events that have long-term significance
          - Mark as temporary (temporary = true): minor contacts, transient locations, one-time events with limited relevance
          - ALWAYS mark current activities as temporary with appropriate short-term expiration
          
          For temporary entities, provide a specific expirationDays value:
          - Very short-term (0.1-0.3 days / 2-6 hours): Current activities, immediate contexts, passing states
          - Short-term (1-7 days): Minor details with immediate relevance only
          - Medium-term (30-60 days): Information with extended but not long-term relevance
          - Long-term (90-365 days): More significant information that's relevant for months
          - Or provide a specific date in "YYYY-MM-DD" format in the field "expirationDate"
          
          IMPORTANT: For every person, location, and event, identify any relationships to other entities.
          
          Return your response in the following JSON structure:
          {
            "people": [
              {"name": "Person Name", "role": "Their role", "importance": 1-5, "temporary": true/false, "expirationDays": number, "expirationDate": "YYYY-MM-DD"}
            ],
            "locations": [
              {"name": "Location Name", "details": "Location details", "importance": 1-5, "temporary": true/false, "expirationDays": number, "expirationDate": "YYYY-MM-DD"}
            ],
            "events": [
              {"name": "Event Name", "date": "Event date if known", "description": "Event description", "importance": 1-5, "temporary": true/false, "expirationDays": number, "expirationDate": "YYYY-MM-DD", "people": ["Person1", "Person2"], "location": "Location Name", "type": "regular/activity"}
            ],
            "relationships": [
              {"from": "Entity1 Name", "to": "Entity2 Name", "type": "relationship type", "description": "relationship description", "temporary": true/false, "expirationDays": number, "expirationDate": "YYYY-MM-DD"}
            ],
            "memories": [
              {"title": "Memory Title", "content": "Memory Content", "importance": 1-5, "expiration": number or "permanent"}
            ],
            "actionItems": [
              {"title": "Task Title", "description": "Task Description", "priority": 1-5, "dueDate": "due date if known"}
            ]
          }
          
          Relationship types could include: "knows", "works_with", "reports_to", "located_at", "participated_in", "organized", "is_doing", etc.
          
          Always include at least one entity in each category and identify relationships between entities, even if you have to infer from context. If truly none are mentioned, create a placeholder with "Unknown" as the name.
          
          IMPORTANT: Be EXTREMELY thorough in identifying current activities and states. Any mention of what someone is currently doing should be captured as a temporary event with appropriate short-term expiration.
          `
        },
        {
          role: "user",
          content: text
        }
      ],
      response_format: { type: "json_object" }
    });

    // Parse the response to get structured data
    const result = JSON.parse(response.choices[0].message.content);
    console.log(`Extracted ${result.people?.length || 0} people, ${result.locations?.length || 0} locations, ${result.events?.length || 0} events, ${result.relationships?.length || 0} relationships, ${result.memories?.length || 0} memories, ${result.actionItems?.length || 0} action items`);
    
    // Ensure we have arrays for each entity type
    if (!result.people) result.people = [{ name: "Unknown Person", role: "Unknown", importance: 1, temporary: true, expirationDays: 7 }];
    if (!result.locations) result.locations = [{ name: "Unknown Location", details: "No details", importance: 1, temporary: true, expirationDays: 7 }];
    if (!result.events) result.events = [{ name: "Unknown Event", description: "No description", importance: 1, temporary: true, expirationDays: 7 }];
    if (!result.relationships) result.relationships = [];
    if (!result.memories) result.memories = [];
    if (!result.actionItems) result.actionItems = [];
    
    return result;
  } catch (error) {
    console.error('Error analyzing text with OpenAI:', error);
    // Return a minimal structure to prevent downstream errors
    return {
      people: [{ name: "Error Processing Person", role: "Unknown", importance: 1, temporary: true, expirationDays: 7 }],
      locations: [{ name: "Error Processing Location", details: "Error", importance: 1, temporary: true, expirationDays: 7 }],
      events: [{ name: "Error Processing Event", description: "Error", importance: 1, temporary: true, expirationDays: 7 }],
      relationships: [],
      memories: [],
      actionItems: []
    };
  }
}

/**
 * Extract action items from text
 * @param {string} text - The input text to analyze
 * @returns {Promise<Array>} - List of action items
 */
async function extractActionItems(text) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // Or another suitable model
      messages: [
        {
          role: "system",
          content: `Extract action items and tasks from the following text.
          Be very thorough - identify ANYTHING that could be considered a task, todo, or action that needs to be performed.
          Even implied tasks should be captured.
          
          For each task, provide:
          - Title (concise description of the task)
          - Description (more details if available)
          - Priority (1-5, 5 being highest, base this on apparent urgency/importance)
          - Due date (if mentioned or can be inferred)
          
          Look for phrases like "need to", "should", "have to", deadlines, appointments, or any text implying future action.
          
          Format as JSON with an array called "actionItems".`
        },
        {
          role: "user",
          content: text
        }
      ],
      response_format: { type: "json_object" }
    });

    // Parse the response
    const result = JSON.parse(response.choices[0].message.content);
    return result.actionItems || [];
  } catch (error) {
    console.error('Error extracting action items with OpenAI:', error);
    throw error;
  }
}

/**
 * Determine important memories from text
 * @param {string} text - The input text to analyze
 * @returns {Promise<Array>} - List of important memories
 */
async function extractMemories(text) {
  try {
    console.log('Extracting memories from text...');
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // Or another suitable model
      messages: [
        {
          role: "system",
          content: `You are a specialist in extracting and organizing key information from conversations and text. 
          Your task is to identify important memories that should be saved for future reference.
          
          For each memory, extract the following details:
          - Title: A concise, descriptive title that clearly identifies the memory content
          - Content: The COMPREHENSIVE, DETAILED information - include COMPLETE context, FULL quotes, and ALL specific details
          - Context: Thorough background information that helps understand why this memory is important
          - Participants: All people involved in this conversation or information
          - Key Points: Extensive bullet points of ALL important takeaways (at least 3-5 points per memory)
          - Importance: Rating from 1-5 (5 being highest) based on the significance of this information
          - Expiration: When this memory should expire (in days or "permanent")
          
          CRITICAL INSTRUCTIONS:
          1. NEVER truncate or summarize the "Content" field - preserve FULL details, complete quotes, and ALL specific information
          2. The "Content" field must be COMPREHENSIVE - include EVERYTHING that might be useful later
          3. Create EXTREMELY DETAILED memories with as much information as possible
          4. For conversations, capture EXACTLY who said what, the full exchange, specific wording, and ALL conclusions
          5. Make sure each memory is COMPLETE and STANDALONE - assume the reader has no other context
          6. DO NOT create short/brief memories - each memory should be THOROUGH and EXHAUSTIVE
          7. Always include at least 3-5 detailed key points for each memory
          
          Format your response as a JSON object with a property called "memories" containing an array of memory objects.`
        },
        {
          role: "user",
          content: text
        }
      ],
      response_format: { type: "json_object" }
    });

    // Parse the response
    const result = JSON.parse(response.choices[0].message.content);
    console.log(`Extracted ${result.memories ? result.memories.length : 0} memories from text`);
    if (!result.memories || result.memories.length === 0) {
      console.log('LLM returned no memories, creating a default one');
      // If no memories were returned, create a default memory
      return [{
        title: "Text Information",
        content: text, // No longer truncating the content
        context: "Default memory created from text input",
        participants: ["Unknown"],
        keyPoints: ["Contains the original text input", "Generated as a fallback", "May require manual review"],
        importance: 2,
        expiration: 30
      }];
    }
    return result.memories || [];
  } catch (error) {
    console.error('Error extracting memories with OpenAI:', error);
    // In case of error, create a default memory so we don't return empty
    return [{
      title: "Stored Information",
      content: text, // No longer truncating the content
      context: "Error occurred during memory extraction",
      participants: ["Unknown"],
      keyPoints: ["Contains original text input", "Error occurred during processing", "May need manual review"],
      importance: 1,
      expiration: 14
    }];
  }
}

module.exports = {
  analyzeText,
  extractActionItems,
  extractMemories
}; 