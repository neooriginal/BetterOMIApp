import logging
import time
import threading
import queue
from collections import deque

logger = logging.getLogger(__name__)

class AudioBufferManager:
    def __init__(self, send_func, max_buffer_size=1000, retry_interval=0.1):
        """
        Initialize the buffering system for audio data
        
        Args:
            send_func: Function to send audio data (returns True if successful, False otherwise)
            max_buffer_size: Maximum number of audio samples to buffer
            retry_interval: Time in seconds between retry attempts
        """
        self.send_func = send_func
        self.max_buffer_size = max_buffer_size
        self.retry_interval = retry_interval
        
        # Queue for storing audio data that couldn't be sent
        self.buffer = queue.Queue(maxsize=max_buffer_size)
        
        # Flag to control the retry thread
        self.running = False
        self.retry_thread = None
    
    def start(self):
        """Start the buffer manager and retry thread"""
        if self.running:
            return
            
        self.running = True
        self.retry_thread = threading.Thread(target=self._retry_worker)
        self.retry_thread.daemon = True
        self.retry_thread.start()
        logger.info("Audio buffer manager started")
    
    def stop(self):
        """Stop the buffer manager"""
        self.running = False
        if self.retry_thread:
            self.retry_thread.join(timeout=2.0)
        logger.info(f"Audio buffer manager stopped, {self.buffer.qsize()} items still in buffer")
    
    def send(self, audio_data, bypass_silence_check=False):
        """
        Send audio data, buffering it if sending fails
        
        Args:
            audio_data: Audio data to send
            bypass_silence_check: Whether to bypass silence check for this data
        
        Returns:
            bool: True if sent successfully, False if buffered
        """
        # First try to send directly
        try:
            if hasattr(self.send_func, '__code__') and 'bypass_silence_check' in self.send_func.__code__.co_varnames:
                success = self.send_func(audio_data, bypass_silence_check)
            else:
                success = self.send_func(audio_data)
            if success:
                return True
        except Exception as e:
            logger.warning(f"Error sending audio data: {e}")
        
        # If sending failed, try to buffer it
        try:
            if self.buffer.qsize() < self.max_buffer_size:
                # Store both the audio data and bypass flag
                self.buffer.put_nowait((audio_data, bypass_silence_check))
                logger.debug(f"Audio data buffered (buffer size: {self.buffer.qsize()})")
                return False
            else:
                # Buffer is full - discard oldest sample and add new one
                try:
                    # Try to get an item without blocking to make room
                    self.buffer.get_nowait()
                    self.buffer.put_nowait((audio_data, bypass_silence_check))
                    logger.warning("Buffer full - dropped oldest audio sample")
                    return False
                except queue.Empty:
                    # This should rarely happen due to the qsize check above
                    logger.warning("Failed to buffer audio data - buffer handling error")
                    return False
        except Exception as e:
            logger.error(f"Error buffering audio data: {e}")
            return False
    
    def _retry_worker(self):
        """Worker thread that attempts to resend buffered data"""
        while self.running:
            if not self.buffer.empty():
                try:
                    # Get the next item to retry without removing it yet
                    item = self.buffer.queue[0]
                    
                    # Handle both old format (just audio data) and new format (tuple with bypass flag)
                    if isinstance(item, tuple) and len(item) == 2:
                        audio_data, bypass_silence_check = item
                    else:
                        audio_data = item
                        bypass_silence_check = False
                    
                    # Try to send it
                    try:
                        if hasattr(self.send_func, '__code__') and 'bypass_silence_check' in self.send_func.__code__.co_varnames:
                            success = self.send_func(audio_data, bypass_silence_check)
                        else:
                            success = self.send_func(audio_data)
                            
                        if success:
                            # If sending succeeded, remove it from the queue
                            self.buffer.get_nowait()
                            logger.debug(f"Successfully resent buffered audio data (remaining: {self.buffer.qsize()})")
                        else:
                            # If sending failed, sleep and try again later
                            time.sleep(self.retry_interval)
                    except Exception as e:
                        logger.warning(f"Error while retrying to send audio data: {e}")
                        time.sleep(self.retry_interval)
                        
                except (IndexError, queue.Empty):
                    # Buffer became empty between checks
                    pass
                    
            else:
                # Buffer is empty, wait a bit before checking again
                time.sleep(self.retry_interval) 