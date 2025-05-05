/**
 * Service to handle Deepgram transcription
 */
const WebSocket = require('ws');
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env file in the root directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Get API key from environment
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

// Check if API key is available
if (!DEEPGRAM_API_KEY) {
  console.error("ERROR: Deepgram API key not found in environment variables.");
  console.error("Please add DEEPGRAM_API_KEY to your .env file.");
}

// Active WebSocket connections for different sessions
const activeConnections = new Map();

// Connection status tracking
const connectionStatus = new Map();

// Connection health check interval (15 seconds)
const HEALTH_CHECK_INTERVAL = 15000;

// Max reconnection attempts
const MAX_RECONNECT_ATTEMPTS = 3;

// Connection monitoring
let healthCheckInterval = null;

/**
 * Process audio data through Deepgram
 * @param {Buffer} audioData - PCM audio data
 * @param {string} sessionId - Session ID to track this conversation
 */
async function processAudio(audioData, sessionId) {
  try {
    // Validate API key before attempting connection
    if (!DEEPGRAM_API_KEY) {
      throw new Error("Deepgram API key not configured");
    }

    // Decode base64 string if it's encoded
    let decodedAudio;
    try {
      if (typeof audioData === 'string') {
        decodedAudio = Buffer.from(audioData, 'base64');
      } else {
        decodedAudio = audioData;
      }
    } catch (e) {
      console.error('Error decoding audio data:', e);
      throw new Error('Invalid audio data format');
    }
    
    // Get or create WebSocket connection
    let wsConnection = activeConnections.get(sessionId);
    let status = connectionStatus.get(sessionId);
    
    // Check if we need to establish a new connection
    if (!wsConnection || !status || status.readyState !== WebSocket.OPEN) {
      try {
        // Create a new WebSocket connection
        wsConnection = await createDeepgramConnection(sessionId);
        
        // Update connection maps
        activeConnections.set(sessionId, wsConnection);
        connectionStatus.set(sessionId, { 
          readyState: WebSocket.OPEN, 
          reconnectAttempts: 0,
          lastActive: Date.now()
        });
        
        // Start health check if not already running
        startHealthCheck();
      } catch (error) {
        console.error(`Failed to create Deepgram connection: ${error}`);
        throw error;
      }
    }
    
    // Update last active timestamp
    if (status) {
      status.lastActive = Date.now();
      connectionStatus.set(sessionId, status);
    }
    
    // Send audio data to Deepgram
    try {
      wsConnection.send(decodedAudio);
    } catch (sendError) {
      console.error(`Error sending data to Deepgram: ${sendError}`);
      
      // Handle broken connection
      if (sendError.message.includes('not open') || 
          sendError.message.includes('CLOSED')) {
        
        // Close and recreate the connection
        await handleConnectionFailure(sessionId);
        
        // Retry sending the audio data if we successfully reconnected
        const newWs = activeConnections.get(sessionId);
        if (newWs) {
          newWs.send(decodedAudio);
        }
      } else {
        throw sendError;
      }
    }
  } catch (error) {
    console.error('Error processing audio:', error);
    throw error;
  }
}

/**
 * Handle WebSocket connection failure
 * @param {string} sessionId - Session ID for this connection
 */
