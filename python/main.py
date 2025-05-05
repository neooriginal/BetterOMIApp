import asyncio
import os
import sys
import uuid
import base64
import requests
import logging
import time
import numpy as np
from requests.adapters import HTTPAdapter, Retry
from urllib3.util.timeout import Timeout
from asyncio import Queue
from bleak import BleakScanner
from dotenv import load_dotenv
import urllib3

from omi.bluetooth import listen_to_omi, scan_for_omi_device
from omi.decoder import OmiOpusDecoder
from omi.microphone import MicrophoneAudioSource
from omi.buffer import AudioBufferManager

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Load environment variables from .env file
load_dotenv()

# Omi device configuration
OMI_DEVICE_NAME = "Omi"
OMI_AUDIO_CHARACTERISTIC_UUID = "19B10001-E8F2-537E-4F6C-D104768A1214"

# Backend API Configuration
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:3000")
AUDIO_STREAM_ENDPOINT = f"{BACKEND_URL}/stream/audio"
SESSION_ID = str(uuid.uuid4())  # Generate a unique session ID

# Initialize decoder
decoder = OmiOpusDecoder()

# Create a session with retry logic
session = requests.Session()
retry_strategy = Retry(
    total=3,
    backoff_factor=0.5,
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["GET", "POST"]
)
# Request timeouts: (connect, read)
timeout = Timeout(connect=5.0, read=30.0)
adapter = HTTPAdapter(max_retries=retry_strategy)
session.mount("http://", adapter)
session.mount("https://", adapter)
# Disable SSL verification for self-signed certificates
session.verify = False
# Suppress InsecureRequestWarning
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Global microphone source
mic_source = None

# Initialize buffer manager
buffer_manager = None

# Audio energy threshold for silence detection
ENERGY_THRESHOLD = 500  # Adjust based on testing
# Time between audio sample sends to avoid overwhelming backend
MIN_SEND_INTERVAL = 0.1  # seconds
last_send_time = 0

def is_audio_silent(audio_data):
    """Check if audio data contains meaningful sound or is just silence"""
    try:
        # Convert bytes to numpy array (assuming 16-bit PCM)
        if len(audio_data) < 32:  # Minimum size check
            return True
            
        # Ensure we have a valid buffer length for int16 conversion
        # Strip any header if present (first 3 bytes from Omi format)
        if len(audio_data) % 2 != 0:
            # If odd length, assume there's a 3-byte header
            if len(audio_data) > 3:
                audio_data = audio_data[3:]
            else:
                return True  # Too small to process
                
        # If we still have odd length, trim the last byte
        if len(audio_data) % 2 != 0:
            audio_data = audio_data[:-1]
            
        # Convert to numpy array (16-bit PCM)
        audio_array = np.frombuffer(audio_data, dtype=np.int16)
        
        # Calculate RMS energy
        energy = np.sqrt(np.mean(np.square(audio_array.astype(np.float32))))
        
        # Check if energy exceeds threshold
        is_silent = energy < ENERGY_THRESHOLD
        
        # For debugging
        if not is_silent:
            logger.debug(f"Audio energy: {energy:.2f}")
            
        return is_silent
    except Exception as e:
        logger.error(f"Error checking audio energy: {e}")
        return False  # Assume not silent on error

def send_audio_to_backend(audio_data):
    """Send PCM audio data to the backend API with retry logic"""
    
    # Skip if audio is silent or too small
    if len(audio_data) < 100 or is_audio_silent(audio_data):
        return True  # Pretend we sent it successfully
    
    try:
        # Base64 encode the binary audio data
        encoded_audio = base64.b64encode(audio_data).decode('utf-8')
        
        payload = {
            "audioData": encoded_audio,
            "sessionId": SESSION_ID
        }
        
        response = session.post(AUDIO_STREAM_ENDPOINT, json=payload, timeout=timeout)
        if response.status_code == 200:
            return True
        else:
            logger.warning(f"Error sending audio to backend: {response.status_code}")
            return False
    except requests.exceptions.Timeout:
        logger.error("Timeout when connecting to backend")
        return False
    except requests.exceptions.ConnectionError:
        logger.error("Connection error when sending audio to backend")
        return False
    except Exception as e:
        logger.error(f"Error connecting to backend: {e}")
        return False

def data_handler(sender, data):
    """Handle incoming data from Omi device or microphone"""
    # For Omi device (Opus encoded data)
    if sender != "microphone":
        # Decode the Opus audio
        pcm_data = decoder.decode_packet(data)
        if pcm_data:
            # Use buffer manager to send or buffer audio
            if buffer_manager:
                buffer_manager.send(pcm_data)
            else:
                send_audio_to_backend(pcm_data)
    else:
        # For microphone (already PCM data)
        # If data starts with the 3-byte Omi header we added in microphone.py, strip it
        if len(data) > 3 and data.startswith(b'\x00\x00\x00'):
            data = data[3:]
            
        if buffer_manager:
            buffer_manager.send(data)
        else:
            send_audio_to_backend(data)

