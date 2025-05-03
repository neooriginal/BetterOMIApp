import asyncio
import os
import sys
import uuid
import base64
import requests
from asyncio import Queue
from bleak import BleakScanner
from dotenv import load_dotenv

from omi.bluetooth import listen_to_omi
from omi.decoder import OmiOpusDecoder

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

def send_audio_to_backend(audio_data):
    """Send PCM audio data to the backend API"""
    try:
        # Base64 encode the binary audio data
        encoded_audio = base64.b64encode(audio_data).decode('utf-8')
        
        payload = {
            "audioData": encoded_audio,
            "sessionId": SESSION_ID
        }
        
        response = requests.post(AUDIO_STREAM_ENDPOINT, json=payload)
        if response.status_code == 200:
            print("Audio data sent to backend")
        else:
            print(f"Error sending audio to backend: {response.status_code}")
    except Exception as e:
        print(f"Error connecting to backend: {e}")

def data_handler(sender, data):
    """Handle incoming data from Omi device"""
    # Decode the Opus audio
    pcm_data = decoder.decode_packet(data)
    if pcm_data:
        # Send decoded audio to backend
        send_audio_to_backend(pcm_data)

async def main():
    # Check for backend connection
    try:
        response = requests.get(f"{BACKEND_URL}/")
        print(f"Connected to backend at {BACKEND_URL}")
        print(f"Session ID: {SESSION_ID}")
    except Exception as e:
        print(f"Error connecting to backend: {e}")
        print(f"Make sure the backend server is running at {BACKEND_URL}")
        return
    
    # Find Omi device
    omi_mac = await find_omi_device()
    if not omi_mac:
        return
    
    # Connect to Omi and listen for audio data
    try:
        await listen_to_omi(omi_mac, OMI_AUDIO_CHARACTERISTIC_UUID, data_handler)
    except Exception as e:
        print(f"Error connecting to Omi: {e}")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nExiting...")
        sys.exit(0)
