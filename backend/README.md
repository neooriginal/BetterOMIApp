# BetterOMI Backend Server

This is the backend server component of the BetterOMI application, which processes audio streams from the Python client, generates transcriptions, and extracts memories and action items using AI.

## Features

- Real-time audio streaming and processing
- Speech-to-text transcription
- AI-powered memory extraction and organization
- Action item identification and management
- Brain visualization of memories and connections
- RESTful API for frontend interaction

## Architecture

The backend is built with a modular architecture:

- **Routes**: API endpoints for different functionalities
- **Services**: Business logic implementation
- **Models**: Database models and interactions
- **Views**: EJS templates for rendering views

## Prerequisites

- Node.js 14.x or higher
- SQLite3 database
- OpenAI API key for AI functionality

## Installation

1. Clone the repository (if not already done)

2. Install dependencies:
   ```
   cd backend
   npm install
   ```

3. Create a `.env` file in the project root with the following content:
   ```
   PORT=3000
   OPENAI_API_KEY=your_openai_api_key
   NODE_ENV=development
   ```

## Usage

Run the backend server:

### Development Mode
```
npm run dev
```

### Production Mode
```
npm start
```

## API Endpoints

- `/memories` - Manage and retrieve stored memories
- `/action-items` - Handle action item creation and management
- `/input` - Process input from various sources
- `/stream` - Handle audio streaming from clients
- `/transcriptions` - Manage speech-to-text transcriptions
- `/brain` - Visualization of memories and connections

## WebSocket Streaming

The server supports WebSocket connections for real-time audio streaming from the Python client. Audio data is processed, transcribed, and analyzed as it is received.

## Database

The application uses SQLite3 for data storage with the following main tables:
- Memories
- ActionItems
- Transcriptions

## Troubleshooting

- **Connection issues**: Ensure the server is running on the correct port
- **API errors**: Check the API key in the .env file
- **Database errors**: Verify database permissions and structure

## License

This project is licensed under the MIT License - see the LICENSE file in the project root for details. 