async function handleConnectionFailure(sessionId) {
  console.log(`Handling connection failure for session ${sessionId}`);
  
  // Get current status
  let status = connectionStatus.get(sessionId);
  if (!status) {
    status = { readyState: WebSocket.CLOSED, reconnectAttempts: 0, lastActive: Date.now() };
  }
  
  // Close existing connection if it exists
  const existingWs = activeConnections.get(sessionId);
  if (existingWs) {
    try {
      existingWs.terminate();
    } catch (e) {
      console.error(`Error terminating WebSocket for session ${sessionId}:`, e);
    }
  }
  
  // Increment reconnect attempts
  status.reconnectAttempts += 1;
  status.readyState = WebSocket.CLOSED;
  connectionStatus.set(sessionId, status);
  
  // Check if we've exceeded max attempts
  if (status.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    console.error(`Exceeded maximum reconnection attempts for session ${sessionId}`);
    activeConnections.delete(sessionId);
    connectionStatus.delete(sessionId);
    return;
  }
  
  // Attempt to reconnect
  try {
    console.log(`Attempting to reconnect Deepgram for session ${sessionId} (Attempt ${status.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    const newWs = await createDeepgramConnection(sessionId);
    
    // Update connection status
    activeConnections.set(sessionId, newWs);
    status.readyState = WebSocket.OPEN;
    status.lastActive = Date.now();
    connectionStatus.set(sessionId, status);
    
    console.log(`Successfully reconnected Deepgram for session ${sessionId}`);
  } catch (error) {
    console.error(`Failed to reconnect Deepgram for session ${sessionId}:`, error);
  }
}

/**
 * Create a WebSocket connection to Deepgram
 * @param {string} sessionId - Session ID for this connection
 * @returns {WebSocket} - WebSocket connection object
 */
function createDeepgramConnection(sessionId) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`Creating Deepgram connection for session ${sessionId}`);
      
      const url = "wss://api.deepgram.com/v1/listen?punctuate=true&model=nova-3&language=multi&encoding=linear16&sample_rate=16000&channels=1";
      
      const ws = new WebSocket(url, {
        headers: {
          "Authorization": `Token ${DEEPGRAM_API_KEY}`
        }
      });
      
      // Set timeout for connection establishment
      const connectionTimeout = setTimeout(() => {
        ws.terminate();
        reject(new Error("Connection timeout"));
      }, 10000);

      ws.on('open', () => {
        // Clear connection timeout
        clearTimeout(connectionTimeout);
        console.log(`Deepgram WebSocket connection opened for session ${sessionId}`);
        resolve(ws);
      });

      ws.on('message', async (msg) => {
        try {
          const response = JSON.parse(msg);
          
          if ("error" in response) {
            console.error(`Deepgram Error: ${response.error}`);
            return;
          }
          
          // Extract transcript from the response
          if ("channel" in response && "alternatives" in response.channel) {
            const transcript = response.channel.alternatives[0].transcript || "";
            
            if (transcript && transcript.trim()) {
              const cleanTranscript = transcript.trim();
              console.log(`\nTranscript for session ${sessionId}:`, cleanTranscript);
              
              // Send the transcribed text to our stream endpoint to be processed
              await sendTranscriptToStream(cleanTranscript, sessionId);
              
              // Update last active timestamp
              const status = connectionStatus.get(sessionId);
              if (status) {
                status.lastActive = Date.now();
                connectionStatus.set(sessionId, status);
              }
            }
          }
        } catch (error) {
          console.error(`Error processing Deepgram message: ${error}`);
        }
      });

      ws.on('error', async (error) => {
        console.error(`Deepgram WebSocket error for session ${sessionId}:`, error);
        
        // Clear connection timeout if still pending
        clearTimeout(connectionTimeout);
        
        // Handle connection error
        if (activeConnections.get(sessionId) === ws) {
          await handleConnectionFailure(sessionId);
        }
        
        reject(error);
      });

      ws.on('close', async (code, reason) => {
        console.log(`Deepgram WebSocket closed for session ${sessionId} with code ${code}. Reason: ${reason || 'No reason provided'}`);
        
        // Clear connection timeout if still pending
        clearTimeout(connectionTimeout);
        
        // Handle connection closure
        if (activeConnections.get(sessionId) === ws) {
          await handleConnectionFailure(sessionId);
        }
      });
    } catch (error) {
      console.error(`Error creating Deepgram connection: ${error}`);
      reject(error);
    }
  });
}

/**
 * Send transcript to the stream endpoint
 * @param {string} text - Transcribed text
 * @param {string} sessionId - Session ID
 */
async function sendTranscriptToStream(text, sessionId) {
  try {
    // Use localhost or the server's own address with connection timeout
    await axios.post('http://localhost:3000/stream', {
      text,
      sessionId
    }, {
      timeout: 5000 // 5 second timeout
    });
    console.log(`Sent transcript to stream endpoint: ${text.substring(0, 30)}...`);
  } catch (error) {
    console.error('Error sending transcript to stream endpoint:', error);
  }
}

/**
 * Start periodic health check for WebSocket connections
 */
function startHealthCheck() {
  if (healthCheckInterval) {
    return; // Health check already running
  }
  
  healthCheckInterval = setInterval(() => {
    const now = Date.now();
    
    // Check each active connection
    for (const [sessionId, status] of connectionStatus.entries()) {
      // Skip if no status
      if (!status) continue;
      
      // Check if connection is stale (inactive for 5 minutes)
      const inactiveTime = now - status.lastActive;
      if (inactiveTime > 5 * 60 * 1000) {
        console.log(`Closing stale connection for session ${sessionId} (inactive for ${Math.round(inactiveTime/1000)}s)`);
        
        // Close and remove the connection
        const ws = activeConnections.get(sessionId);
        if (ws) {
          try {
            ws.terminate();
          } catch (e) {
            // Ignore errors when closing already closed connection
          }
        }
        
        activeConnections.delete(sessionId);
        connectionStatus.delete(sessionId);
        continue;
      }
      
      // Check if connection is not open but hasn't been properly handled
      if (status.readyState !== WebSocket.OPEN) {
        handleConnectionFailure(sessionId).catch(err => {
          console.error(`Health check error for session ${sessionId}:`, err);
        });
      }
    }
    
    // If no active connections, stop health check
    if (activeConnections.size === 0) {
      clearInterval(healthCheckInterval);
      healthCheckInterval = null;
      console.log('No active connections, stopping health check');
    }
  }, HEALTH_CHECK_INTERVAL);
  
  console.log('Started WebSocket connection health check');
}

/**
 * Clean up connections for a specific session
 * @param {string} sessionId - Session ID
 */
function cleanupSession(sessionId) {
  const ws = activeConnections.get(sessionId);
  if (ws) {
    try {
      ws.terminate();
    } catch (e) {
      // Ignore errors when closing
    }
    
    activeConnections.delete(sessionId);
    connectionStatus.delete(sessionId);
    console.log(`Cleaned up connection for session ${sessionId}`);
  }
}

module.exports = {
  processAudio,
  cleanupSession
}; 