import asyncio
import os
import sys
import uuid
import base64
import requests
import logging
import time
from requests.adapters import HTTPAdapter, Retry
from urllib3.util.timeout import Timeout
from asyncio import Queue
from bleak import BleakScanner
from dotenv import load_dotenv

from omi.bluetooth import listen_to_omi, scan_for_omi_device
from omi.decoder import OmiOpusDecoder

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

def send_audio_to_backend(audio_data):
    """Send PCM audio data to the backend API with retry logic"""
    try:
        # Base64 encode the binary audio data
        encoded_audio = base64.b64encode(audio_data).decode('utf-8')
        
        payload = {
            "audioData": encoded_audio,
            "sessionId": SESSION_ID
        }
        
        response = session.post(AUDIO_STREAM_ENDPOINT, json=payload, timeout=timeout)
        if response.status_code != 200:
            logger.warning(f"Error sending audio to backend: {response.status_code}")
    except requests.exceptions.Timeout:
        logger.error("Timeout when connecting to backend")
    except requests.exceptions.ConnectionError:
        logger.error("Connection error when sending audio to backend")
    except Exception as e:
        logger.error(f"Error connecting to backend: {e}")

def data_handler(sender, data):
    """Handle incoming data from Omi device"""
    # Decode the Opus audio
    pcm_data = decoder.decode_packet(data)
    if pcm_data:
        # Send decoded audio to backend
        send_audio_to_backend(pcm_data)

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

async def main():
    # Check for backend connection
    if not await check_backend_connection():
        return
    
    # Find Omi devices
    omi_devices = await scan_for_omi_device(OMI_DEVICE_NAME)
    
    if not omi_devices:
        logger.error("No Omi devices found. Make sure your Omi is powered on and nearby.")
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
        return

    # Connect to the selected Omi and listen for audio data
    try:
        await listen_to_omi(omi_mac, OMI_AUDIO_CHARACTERISTIC_UUID, data_handler)
    except Exception as e:
        logger.error(f"Error in Omi connection: {e}")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("\nExiting gracefully...")
        sys.exit(0)