async def check_backend_connection():
    """Check if backend server is reachable"""
    for attempt in range(3):
        try:
            response = session.get(f"{BACKEND_URL}/", timeout=Timeout(connect=3.0, read=5.0))
            logger.info(f"Connected to backend at {BACKEND_URL}")
            logger.info(f"Session ID: {SESSION_ID}")
            return True
        except requests.exceptions.RequestException as e:
            logger.warning(f"Attempt {attempt+1}/3: Error connecting to backend: {e}")
            if attempt < 2:
                logger.info(f"Retrying backend connection in 2 seconds...")
                await asyncio.sleep(2)
    
    logger.error(f"Failed to connect to backend at {BACKEND_URL}")
    logger.error(f"Make sure the backend server is running at {BACKEND_URL}")
    return False

def start_microphone_fallback():
    """Start using computer microphone as audio source"""
    global mic_source
    
    logger.info("Initializing computer microphone as fallback audio source")
    mic_source = MicrophoneAudioSource()
    success = mic_source.start(lambda _, data: data_handler("microphone", data))
    
    if success:
        logger.info("Using computer microphone for audio input")
        return True
    else:
        logger.error("Failed to initialize computer microphone")
        return False

async def main():
    global buffer_manager
    
    # Check for backend connection
    if not await check_backend_connection():
        return
    
    # Initialize buffer manager
    buffer_manager = AudioBufferManager(send_audio_to_backend)
    buffer_manager.start()
    
    # Find Omi devices
    try:
        omi_devices = await scan_for_omi_device(OMI_DEVICE_NAME)
    except Exception as e:
        if "Bluetooth device is turned off" in str(e):
            logger.error("Bluetooth is turned off. Please turn on Bluetooth to use Omi device.")
            choice = input("Would you like to turn on Bluetooth and retry (r) or continue with microphone (m)? [r/m]: ")
            if choice.lower() == 'r':
                logger.info("Please turn on Bluetooth and run the program again.")
                return
            elif choice.lower() == 'm':
                logger.info("Continuing with microphone input...")
                if start_microphone_fallback():
                    try:
                        while True:
                            await asyncio.sleep(1)
                    except KeyboardInterrupt:
                        logger.info("\nExiting microphone capture...")
                        if mic_source:
                            mic_source.stop()
                        if buffer_manager:
                            buffer_manager.stop()
                return
            else:
                logger.info("Invalid choice. Exiting...")
                return
        else:
            logger.error(f"Error scanning for Omi devices: {e}")
            logger.info("Falling back to computer microphone.")
            if start_microphone_fallback():
                try:
                    while True:
                        await asyncio.sleep(1)
                except KeyboardInterrupt:
                    logger.info("\nExiting microphone capture...")
                    if mic_source:
                        mic_source.stop()
                    if buffer_manager:
                        buffer_manager.stop()
            return
    
    if not omi_devices:
        logger.warning("No Omi devices found. Falling back to computer microphone.")
        if start_microphone_fallback():
            # Keep the main thread running while microphone captures
            try:
                while True:
                    await asyncio.sleep(1)
            except KeyboardInterrupt:
                logger.info("\nExiting microphone capture...")
                if mic_source:
                    mic_source.stop()
                if buffer_manager:
                    buffer_manager.stop()
        return

    omi_mac = None
    if len(omi_devices) == 1:
        # If only one device is found, use it directly
        omi_mac = omi_devices[0].address
        logger.info(f"Using Omi device: {omi_devices[0].name} [{omi_mac}]")
    else:
        # If multiple devices are found, prompt the user to choose
        print("Multiple Omi devices found:")
        for i, device in enumerate(omi_devices):
            print(f"  {i + 1}: {device.name} [{device.address}]")
        
        while omi_mac is None:
            try:
                choice = input(f"Enter the number of the device to connect to (1-{len(omi_devices)}): ")
                choice_index = int(choice) - 1
                if 0 <= choice_index < len(omi_devices):
                    omi_mac = omi_devices[choice_index].address
                    logger.info(f"Selected Omi device: {omi_devices[choice_index].name} [{omi_mac}]")
                else:
                    print("Invalid choice. Please enter a number from the list.")
            except ValueError:
                print("Invalid input. Please enter a number.")
            except EOFError: # Handle Ctrl+D or similar
                logger.warning("Device selection cancelled.")
                return

    if not omi_mac:
        # This case should ideally not be reached if selection logic is correct
        # but added as a safeguard
        logger.error("No Omi device selected or available.")
        # Try microphone fallback
        if start_microphone_fallback():
            # Keep the main thread running while microphone captures
            try:
                while True:
                    await asyncio.sleep(1)
            except KeyboardInterrupt:
                logger.info("\nExiting microphone capture...")
                if mic_source:
                    mic_source.stop()
                if buffer_manager:
                    buffer_manager.stop()
        return

    # Connect to the selected Omi and listen for audio data
    try:
        await listen_to_omi(omi_mac, OMI_AUDIO_CHARACTERISTIC_UUID, data_handler)
    except Exception as e:
        logger.error(f"Error in Omi connection: {e}")
        logger.info("Trying microphone fallback after Omi connection failure")
        if start_microphone_fallback():
            # Keep the main thread running while microphone captures
            try:
                while True:
                    await asyncio.sleep(1)
            except KeyboardInterrupt:
                logger.info("\nExiting microphone capture...")
                if mic_source:
                    mic_source.stop()
                if buffer_manager:
                    buffer_manager.stop()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("\nExiting gracefully...")
        # Clean up resources
        if mic_source:
            mic_source.stop()
        if buffer_manager:
            buffer_manager.stop()
        sys.exit(0)
