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
const MAX_RECONNECT_ATTEMPTS = 10;

// Connection monitoring
let healthCheckInterval = null;

// Keep track of current speaker for each session
const currentSpeakers = new Map();

// Empty audio data for heartbeat (2 bytes of silence)
const HEARTBEAT_DATA = Buffer.from([0, 0]);

// Heartbeat interval (10 seconds)
const HEARTBEAT_INTERVAL = 10000;

// Heartbeat intervals for each connection
const heartbeatIntervals = new Map();

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
  
  // Set up audio heartbeat to prevent timeouts due to lack of audio data
  setupHeartbeat(sessionId, ws);
}

/**
 * Set up heartbeat mechanism to send minimal audio data
 * to prevent Deepgram from closing the connection due to inactivity
 * @param {string} sessionId - Session ID
 * @param {WebSocket} ws - WebSocket connection
 */
function setupHeartbeat(sessionId, ws) {
  // Clear any existing heartbeat interval
  if (heartbeatIntervals.has(sessionId)) {
    clearInterval(heartbeatIntervals.get(sessionId));
  }
  
  // Get current connection status
  const status = connectionStatus.get(sessionId) || { lastActive: Date.now() };
  
  // Set up a new heartbeat interval
  const interval = setInterval(() => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        // Only send heartbeat if no audio data received recently
        const timeSinceLastActive = Date.now() - status.lastActive;
        
        // If more than half of the AUTO_CLOSE_TIMEOUT has passed without activity,
        // send heartbeat audio data to keep the connection alive
        if (timeSinceLastActive > (AUTO_CLOSE_TIMEOUT / 2)) {
          ws.send(HEARTBEAT_DATA);
          console.log(`Sent audio heartbeat for session ${sessionId}`);
        }
      } else {
        // WebSocket is not open, clear interval
        clearInterval(interval);
        heartbeatIntervals.delete(sessionId);
      }
    } catch (err) {
      console.error(`Error sending audio heartbeat for session ${sessionId}:`, err);
      clearInterval(interval);
      heartbeatIntervals.delete(sessionId);
    }
  }, HEARTBEAT_INTERVAL);
  
  heartbeatIntervals.set(sessionId, interval);
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
  
  // Clean up heartbeat interval
  if (heartbeatIntervals.has(sessionId)) {
    clearInterval(heartbeatIntervals.get(sessionId));
    heartbeatIntervals.delete(sessionId);
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
      
      if (heartbeatIntervals.has(sessionId)) {
        clearInterval(heartbeatIntervals.get(sessionId));
        heartbeatIntervals.delete(sessionId);
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
    
    if (heartbeatIntervals.has(sessionId)) {
      clearInterval(heartbeatIntervals.get(sessionId));
      heartbeatIntervals.delete(sessionId);
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
  
  // Attempt to reconnect with exponential backoff
  const backoffTime = Math.min(1000 * Math.pow(1.5, status.reconnectAttempts - 1), 10000);
  console.log(`Waiting ${backoffTime}ms before reconnect attempt ${status.reconnectAttempts}`);
  
  // Wait before attempting reconnection
  await new Promise(resolve => setTimeout(resolve, backoffTime));
  
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
    
    // Schedule another reconnection attempt
    setTimeout(() => handleConnectionFailure(sessionId), 1000);
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
      
      // Enhanced configuration for better accuracy and reliability
      // - reduced endpointing to 300ms for faster response
      // - interim_results=true to get continuous results
      // - utterances=true for better sentence grouping
      // - keepalive to true to help Deepgram maintain the connection
      const url = "wss://api.deepgram.com/v1/listen?punctuate=true&model=nova-3&language=multi&encoding=linear16&sample_rate=16000&channels=1&endpointing=300&utterances=true&interim_results=true&diarize=true&smart_format=true&keepalive=true";
      
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
            
            // Get speaker information if available
            let speaker = null;
            if (response.channel.alternatives[0].words && response.channel.alternatives[0].words.length > 0) {
              const words = response.channel.alternatives[0].words;
              // Use the speaker from the first word
              if (words[0].speaker !== undefined) {
                speaker = words[0].speaker;
              }
            }
            
            if (transcript && transcript.trim()) {
              const cleanTranscript = transcript.trim();
              console.log(`\nTranscript for session ${sessionId} ${is_final ? '(FINAL)' : '(INTERIM)'} - Speaker ${speaker !== null ? speaker : 'unknown'}:`, cleanTranscript);
              
              // Process both interim and final transcripts for faster response
              // For interim results, we'll use a shorter buffer to get faster feedback
              if (is_final) {
                // For final results, use the normal buffering mechanism
                bufferTranscription(cleanTranscript, sessionId, speaker);
              } else {
                // For interim results, process immediately with a special flag
                processInterimTranscription(cleanTranscript, sessionId, speaker);
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
 * @param {number|null} speaker - Speaker number
 */
function bufferTranscription(text, sessionId, speaker = null) {
  // Get or create buffer for this session
  let buffer = transcriptionBuffers.get(sessionId) || '';
  const isFirstEntry = buffer === '';
  
  // Get current speaker for this session
  const currentSpeaker = currentSpeakers.get(sessionId);
  
  // Check if this is a new speaker
  const isNewSpeaker = (speaker !== null && currentSpeaker !== speaker && !isFirstEntry);
  
  // If new speaker, add a line break
  if (isNewSpeaker) {
    buffer += '\n\n';
  } else if (!isFirstEntry) {
    // Add a space for the same speaker
    buffer += ' ';
  }
  
  // If this is a new speaker and not the first entry, add a speaker prefix
  if (speaker !== null && (isNewSpeaker || isFirstEntry)) {
    buffer += `Speaker ${speaker}: `;
  }
  
  // Append text to buffer
  buffer += text;
  
  // Update buffer
  transcriptionBuffers.set(sessionId, buffer);
  
  // Update current speaker
  if (speaker !== null) {
    currentSpeakers.set(sessionId, speaker);
  }
  
  // Process immediately instead of waiting
  processBufferedTranscription(sessionId);
  
  console.log(`Processed transcription immediately for session ${sessionId}: "${text}"`);
}

/**
 * Process buffered transcription after inactivity
 * @param {string} sessionId - Session ID
 */
async function processBufferedTranscription(sessionId) {
  // Get buffered transcription
  const buffer = transcriptionBuffers.get(sessionId);
  
  // Skip if buffer is empty
  if (!buffer || buffer.trim() === '') {
    return;
  }
  
  console.log(`Processing buffered transcription for session ${sessionId}: "${buffer}"`);
  
  try {
    // Store in database
    await storeTranscription(buffer, sessionId);
    
    // Send to stream processor
    await sendTranscriptToStream(buffer, sessionId);
    
    // Clear buffer
    transcriptionBuffers.delete(sessionId);
    
    console.log(`Successfully processed transcription for session ${sessionId}`);
  } catch (error) {
    console.error(`Error processing transcription for session ${sessionId}:`, error);
  }
}

/**
 * Store transcription in database
 * @param {string} text - Transcription text
 * @param {string} sessionId - Session ID
 */
async function storeTranscription(text, sessionId) {
  try {
    // Create transcription record with 30-day expiration
    const expirationDays = 30;
    const transcription = await transcriptionService.createTranscription(text, sessionId, expirationDays);
    
    console.log(`Saved transcription to database with ID: ${transcription.id}`);
    return transcription;
  } catch (error) {
    console.error('Error storing transcription:', error);
    throw error;
  }
}

/**
 * Process interim transcription immediately without buffering
 * @param {string} text - Transcribed text
 * @param {string} sessionId - Session ID
 * @param {number|null} speaker - Speaker number
 */
async function processInterimTranscription(text, sessionId, speaker = null) {
  try {
    // Format the text with speaker information if available
    let formattedText = text;
    if (speaker !== null) {
      formattedText = `Speaker ${speaker}: ${text}`;
    }
    
    // Send to stream processor immediately
    await sendTranscriptToStream(formattedText, sessionId, true);
    
    console.log(`Processed interim transcription for session ${sessionId}: "${text}"`);
  } catch (error) {
    console.error(`Error processing interim transcription for session ${sessionId}:`, error);
  }
}

/**
 * Send transcript to the stream endpoint
 * @param {string} text - Transcribed text
 * @param {string} sessionId - Session ID
 * @param {boolean} isInterim - Whether this is an interim result
 */
async function sendTranscriptToStream(text, sessionId, isInterim = false) {
  try {
    // Use localhost or the server's own address with connection timeout
    await axios.post('http://localhost:3000/stream', {
      text,
      sessionId,
      isInterim
    }, {
      timeout: 2000 // Reduced timeout for faster response
    });
    console.log(`Sent ${isInterim ? 'interim ' : ''}transcript to stream endpoint: ${text.substring(0, 30)}...`);
  } catch (error) {
    console.error(`Error sending transcript to stream endpoint:`, error);
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
 * Clean up all resources for a session
 * @param {string} sessionId - Session ID
 */
function cleanupSession(sessionId) {
  console.log(`Cleaning up session resources for ${sessionId}`);
  
  // Clear WebSocket connection
  if (activeConnections.has(sessionId)) {
    const ws = activeConnections.get(sessionId);
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    } catch (e) {
      console.error(`Error closing WebSocket for session ${sessionId}:`, e);
    }
    activeConnections.delete(sessionId);
  }
  
  // Clear status
  connectionStatus.delete(sessionId);
  
  // Clear transcription buffer
  transcriptionBuffers.delete(sessionId);
  
  // Clear timeouts
  if (transcriptionTimeouts.has(sessionId)) {
    clearTimeout(transcriptionTimeouts.get(sessionId));
    transcriptionTimeouts.delete(sessionId);
  }
  
  // Clear keep-alive interval
  if (keepAliveIntervals.has(sessionId)) {
    clearInterval(keepAliveIntervals.get(sessionId));
    keepAliveIntervals.delete(sessionId);
  }
  
  // Clear heartbeat interval
  if (heartbeatIntervals.has(sessionId)) {
    clearInterval(heartbeatIntervals.get(sessionId));
    heartbeatIntervals.delete(sessionId);
  }
  
  // Clear auto-close timeout
  if (autoCloseTimeouts.has(sessionId)) {
    clearTimeout(autoCloseTimeouts.get(sessionId));
    autoCloseTimeouts.delete(sessionId);
  }
  
  // Clear speaker tracking
  currentSpeakers.delete(sessionId);
  
  console.log(`Cleaned up session ${sessionId}`);
}

module.exports = {
  processAudio,
  cleanupSession
}; 