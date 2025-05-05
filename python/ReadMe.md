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
- PortAudio library (for PyAudio functionality)
- Backend server running (see main project README)

## Installation

1. Install the required system libraries:
   ```
   # macOS
   brew install opus portaudio
   
   # Ubuntu/Debian
   sudo apt-get install libopus-dev portaudio19-dev
   
   # Windows
   # Download Opus from https://opus-codec.org/downloads/
   # Download PortAudio from http://www.portaudio.com/download.html
   ```

2. Create and activate a Python virtual environment:
   ```
   # Create virtual environment
   python -m venv venv
   
   # Activate virtual environment
   # On macOS/Linux
   source venv/bin/activate
   
   # On Windows
   venv\Scripts\activate
   ```

3. Install Python dependencies:
   ```
   pip install -r requirements.txt
   ```
   
   If you encounter issues with PyAudio or other packages, you can install the core dependencies separately:
   ```
   pip install requests bleak python-dotenv opuslib
   ```

4. Create a `.env` file in the project root with the following content:
   ```
    BACKEND_URL=https://localhost:3000
   ```
   Adjust the .env accordingly

## Usage

Run the Python client:
```
# Activate the virtual environment (if not already activated)
source venv/bin/activate  # On macOS/Linux
# or
venv\Scripts\activate  # On Windows

# Run the application
python main.py
```


## Troubleshooting

- **No Omi devices found**: Ensure your Omi device is powered on and in pairing mode
- **Backend connection failed**: Ensure the backend server is running and accessible
- **Audio issues**: Check that Opus is properly installed and that your microphone is working
- **Missing modules error**: Make sure you're running the application within the activated virtual environment
- **PyAudio installation fails**: 
  - Ensure PortAudio is installed properly (see Installation step 1)
  - On macOS, you may need to install pyaudio with: `pip install --global-option=build_ext --global-option="-I/opt/homebrew/include" --global-option="-L/opt/homebrew/lib" pyaudio`
  - Consider using a pre-built PyAudio binary if installation continues to fail

## License

See the LICENSE file in the project root for licensing information.