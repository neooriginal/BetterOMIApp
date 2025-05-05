# Python Client

This is the Python client component of the BetterOMI application, which captures audio from an Omi device or computer microphone and streams it to the backend for processing.

## Features

- Connects to Omi devices via Bluetooth LE
- Decodes Opus audio data from Omi
- Falls back to computer microphone if no Omi device is found
- Streams audio data to the backend server for processing
- Buffer management for reliable audio transmission

## Prerequisites

- Python 3.7 or higher
- Opus library (for audio decoding)
- Backend server running (see main project README)

## Installation

1. Install the Opus audio codec library:
   ```
   # macOS
   brew install opus
   
   # Ubuntu/Debian
   sudo apt-get install libopus-dev
   
   # Windows
   # Download from https://opus-codec.org/downloads/
   ```

2. Install Python dependencies:
   ```
   pip install -r requirements.txt
   ```

3. Create a `.env` file in the project root with the following content:
   ```
    BACKEND_URL=https://localhost:3000
   ```
   Adjust the .env accordingly

## Usage

Run the Python client:
```
python python/main.py
```


## Troubleshooting

- **No Omi devices found**: Ensure your Omi device is powered on and in pairing mode
- **Backend connection failed**: Ensure the backend server is running and accessible
- **Audio issues**: Check that Opus is properly installed and that your microphone is working

## License

See the LICENSE file in the project root for licensing information.