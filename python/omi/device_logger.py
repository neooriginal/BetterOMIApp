import asyncio
import logging
import json
import os
import time
from datetime import datetime
from bleak import BleakClient
from bleak.exc import BleakError

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Directory where logs will be stored
LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "device_logs")

# Ensure log directory exists
if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

class DeviceLogger:
    def __init__(self, mac_address, characteristics=None):
        """
        Initialize the DeviceLogger
        
        Args:
            mac_address (str): MAC address of the Omi device
            characteristics (list): List of characteristic UUIDs to monitor (optional)
        """
        self.mac_address = mac_address
        self.characteristics = characteristics or []
        self.client = None
        self.running = False
        self.log_file = None
        
        # Create a new log file for this session
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.log_filename = os.path.join(LOG_DIR, f"device_log_{timestamp}.json")
        
        # Initialize log file with metadata
        self._initialize_log_file()
    
    def _initialize_log_file(self):
        """Create and initialize the log file with metadata"""
        metadata = {
            "device_mac": self.mac_address,
            "start_time": datetime.now().isoformat(),
            "characteristics": self.characteristics,
            "logs": []
        }
        
        os.makedirs(os.path.dirname(self.log_filename), exist_ok=True)
        
        with open(self.log_filename, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        logger.info(f"Device logger initialized. Logs will be saved to {self.log_filename}")
    
    def _log_data(self, characteristic, data):
        """Append data to the log file"""
        try:
            # Read current log content
            with open(self.log_filename, 'r') as f:
                log_data = json.load(f)
            
            # Append new log entry
            log_entry = {
                "timestamp": datetime.now().isoformat(),
                "characteristic": characteristic,
                "data": data.hex() if isinstance(data, bytes) else str(data)
            }
            
            log_data["logs"].append(log_entry)
            
            # Write updated log back to file
            with open(self.log_filename, 'w') as f:
                json.dump(log_data, f, indent=2)
                
        except Exception as e:
            logger.error(f"Error logging data: {e}")
    
    def notification_handler(self, characteristic, data):
        """Handle notifications from device characteristics"""
        char_uuid = str(characteristic)
        logger.info(f"Received data from characteristic {char_uuid}")
        
        # Log the data
        self._log_data(char_uuid, data)
    
    async def discover_characteristics(self):
        """Discover all available characteristics on the device"""
        try:
            async with BleakClient(self.mac_address) as client:
                logger.info(f"Connected to device at {self.mac_address} for characteristic discovery")
                
                services = client.services
                discovered_chars = []
                
                for service in services:
                    for char in service.characteristics:
                        if "notify" in char.properties:
                            discovered_chars.append(str(char.uuid))
                            logger.info(f"Discovered notifiable characteristic: {char.uuid} - {char.description}")
                
                return discovered_chars
                
        except Exception as e:
            logger.error(f"Error discovering characteristics: {e}")
            return []
    
    async def start_logging(self, auto_discover=True):
        """
        Start logging data from device characteristics
        
        Args:
            auto_discover (bool): If True, auto-discover all notifiable characteristics
        """
        if self.running:
            logger.warning("Device logger is already running")
            return False
        
        try:
            # If auto_discover is enabled and no characteristics specified, discover them
            if auto_discover and not self.characteristics:
                logger.info("Auto-discovering device characteristics...")
                self.characteristics = await self.discover_characteristics()
                
                if not self.characteristics:
                    logger.warning("No notifiable characteristics found")
                    return False
            
            # Connect to the device
            self.client = BleakClient(self.mac_address)
            await self.client.connect()
            
            if not self.client.is_connected:
                logger.error("Failed to connect to device")
                return False
            
            logger.info(f"Connected to device at {self.mac_address}")
            
            # Subscribe to all characteristics
            for char_uuid in self.characteristics:
                try:
                    await self.client.start_notify(
                        char_uuid, 
                        lambda sender, data: self.notification_handler(char_uuid, data)
                    )
                    logger.info(f"Subscribed to characteristic: {char_uuid}")
                except Exception as e:
                    logger.error(f"Failed to subscribe to {char_uuid}: {e}")
            
            self.running = True
            return True
            
        except Exception as e:
            logger.error(f"Error starting device logger: {e}")
            if self.client and self.client.is_connected:
                await self.client.disconnect()
            return False
    
    async def stop_logging(self):
        """Stop logging and disconnect from the device"""
        if not self.running:
            logger.warning("Device logger is not running")
            return
        
        try:
            # Unsubscribe from all characteristics
            for char_uuid in self.characteristics:
                try:
                    await self.client.stop_notify(char_uuid)
                except:
                    pass
            
            # Disconnect from device
            await self.client.disconnect()
            logger.info("Disconnected from device")
            
        except Exception as e:
            logger.error(f"Error stopping device logger: {e}")
        
        finally:
            self.running = False
            self.client = None

async def test_device_logger():
    """Test function to demonstrate the DeviceLogger usage"""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python -m omi.device_logger <MAC_ADDRESS>")
        return
    
    mac_address = sys.argv[1]
    logger.info(f"Testing device logger with device: {mac_address}")
    
    # Create logger instance
    device_logger = DeviceLogger(mac_address)
    
    # Start logging with auto-discovery
    success = await device_logger.start_logging(auto_discover=True)
    
    if not success:
        logger.error("Failed to start device logger")
        return
    
    # Keep running until interrupted
    try:
        logger.info("Device logger running. Press Ctrl+C to stop...")
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        logger.info("Stopping device logger...")
    finally:
        await device_logger.stop_logging()

if __name__ == "__main__":
    asyncio.run(test_device_logger()) 