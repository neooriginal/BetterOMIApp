import pyaudio
import logging
import time
import numpy as np
from threading import Thread, Event

logger = logging.getLogger(__name__)

class MicrophoneAudioSource:
    def __init__(self, sample_rate=16000, chunk_size=960, channels=1):
        """Initialize microphone audio source with the same parameters as Omi"""
        self.sample_rate = sample_rate
        self.chunk_size = chunk_size
        self.channels = channels
        self.format = pyaudio.paInt16
        self.pyaudio = None
        self.stream = None
        self.running = False
        self.stop_event = Event()
        self.data_handler = None
    
    def start(self, data_handler):
        """Start capturing audio from microphone and sending to data handler"""
        if self.running:
            logger.warning("Microphone audio source already running")
            return False
        
        try:
            self.pyaudio = pyaudio.PyAudio()
            self.stream = self.pyaudio.open(
                format=self.format,
                channels=self.channels,
                rate=self.sample_rate,
                input=True,
                frames_per_buffer=self.chunk_size
            )
            
            self.data_handler = data_handler
            self.running = True
            self.stop_event.clear()
            
            # Start thread to read audio data
            self.thread = Thread(target=self._audio_thread)
            self.thread.daemon = True
            self.thread.start()
            
            logger.info("Started microphone audio capture")
            return True
            
        except Exception as e:
            logger.error(f"Error starting microphone capture: {e}")
            self.cleanup()
            return False
    
    def _audio_thread(self):
        """Thread to continuously read audio data from microphone"""
        while not self.stop_event.is_set() and self.running:
            try:
                # Read audio chunk
                audio_data = self.stream.read(self.chunk_size, exception_on_overflow=False)
                
                # Create a fake "OMI" header (3 bytes) + audio data to match the expected format
                # This makes it compatible with the existing decoder
                omi_header = b'\x00\x00\x00'  # Placeholder header
                
                # Process the data using the provided handler
                # For microphone input, we're sending raw PCM, not Opus encoded data
                if self.data_handler:
                    # The handler expects the sender (which we set to None) and the data
                    self.data_handler(None, omi_header + audio_data)
                    
                time.sleep(0.01)  # Small sleep to prevent tight loop
                
            except Exception as e:
                logger.error(f"Error in microphone thread: {e}")
                time.sleep(0.1)  # Sleep longer on error
    
    def stop(self):
        """Stop microphone capture"""
        logger.info("Stopping microphone audio capture")
        self.stop_event.set()
        self.running = False
        self.cleanup()
    
    def cleanup(self):
        """Clean up resources"""
        if self.stream:
            try:
                self.stream.stop_stream()
                self.stream.close()
            except:
                pass
            self.stream = None
            
        if self.pyaudio:
            try:
                self.pyaudio.terminate()
            except:
                pass
            self.pyaudio = None 