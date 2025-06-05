const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const dotenv = require('dotenv');
const http = require('http');
const WebSocket = require('ws');
const wav = require('wav');
const OpusEncoder = require('@discordjs/opus').OpusEncoder;

// Load environment variables from the repository root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Audio constants
const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const SAMPLE_WIDTH = 2; // 16-bit audio = 2 bytes
const TARGET_SAMPLES = SAMPLE_RATE * 5; // 5 seconds of audio
const CHUNK_DIR = path.join(__dirname, 'data', 'audio');

// Ensure audio directory exists
const fs = require('fs');
if (!fs.existsSync(CHUNK_DIR)) {
  fs.mkdirSync(CHUNK_DIR, { recursive: true });
}

// Database initialization
const db = require('./models/database');
// Initialize express application
const app = express();

// Set up middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Import authentication middleware
const basicAuth = require('./middleware/auth');

// Apply basic authentication to web UI routes only
// This does not apply to WebSocket connections
app.use((req, res, next) => {
  // Skip authentication for WebSocket upgrade requests
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    return next();
  }
  // Apply authentication to other requests
  basicAuth(req, res, next);
});

// Add error handling middleware
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({
    error: 'Server error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

// Set up view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Import routes
const inputRoutes = require('./routes/input');
const actionItemsRoutes = require('./routes/actionItems');
const memoriesRoutes = require('./routes/memories');
const streamRoutes = require('./routes/stream');
const transcriptionsRoutes = require('./routes/transcriptions');

// Import services
const deepgramService = require('./services/deepgramService');
const transcriptionService = require('./services/transcriptionService');
const llmService = require('./services/llmService');
const brainService = require('./services/brainService');
const actionItemsService = require('./services/actionItemsService');
const memoriesService = require('./services/memoriesService');

// Register routes
app.use('/input', inputRoutes);
app.use('/action-items', actionItemsRoutes);
app.use('/memories', memoriesRoutes);
app.use('/stream', streamRoutes);
app.use('/transcriptions', transcriptionsRoutes);

// Home route
app.get('/', (req, res) => {
  //temporary redirect to memories
  res.redirect("/memories");
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Create HTTP server
const server = http.createServer(app);

// ========================= Opus Decoder =========================
class OmiOpusDecoder {
  constructor() {
    this.decoder = new OpusEncoder(SAMPLE_RATE, CHANNELS);
  }

  decodePacket(packet) {
    try {
      // Check if we need to strip header
      const decoded = this.decoder.decode(packet);
      return decoded;
    } catch (error) {
      console.error(`Opus decode error: ${error.message}`);
      return null;
    }
  }
}

// ========================= Helper function to create WAV buffer from PCM =========================
async function createWavBuffer(pcmBuffer) {
  return new Promise((resolve, reject) => {
    const wavWriter = new wav.Writer({
      channels: CHANNELS,
      sampleRate: SAMPLE_RATE,
      bitDepth: SAMPLE_WIDTH * 8
    });

    const chunks = [];
    wavWriter.on('data', (chunk) => chunks.push(chunk));
    wavWriter.on('finish', () => {
      resolve(Buffer.concat(chunks));
    });
    wavWriter.on('error', (err) => {
      reject(new Error(`WAV Writer error: ${err.message}`));
    });

    wavWriter.write(pcmBuffer);
    wavWriter.end();
  });
}

// ========================= Client State =========================
class ClientState {
  constructor(ws, clientId) {
    this.ws = ws;
    this.id = clientId;
    this.pcmFrames = []; // PCM buffers for processing
    this.saveFrames = []; // PCM buffers for WAV saving
    this.sampleCount = 0; // samples accumulated in current segment
    this.segmentIndex = 0;
    this.startTime = new Date().toISOString();
    this.decoder = new OmiOpusDecoder();
    this.sessionId = `client_${clientId}_${Date.now()}`;
    
    // Buffering for transcriptions
    this.transcriptionBuffer = [];
    this.lastTranscriptionAdded = "";
    this.recentTranscripts = [];
    this.maxRecentTranscripts = 10; // keep a larger history to catch repeats
    this.lastActivityTime = Date.now();
    this.processingTimeout = null;
    this.segmentsProcessed = 0;
    
    // Silence duration in ms before processing (20 minutes)
    this.SILENCE_DURATION = 20 * 60 * 1000;
    
    // Debug settings
    this.DEBUG = false; // Set to true to enable verbose logging
  }

  async addOpusPacket(packet) {
    const pcm = this.decoder.decodePacket(packet);
    
    if (!pcm) {
      console.error(`Client ${this.id}: decode failed (packet dropped)`);
      return;
    }
    
    // Update activity time
    this.lastActivityTime = Date.now();
    
    // Clear any existing timeout
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
    }
    
    // Set a new timeout for processing after silence
    this.processingTimeout = setTimeout(() => {
      this.processBufferedTranscriptions();
    }, this.SILENCE_DURATION);
    
    this.pcmFrames.push(pcm);
    this.saveFrames.push(pcm);
    
    // Calculate sample count based on buffer size
    this.sampleCount += pcm.length / SAMPLE_WIDTH;
    
    if (this.sampleCount >= TARGET_SAMPLES) {
      await this.flushSegment();
    }
  }

  async flushSegment() {
    if (this.saveFrames.length === 0) {
      return;
    }
    
    const pcmBuffer = Buffer.concat(this.saveFrames);
    const duration = this.sampleCount / SAMPLE_RATE;
    
    // Write WAV to disk
    const timestamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '_').slice(0, 15);
    const wavPath = path.join(CHUNK_DIR, `client${this.id}_${timestamp}_${this.segmentIndex}.wav`);
    
    await this.writeWav(wavPath, pcmBuffer);
    
    // Only log if DEBUG is enabled
    if (this.DEBUG) {
      console.log(`Client ${this.id}: wrote ${path.basename(wavPath)} (${duration.toFixed(1)}s)`);
    }
    
    try {
      // Create WAV buffer from PCM for Deepgram
      const wavBuffer = await createWavBuffer(pcmBuffer);
      
      // Get transcript using Deepgram's preRecorded API
      const transcript = await this.transcribeAudio(wavBuffer);
      
      if (transcript && transcript.trim() !== '') {
        // Increment segments processed
        this.segmentsProcessed++;
        
        // Check for duplicates or similar content
        if (!this.isDuplicateTranscription(transcript)) {
          // Add to buffer if it's not a duplicate
          this.transcriptionBuffer.push(transcript);
          this.lastTranscriptionAdded = transcript;
          this.recentTranscripts.push(transcript);
          if (this.recentTranscripts.length > this.maxRecentTranscripts) {
            this.recentTranscripts.shift();
          }
          
          // Send transcript back to client without logging the full text
          if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ 
              transcript: transcript, 
              client_id: this.id,
              timestamp: new Date().toISOString()
            }));
          }
        }
        
        // Only log every 5 segments to reduce spam
        if (this.segmentsProcessed % 5 === 0) {
          console.log(`Client ${this.id}: processed ${this.segmentsProcessed} audio segments (${this.transcriptionBuffer.length} unique transcriptions)`);
        }
      }
    } catch (error) {
      console.error(`Error processing audio segment: ${error.message}`);
    }
    
    // Reset buffers for WAV saving
    this.saveFrames = [];
    this.sampleCount = 0;
    this.segmentIndex++;
  }
  
  // Check if a transcription is a duplicate or very similar to recently added ones
  isDuplicateTranscription(transcript) {
    if (!transcript) {
      return true;
    }

    // Check against the most recent transcript
    if (this.lastTranscriptionAdded && this.calculateSimilarity(transcript, this.lastTranscriptionAdded) > 0.85) {
      return true;
    }

    // Check against a small history of recent transcripts
    for (const recent of this.recentTranscripts) {
      if (this.calculateSimilarity(transcript, recent) > 0.85) {
        return true;
      }
    }

    return false;
  }
  
  // Calculate similarity between two strings (0-1 where 1 is identical)
  calculateSimilarity(str1, str2) {
    // Convert both strings to lowercase
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    
    // Calculate Levenshtein distance
    const distance = this.levenshteinDistance(s1, s2);
    
    // Calculate similarity as 1 - normalized distance
    const maxLength = Math.max(s1.length, s2.length);
    return maxLength === 0 ? 1 : 1 - distance / maxLength;
  }
  
  // Calculate Levenshtein distance between two strings
  levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    
    // Create a matrix of size (m+1) x (n+1)
    const dp = Array(m + 1).fill().map(() => Array(n + 1).fill(0));
    
    // Initialize first row and column
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    
    // Fill the matrix
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,      // deletion
          dp[i][j - 1] + 1,      // insertion
          dp[i - 1][j - 1] + cost // substitution
        );
      }
    }
    
    // Return the distance
    return dp[m][n];
  }

  async processBufferedTranscriptions() {
    // Skip if buffer is empty
    if (this.transcriptionBuffer.length === 0) {
      return;
    }
    
    console.log(`Client ${this.id}: Processing ${this.transcriptionBuffer.length} unique buffered transcriptions after silence period`);
    
    try {
      // Join all transcriptions into one text
      const fullText = this.transcriptionBuffer.join(' ');
      
      // Create a single transcription record for the combined text
      console.log(`Creating transcription record for combined text from ${this.transcriptionBuffer.length} segments`);
      await transcriptionService.createTranscription(fullText, this.sessionId);
      
      // Process with LLM
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
        await memoriesService.processMemories(analysisResult.memories, this.sessionId);
      } else {
        const memories = await llmService.extractMemories(fullText);
        await memoriesService.processMemories(memories, this.sessionId);
      }
      
      // Clear the buffer after processing
      this.transcriptionBuffer = [];
      
    } catch (error) {
      console.error(`Error processing buffered transcriptions: ${error.message}`);
    }
  }

  async transcribeAudio(wavBuffer, attempt = 1) {
    const MAX_ATTEMPTS = 3;
    try {
      const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
      if (!DEEPGRAM_API_KEY) {
        console.error('DEEPGRAM_API_KEY not set. Skipping transcription.');
        return '';
      }

      const axios = require('axios');
      const response = await axios.post(
        'https://api.deepgram.com/v1/listen',
        wavBuffer,
        {
          headers: {
            'Authorization': `Token ${DEEPGRAM_API_KEY}`,
            'Content-Type': 'audio/wav'
          },
          params: {
            smart_format: 'true',
            model: 'nova-3',
            language: 'multi'
          }
        }
      );

      if (response.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript) {
        return response.data.results.channels[0].alternatives[0].transcript;
      }
      return '';
    } catch (error) {
      console.error(`Deepgram transcription failed (attempt ${attempt}):`, error.message);
      if (attempt < MAX_ATTEMPTS) {
        const delay = 500 * Math.pow(2, attempt - 1);
        await new Promise(res => setTimeout(res, delay));
        return this.transcribeAudio(wavBuffer, attempt + 1);
      }
      return '';
    }
  }

  writeWav(filePath, pcmBuffer) {
    return new Promise((resolve, reject) => {
      try {
        const writer = new wav.FileWriter(filePath, {
          channels: CHANNELS,
          sampleRate: SAMPLE_RATE,
          bitDepth: SAMPLE_WIDTH * 8
        });
        
        writer.write(pcmBuffer);
        writer.end();
        
        writer.on('finish', () => {
          resolve();
        });
        
        writer.on('error', (err) => {
          reject(err);
        });
      } catch (error) {
        reject(error);
      }
    });
  }
}

