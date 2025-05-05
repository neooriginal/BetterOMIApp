/**
 * Service to handle Deepgram transcription
 */
const WebSocket = require('ws');
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');
const transcriptionService = require('./transcriptionService');

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

// Transcription buffers for combining fragments
const transcriptionBuffers = new Map();

// Transcription timeouts for processing after inactivity
const transcriptionTimeouts = new Map();

// Keep-alive intervals for each connection
const keepAliveIntervals = new Map();

// Auto-close timeouts for inactive connections
const autoCloseTimeouts = new Map();

// Inactivity threshold in milliseconds (20 seconds)
const TRANSCRIPTION_INACTIVITY_THRESHOLD = 20000;

// Connection health check interval (15 seconds)
const HEALTH_CHECK_INTERVAL = 15000;

// Keep-alive ping interval (15 seconds)
const KEEP_ALIVE_INTERVAL = 15000;

// Auto-close timeout (30 seconds of audio inactivity)
const AUTO_CLOSE_TIMEOUT = 30000;

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
        
        // Setup keep-alive for this connection
        setupKeepAlive(sessionId, wsConnection);
        
        // Setup auto-close timeout for this connection
        resetAutoCloseTimeout(sessionId);
        
        // Start health check if not already running
        startHealthCheck();
      } catch (error) {
        console.error(`Failed to create Deepgram connection: ${error}`);
        throw error;
      }
    }
    
    // Update last active timestamp and reset autoclose timer
    if (status) {
      status.lastActive = Date.now();
      connectionStatus.set(sessionId, status);
      resetAutoCloseTimeout(sessionId);
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
 * Set up keep-alive mechanism for a WebSocket connection
 * @param {string} sessionId - Session ID
 * @param {WebSocket} ws - WebSocket connection
 */
function setupKeepAlive(sessionId, ws) {
  // Clear any existing interval
  if (keepAliveIntervals.has(sessionId)) {
    clearInterval(keepAliveIntervals.get(sessionId));
  }
  
  // Set up a new keep-alive interval
  const interval = setInterval(() => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        // Send a keep-alive ping to prevent Deepgram from closing the connection
        ws.ping();
        console.log(`Sent keep-alive ping for session ${sessionId}`);
      } else {
        // WebSocket is not open, clear interval
        clearInterval(interval);
        keepAliveIntervals.delete(sessionId);
      }
    } catch (err) {
      console.error(`Error sending keep-alive ping for session ${sessionId}:`, err);
      clearInterval(interval);
      keepAliveIntervals.delete(sessionId);
    }
  }, KEEP_ALIVE_INTERVAL);
  
  keepAliveIntervals.set(sessionId, interval);
}

/**
 * Reset auto-close timeout for an inactive connection
 * @param {string} sessionId - Session ID
 */
function resetAutoCloseTimeout(sessionId) {
  // Clear any existing timeout
  if (autoCloseTimeouts.has(sessionId)) {
    clearTimeout(autoCloseTimeouts.get(sessionId));
  }
  
  // Set a new timeout to close the connection after inactivity
  const timeout = setTimeout(() => {
    console.log(`Auto-closing inactive connection for session ${sessionId} after ${AUTO_CLOSE_TIMEOUT/1000}s of audio inactivity`);
    
    // Process any buffered transcription
    if (transcriptionBuffers.has(sessionId)) {
      processBufferedTranscription(sessionId);
    }
    
    // Close the connection gracefully
    closeConnection(sessionId);
  }, AUTO_CLOSE_TIMEOUT);
  
  autoCloseTimeouts.set(sessionId, timeout);
}

/**
 * Close a WebSocket connection gracefully
 * @param {string} sessionId - Session ID
 */
