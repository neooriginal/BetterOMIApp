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
from omi.device_logger import DeviceLogger

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

def send_audio_to_backend(audio_data, bypass_silence_check=False):
    """Send PCM audio data to the backend API directly without extra checks"""
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
            # Send audio data directly
            send_audio_to_backend(pcm_data)
    else:
        # For microphone (already PCM data)
        # If data starts with the 3-byte Omi header we added in microphone.py, strip it
        if len(data) > 3 and data.startswith(b'\x00\x00\x00'):
            data = data[3:]
        
        # Send audio data directly
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
    
    # Initialize buffer manager - simplified version, kept for compatibility
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

    # Start the device logger to capture additional characteristics
    device_logger = DeviceLogger(omi_mac)
    logger.info("Starting device logger to capture additional device characteristics...")
    await device_logger.start_logging(auto_discover=True)

    # Connect to the selected Omi and listen for audio data
    try:
        await listen_to_omi(omi_mac, OMI_AUDIO_CHARACTERISTIC_UUID, data_handler)
    except KeyboardInterrupt:
        logger.info("\nExiting...")
    except Exception as e:
        logger.error(f"Error listening to Omi device: {e}")
    finally:
        # Clean up device logger on exit
        if device_logger and device_logger.running:
            logger.info("Stopping device logger...")
            await device_logger.stop_logging()
        
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