// ========================= WebSocket Server =========================
const wss = new WebSocket.Server({ server });

const clients = [];
let nextClientId = 1;

wss.on('connection', function(ws) {
  const clientId = nextClientId++;
  const state = new ClientState(ws, clientId);
  clients.push(state);
  
  console.log(`Client ${clientId} connected with session ID: ${state.sessionId}`);
  
  // Send a welcome message
  ws.send(JSON.stringify({ 
    type: 'connection', 
    status: 'connected', 
    sessionId: state.sessionId 
  }));
  
  ws.on('message', async function(message) {
    try {
      // Process the opus packet
      await state.addOpusPacket(message);
    } catch (error) {
      console.error(`Error processing message from client ${clientId}: ${error.message}`);
    }
  });

  ws.on('close', async function() {
    console.log(`Client ${clientId} disconnecting sequence initiated...`);
    
    // Clear any processing timeout
    if (state.processingTimeout) {
      clearTimeout(state.processingTimeout);
      state.processingTimeout = null;
    }
    
    const index = clients.findIndex(client => client.id === clientId);
    if (index !== -1) {
      clients.splice(index, 1);
    }
    
    // Flush any remaining audio segment to disk
    if (state.sampleCount > 0 || state.saveFrames.length > 0) {
      console.log(`Client ${clientId}: Flushing final audio segment to disk`);
      await state.flushSegment();
    }
    
    // Process any buffered transcriptions immediately on disconnect
    if (state.transcriptionBuffer.length > 0) {
      console.log(`Client ${clientId}: Processing buffered transcriptions on disconnect`);
      await state.processBufferedTranscriptions();
    }
    
    console.log(`Client ${clientId} disconnected fully`);
  });

  ws.on('error', function(error) {
    console.error(`WebSocket error for client ${clientId}: ${error.message}`);
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server available at ws://localhost:${PORT}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app; 
