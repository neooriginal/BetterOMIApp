import asyncio
import os
import sys
import uuid
import requests
from asyncio import Queue
from bleak import BleakScanner
from dotenv import load_dotenv

from omi.bluetooth import listen_to_omi
from omi.decoder import OmiOpusDecoder
from omi.transcribe import transcribe

# Load environment variables from .env file
load_dotenv()

# Omi device configuration
OMI_DEVICE_NAME = "Omi"
OMI_AUDIO_CHARACTERISTIC_UUID = "19B10001-E8F2-537E-4F6C-D104768A1214"

# Backend API Configuration
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:3000")
STREAM_ENDPOINT = f"{BACKEND_URL}/stream"
SESSION_ID = str(uuid.uuid4())  # Generate a unique session ID

# Initialize decoder
decoder = OmiOpusDecoder()

async def find_omi_device():
    """Find the Omi device by scanning for devices with name 'Omi'"""
    print("Scanning for Omi devices...")
    devices = await BleakScanner.discover()
    omi_devices = [d for d in devices if d.name and OMI_DEVICE_NAME in d.name]
    
    if not omi_devices:
        print("No Omi devices found. Make sure your Omi is powered on and nearby.")
        return None
    
    print(f"Found {len(omi_devices)} Omi device(s):")
    for i, device in enumerate(omi_devices):
        print(f"  {i+1}. {device.name} [{device.address}]")
    
    # Return the first Omi device found
    return omi_devices[0].address

def send_transcript_to_backend(transcript):
    """Send transcribed text to the backend API"""
    try:
        payload = {
            "text": transcript,
            "sessionId": SESSION_ID
        }
        response = requests.post(STREAM_ENDPOINT, json=payload)
        if response.status_code == 200:
            print(f"Sent to backend: {transcript[:30]}...")
        else:
            print(f"Error sending to backend: {response.status_code}")
    except Exception as e:
        print(f"Error connecting to backend: {e}")

def data_handler(sender, data):
    """Handle incoming data from Omi device"""

    # Decode the Opus audio
    pcm_data = decoder.decode_packet(data)
    if pcm_data:
        # Put the decoded audio in the queue for transcription
        asyncio.create_task(audio_queue.put(pcm_data))

async def main():
    global audio_queue
    
    # Check for Deepgram API key from .env file
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        print("Error: Deepgram API key not found.")
        print("Please add your API key to the .env file:")
        print("DEEPGRAM_API_KEY=your_actual_deepgram_key")
        print("Get a free API key from https://deepgram.com")
        return

    # Create a queue for audio data
    audio_queue = Queue()
    
    # Find Omi device
    omi_mac = await find_omi_device()
    if not omi_mac:
        return
    
    # Start transcription service
    transcription_task = asyncio.create_task(transcribe(audio_queue, api_key, send_transcript_to_backend))
    
    # Connect to Omi and listen for audio data
    try:
        await listen_to_omi(omi_mac, OMI_AUDIO_CHARACTERISTIC_UUID, data_handler)
    except Exception as e:
        print(f"Error connecting to Omi: {e}")
    finally:
        # Clean up
        transcription_task.cancel()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nExiting...")
        sys.exit(0)
