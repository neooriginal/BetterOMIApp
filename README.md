# Better OMI App

This repository contains the mobile client and backend for the BetterOMI project.

- **app/** – React Native application built with Expo.
- **backend/** – Node.js/Express server used for processing audio streams and connecting with LLM services.

A Trello board with development notes is available at <https://trello.com/b/zy8MgbCD/betteromiapp>.

## Requirements

- [Node.js](https://nodejs.org/) (v18 or later) and npm
- [Expo CLI](https://docs.expo.dev/get-started/installation/) for running the mobile app
- A `.env` file in the repository root containing API keys and credentials

### Example `.env`

```bash
OPENAI_API_KEY=your-openai-key
DEEPGRAM_API_KEY=your-deepgram-key
BASIC_AUTH_USERNAME=admin
BASIC_AUTH_PASSWORD=secret
# optional
DATA_DIR=./backend/data
PORT=3000
```

## Running the backend

Install dependencies and start the server:

```bash
cd backend
npm install
npm run dev       # automatically restarts on changes
# or
npm start         # run without nodemon
```

The server listens on the port defined in `PORT` (defaults to `3000`).

## Running the mobile app

Install dependencies and launch the Expo development server:

```bash
cd app
npm install
npm start
```

From the Expo CLI you can run the app on an Android emulator or device with:

```bash
npm run android
```

For iOS, use `npm run ios` (Mac with Xcode required) or run on a physical device.

Make sure the app is configured to connect to the backend WebSocket URL (you can set this inside the app).

