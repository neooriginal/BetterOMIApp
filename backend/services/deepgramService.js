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
    let ws = activeConnections.get(sessionId);
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // Create a new WebSocket connection if none exists or if it's closed
      ws = await createDeepgramConnection(sessionId);
      activeConnections.set(sessionId, ws);
    }
    
    // Send audio data to Deepgram
    ws.send(decodedAudio);
  } catch (error) {
    console.error('Error processing audio:', error);
    throw error;
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
      console.log(`Creating Deepgram connection with API key: ${DEEPGRAM_API_KEY ? "Available (length: " + DEEPGRAM_API_KEY.length + ")" : "NOT AVAILABLE"}`);
      
      const url = "wss://api.deepgram.com/v1/listen?punctuate=true&model=nova-3&language=multi&encoding=linear16&sample_rate=16000&channels=1";
      
      const ws = new WebSocket(url, {
        headers: {
          "Authorization": `Token ${DEEPGRAM_API_KEY}`
        }
      });

      ws.on('open', () => {
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
            }
          }
        } catch (error) {
          console.error(`Error processing Deepgram message: ${error}`);
        }
      });

      ws.on('error', (error) => {
        console.error(`Deepgram WebSocket error for session ${sessionId}:`, error);
        activeConnections.delete(sessionId);
        reject(error);
      });

      ws.on('close', (code, reason) => {
        console.log(`Deepgram WebSocket closed for session ${sessionId} with code ${code}. Reason: ${reason || 'No reason provided'}`);
        activeConnections.delete(sessionId);
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
    // Use localhost or the server's own address
    await axios.post('http://localhost:3000/stream', {
      text,
      sessionId
    });
    console.log(`Sent transcript to stream endpoint: ${text.substring(0, 30)}...`);
  } catch (error) {
    console.error('Error sending transcript to stream endpoint:', error);
  }
}

module.exports = {
  processAudio
}; 