function closeConnection(sessionId) {
  // Clean up keep-alive interval
  if (keepAliveIntervals.has(sessionId)) {
    clearInterval(keepAliveIntervals.get(sessionId));
    keepAliveIntervals.delete(sessionId);
  }
  
  // Clean up auto-close timeout
  if (autoCloseTimeouts.has(sessionId)) {
    clearTimeout(autoCloseTimeouts.get(sessionId));
    autoCloseTimeouts.delete(sessionId);
  }
  
  // Get the WebSocket
  const ws = activeConnections.get(sessionId);
  if (ws) {
    try {
      // Send close frame to Deepgram
      if (ws.readyState === WebSocket.OPEN) {
        console.log(`Sending close frame for session ${sessionId}`);
        ws.close(1000, "Closing due to inactivity");
      } else {
        // Force terminate if not in OPEN state
        ws.terminate();
      }
    } catch (e) {
      console.error(`Error closing WebSocket for session ${sessionId}:`, e);
    }
    
    // Remove from maps
    activeConnections.delete(sessionId);
    connectionStatus.delete(sessionId);
    console.log(`Closed connection for session ${sessionId}`);
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
      // Clean up the connection
      if (keepAliveIntervals.has(sessionId)) {
        clearInterval(keepAliveIntervals.get(sessionId));
        keepAliveIntervals.delete(sessionId);
      }
      
      if (autoCloseTimeouts.has(sessionId)) {
        clearTimeout(autoCloseTimeouts.get(sessionId));
        autoCloseTimeouts.delete(sessionId);
      }
      
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
    
    // Clean up all resources for this session
    activeConnections.delete(sessionId);
    connectionStatus.delete(sessionId);
    
    if (keepAliveIntervals.has(sessionId)) {
      clearInterval(keepAliveIntervals.get(sessionId));
      keepAliveIntervals.delete(sessionId);
    }
    
    if (autoCloseTimeouts.has(sessionId)) {
      clearTimeout(autoCloseTimeouts.get(sessionId));
      autoCloseTimeouts.delete(sessionId);
    }
    
    // Process any remaining buffered transcription
    if (transcriptionBuffers.has(sessionId)) {
      await processBufferedTranscription(sessionId);
    }
    
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
    
    // Setup keep-alive for new connection
    setupKeepAlive(sessionId, newWs);
    
    // Reset auto-close timeout
    resetAutoCloseTimeout(sessionId);
    
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
      
      // Enhanced configuration for better accuracy
      // - higher endpointing threshold to reduce word splitting
      // - utterances for sentence grouping
      // - model=nova-3 for best accuracy
      // - endpointing=500 to wait longer for continuation
      // - interim_results=true to get continuous results
      const url = "wss://api.deepgram.com/v1/listen?punctuate=true&model=nova-3&language=multi&encoding=linear16&sample_rate=16000&channels=1&endpointing=500&utterances=true&interim_results=true";
      
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
            const is_final = response.is_final || false;
            
            if (transcript && transcript.trim()) {
              const cleanTranscript = transcript.trim();
              console.log(`\nTranscript for session ${sessionId} ${is_final ? '(FINAL)' : '(INTERIM)'}:`, cleanTranscript);
              
              // Only process final transcripts
              if (is_final) {
                // Add to buffer or create new one
                bufferTranscription(cleanTranscript, sessionId);
              }
              
              // Update last active timestamp
              const status = connectionStatus.get(sessionId);
              if (status) {
                status.lastActive = Date.now();
                connectionStatus.set(sessionId, status);
              }
              
              // Reset auto-close timeout since we're receiving data
              resetAutoCloseTimeout(sessionId);
            }
          }
        } catch (error) {
          console.error(`Error processing Deepgram message: ${error}`);
        }
      });
      
      // Handle WebSocket pong messages
      ws.on('pong', () => {
        console.log(`Received pong from Deepgram for session ${sessionId}`);
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
 * Buffer transcription and process after inactivity
 * @param {string} text - Transcribed text
 * @param {string} sessionId - Session ID
 */
function bufferTranscription(text, sessionId) {
  // Get or create buffer for this session
  let buffer = transcriptionBuffers.get(sessionId) || '';
  const isFirstEntry = buffer === '';
  
  // Add a space if the buffer is not empty
  if (!isFirstEntry) {
    buffer += ' ';
  }
  
  // Append text to buffer
  buffer += text;
  
  // Update buffer
  transcriptionBuffers.set(sessionId, buffer);
  
  // Clear existing timeout if there is one
  if (transcriptionTimeouts.has(sessionId)) {
    clearTimeout(transcriptionTimeouts.get(sessionId));
  }
  
  // Set timeout to process text after inactivity
  const timeout = setTimeout(() => {
    processBufferedTranscription(sessionId);
  }, TRANSCRIPTION_INACTIVITY_THRESHOLD);
  
  // Store the timeout
  transcriptionTimeouts.set(sessionId, timeout);
  
  console.log(`Buffered transcription for session ${sessionId}, length now: ${buffer.length} chars`);
}

/**
 * Process buffered transcription after inactivity timeout
 * @param {string} sessionId - Session ID
 */
async function processBufferedTranscription(sessionId) {
  try {
    // Get the complete buffer
    const fullText = transcriptionBuffers.get(sessionId);
    
    if (fullText && fullText.trim()) {
      console.log(`Processing buffered transcription for session ${sessionId} after ${TRANSCRIPTION_INACTIVITY_THRESHOLD/1000}s inactivity`);
      console.log(`Full text: "${fullText.substring(0, 100)}${fullText.length > 100 ? '...' : ''}"`);
      
      // Store in database
      await storeTranscription(fullText, sessionId);
      
      // Send to stream endpoint
      await sendTranscriptToStream(fullText, sessionId);
    }
    
    // Clear the buffer
    transcriptionBuffers.delete(sessionId);
    
  } catch (error) {
    console.error(`Error processing buffered transcription for session ${sessionId}:`, error);
  }
  
  // Clear the timeout
  transcriptionTimeouts.delete(sessionId);
}

/**
 * Store transcription in the database
 * @param {string} text - Transcribed text
 * @param {string} sessionId - Session ID
 */
async function storeTranscription(text, sessionId) {
  try {
    await transcriptionService.createTranscription({
      text,
      session_id: sessionId
    });
    console.log(`Stored transcription in database for session ${sessionId}`);
  } catch (error) {
    console.error('Error storing transcription:', error);
  }
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
        
        // Process any remaining buffered transcription
        if (transcriptionBuffers.has(sessionId)) {
          processBufferedTranscription(sessionId);
        }
        
        // Close the connection gracefully
        closeConnection(sessionId);
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
  // Process any remaining buffered transcription
  if (transcriptionBuffers.has(sessionId)) {
    processBufferedTranscription(sessionId);
  }
  
  // Clear any pending transcription timeouts
  if (transcriptionTimeouts.has(sessionId)) {
    clearTimeout(transcriptionTimeouts.get(sessionId));
    transcriptionTimeouts.delete(sessionId);
  }
  
  // Clean up websocket and intervals
  closeConnection(sessionId);
}

module.exports = {
  processAudio,
  cleanupSession
}; 