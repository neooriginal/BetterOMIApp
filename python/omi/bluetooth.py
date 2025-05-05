import asyncio
import logging
from bleak import BleakScanner, BleakClient
from bleak.exc import BleakError

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

MAX_RETRY_ATTEMPTS = 3
RETRY_DELAY = 2  # seconds

def print_devices():
    devices = asyncio.run(BleakScanner.discover())
    for i, d in enumerate(devices):
        print(f"{i}. {d.name} [{d.address}]")

async def listen_to_omi(mac_address, char_uuid, data_handler):
    disconnect_event = asyncio.Event()
    retry_count = 0
    
    while retry_count < MAX_RETRY_ATTEMPTS:
        try:
            # Connection logic with proper error handling
            async with BleakClient(mac_address, timeout=10) as client:
                logger.info(f"Connected to Omi device at {mac_address}")
                
                # Set up disconnect callback
                client.set_disconnected_callback(lambda c: disconnect_event.set())
                
                # Start notification
                await client.start_notify(char_uuid, data_handler)
                logger.info("Listening for audio data...")
                
                # Wait until disconnected or interrupted
                try:
                    await disconnect_event.wait()
                    logger.info("Device disconnected")
                except asyncio.CancelledError:
                    logger.info("Connection monitoring task cancelled")
                    # Properly clean up notifications before disconnecting
                    await client.stop_notify(char_uuid)
                    raise
                
                return  # Successful connection and operation
                
        except BleakError as e:
            retry_count += 1
            logger.error(f"BLE connection error: {e}")
            if retry_count < MAX_RETRY_ATTEMPTS:
                logger.info(f"Retrying connection in {RETRY_DELAY} seconds... (Attempt {retry_count+1}/{MAX_RETRY_ATTEMPTS})")
                await asyncio.sleep(RETRY_DELAY)
            else:
                logger.error(f"Failed to connect after {MAX_RETRY_ATTEMPTS} attempts")
                raise
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
            raise

async def scan_for_omi_device(device_name="Omi"):
    """Scan for available Omi devices and return the first one found"""
    logger.info(f"Scanning for {device_name} devices...")
    
    # Try up to 3 times to find the device
    for attempt in range(3):
        devices = await BleakScanner.discover()
        omi_devices = [d for d in devices if d.name and device_name in d.name]
        
        if omi_devices:
            logger.info(f"Found {len(omi_devices)} {device_name} device(s)")
            return omi_devices[0].address
        
        if attempt < 2:  # Don't log after last attempt
            logger.info(f"No {device_name} devices found, retrying scan...")
            await asyncio.sleep(2)
    
    return None
