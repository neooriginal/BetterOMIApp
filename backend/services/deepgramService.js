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

// Transcription buffers for combining fragments
const transcriptionBuffers = new Map();

// Transcription timeouts for processing after inactivity
const transcriptionTimeouts = new Map();

// Keep-alive intervals for each connection
const keepAliveIntervals = new Map();

// Empty audio data for heartbeat (2 bytes of silence)
const HEARTBEAT_DATA = Buffer.from([0, 0]);

// Heartbeat interval (10 seconds)
const HEARTBEAT_INTERVAL = 10000;

// Heartbeat intervals for each connection
const heartbeatIntervals = new Map();

// Track last detected speaker for each session
const lastSpeakers = new Map();

// Inactivity threshold in milliseconds (3 minutes of silence)
const TRANSCRIPTION_INACTIVITY_THRESHOLD = 3 * 60 * 1000;

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
    
    // Check if we need to establish a new connection
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
      try {
        // Create a new WebSocket connection
        wsConnection = await createDeepgramConnection(sessionId);
        
        // Update connection maps
        activeConnections.set(sessionId, wsConnection);
        
        // Setup heartbeat for this connection
        setupHeartbeat(sessionId, wsConnection);
      } catch (error) {
        console.error(`Failed to create Deepgram connection: ${error}`);
        throw error;
      }
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
        if (activeConnections.has(sessionId)) {
          try {
            const existingWs = activeConnections.get(sessionId);
            existingWs.terminate();
            activeConnections.delete(sessionId);
          } catch (e) {
            console.error(`Error terminating WebSocket for session ${sessionId}:`, e);
          }
        }
        
        // Create a new connection
        wsConnection = await createDeepgramConnection(sessionId);
        activeConnections.set(sessionId, wsConnection);
        
        // Setup heartbeat for this connection
        setupHeartbeat(sessionId, wsConnection);
        
        // Retry sending the audio data
        wsConnection.send(decodedAudio);
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
  
  // Set up a new heartbeat interval
  const interval = setInterval(() => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        // Send heartbeat audio data to keep the connection alive
        ws.send(HEARTBEAT_DATA);
        console.log(`Sent audio heartbeat for session ${sessionId}`);
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
 * Create a new WebSocket connection to Deepgram
 * @param {string} sessionId - Session ID for this connection
 * @returns {WebSocket} - WebSocket connection
 */
function createDeepgramConnection(sessionId) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`Creating new Deepgram connection for session ${sessionId}`);
      
      // Deepgram WebSocket URL
      const url = 'wss://api.deepgram.com/v1/listen';
      
      // Deepgram connection parameters
      const params = {
        encoding: 'linear16',
        sample_rate: 16000,
        channels: 1,
        model: 'nova-3',
        language: 'multi',
        smart_format: true,
        punctuate: true,
        diarize: true,
        utterance_end_ms: 1000,
        interim_results: true,
        endpointing: 500,
      };
      
      // Create query string
      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');
      
      // Full WebSocket URL with parameters
      const fullUrl = `${url}?${queryString}`;
      
      // Create WebSocket connection with API key
      const ws = new WebSocket(fullUrl, {
        headers: {
          Authorization: `Token ${DEEPGRAM_API_KEY}`
        }
      });
      
      // Handle connection open
      ws.on('open', () => {
        console.log(`Connected to Deepgram for session ${sessionId}`);
        resolve(ws);
      });
      
      // Handle incoming messages
      ws.on('message', async (data) => {
        try {
          // Parse JSON data from Deepgram
          const response = JSON.parse(data.toString());
          
          // Process transcription results if available
          if (response && response.channel && response.channel.alternatives && response.channel.alternatives.length > 0) {
            // Extract text from the first alternative
            const transcript = response.channel.alternatives[0].transcript;
            
            // Extract speaker information if available
            let speaker = null;
            if (response.channel.alternatives[0].speaker !== undefined) {
              speaker = response.channel.alternatives[0].speaker;
            }
            
            // Only process if we have text
            if (transcript && transcript.trim() !== '') {
              // Check if the result is final or interim
              const isFinal = response.is_final === true;
              
              if (isFinal) {
                // Buffer the transcript for processing
                bufferTranscription(transcript, sessionId, speaker);
              }
            }
          }
        } catch (e) {
          console.error(`Error processing Deepgram response: ${e.message}`);
        }
      });
      
      // Handle errors
      ws.on('error', (error) => {
        console.error(`WebSocket error for session ${sessionId}:`, error);
        reject(error);
      });
      
      // Handle connection close
      ws.on('close', (code, reason) => {
        console.log(`Deepgram connection closed for session ${sessionId}: Code: ${code}, Reason: ${reason}`);
        activeConnections.delete(sessionId);

        // Clean up heartbeat interval
        if (heartbeatIntervals.has(sessionId)) {
          clearInterval(heartbeatIntervals.get(sessionId));
          heartbeatIntervals.delete(sessionId);
        }

        // Remove last speaker tracking for this session
        if (lastSpeakers.has(sessionId)) {
          lastSpeakers.delete(sessionId);
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
  const lastSpeaker = lastSpeakers.get(sessionId);

  if (speaker !== null) {
    if (speaker !== lastSpeaker) {
      if (buffer.length > 0) {
        buffer += '\n';
      }
      buffer += `Speaker ${speaker}: ${text.trim()}`;
    } else {
      buffer += (buffer.length > 0 ? ' ' : '') + text.trim();
    }
    lastSpeakers.set(sessionId, speaker);
  } else {
    // No speaker info available
    buffer += (buffer.length > 0 ? ' ' : '') + text.trim();
  }
  
  // Update buffer in storage
  transcriptionBuffers.set(sessionId, buffer);
  
  console.log(`Buffered transcription for session ${sessionId}: "${text.trim()}"`);
  
  // Clear existing timeout if there is one
  if (transcriptionTimeouts.has(sessionId)) {
    clearTimeout(transcriptionTimeouts.get(sessionId));
  }
  
  // Set timeout to process text after inactivity
  const timeout = setTimeout(async () => {
    await processBufferedTranscription(sessionId);
  }, TRANSCRIPTION_INACTIVITY_THRESHOLD);
  
  // Store the timeout
  transcriptionTimeouts.set(sessionId, timeout);
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
    await transcriptionService.createTranscription(buffer, sessionId);
    
    // Send to stream processor
    await sendTranscriptToStream(buffer, sessionId);

    // Clear buffer
    transcriptionBuffers.delete(sessionId);
    lastSpeakers.delete(sessionId);

    console.log(`Successfully processed transcription for session ${sessionId}`);
  } catch (error) {
    console.error(`Error processing transcription for session ${sessionId}:`, error);
  }
}

/**
 * Send transcript to the stream endpoint for processing
 * @param {string} text - Transcribed text
 * @param {string} sessionId - Session ID
 */
async function sendTranscriptToStream(text, sessionId) {
  try {
    // Send the text to the stream endpoint for processing
    const response = await axios.post('http://localhost:3000/stream', {
      text,
      sessionId
    });
    
    return response.data;
  } catch (error) {
    console.error(`Error sending transcript to stream: ${error.message}`);
  }
}

module.exports = {
  processAudio
}; 