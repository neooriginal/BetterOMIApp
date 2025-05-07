import logging
import time
import os
import threading
import queue
import pickle
import base64

logger = logging.getLogger(__name__)

class AudioBufferManager:
    def __init__(self, send_func, max_buffer_size=1000, retry_interval=5.0, storage_dir="audio_cache"):
        """
        Audio manager with offline support
        
        Args:
            send_func: Function to send audio data
            max_buffer_size: Maximum queue size for buffering
            retry_interval: Time in seconds between retry attempts
            storage_dir: Directory to store audio data during connection issues
        """
        self.send_func = send_func
        self.max_buffer_size = max_buffer_size
        self.retry_interval = retry_interval
        
        # Create storage directory if it doesn't exist
        self.storage_dir = storage_dir
        os.makedirs(storage_dir, exist_ok=True)
        
        # Queue for storing audio data that couldn't be sent
        self.buffer = queue.Queue(maxsize=max_buffer_size)
        
        # Flag to control the retry thread
        self.running = False
        self.retry_thread = None
        
        # Track consecutive failures to detect connection issues
        self.consecutive_failures = 0
        self.offline_mode = False
        
        # For tracking offline storage
        self.offline_counter = 0
    
    def start(self):
        """Start the manager and retry thread"""
        if self.running:
            return
            
        # Check for and load any previously cached audio files
        self._load_cached_audio()
            
        self.running = True
        self.retry_thread = threading.Thread(target=self._retry_worker)
        self.retry_thread.daemon = True
        self.retry_thread.start()
        logger.info("Audio buffer manager started with offline support")
    
    def stop(self):
        """Stop the manager"""
        self.running = False
        if self.retry_thread:
            self.retry_thread.join(timeout=2.0)
        logger.info(f"Audio buffer manager stopped, {self.buffer.qsize()} items still in buffer")
    
    def send(self, audio_data, bypass_silence_check=False):
        """
        Send audio data with offline fallback
        
        Args:
            audio_data: Audio data to send
            bypass_silence_check: Whether to bypass silence check for this data
        
        Returns:
            bool: True if sent or saved locally, False on failure
        """
        # If we're in offline mode, save directly to disk
        if self.offline_mode:
            return self._save_to_disk(audio_data, bypass_silence_check)
        
        # Try to send directly
        try:
            if hasattr(self.send_func, '__code__') and 'bypass_silence_check' in self.send_func.__code__.co_varnames:
                success = self.send_func(audio_data, bypass_silence_check)
            else:
                success = self.send_func(audio_data)
                
            if success:
                # Reset consecutive failures if successful
                self.consecutive_failures = 0
                return True
            else:
                self.consecutive_failures += 1
        except Exception as e:
            logger.error(f"Error sending audio data: {e}")
            self.consecutive_failures += 1
        
        # Switch to offline mode if too many consecutive failures
        if self.consecutive_failures >= 3 and not self.offline_mode:
            logger.warning("Switching to offline mode due to connection issues")
            self.offline_mode = True
        
        # If sending failed, buffer it
        try:
            if self.buffer.qsize() < self.max_buffer_size:
                # Store both the audio data and bypass flag
                self.buffer.put_nowait((audio_data, bypass_silence_check))
                logger.debug(f"Audio data buffered (buffer size: {self.buffer.qsize()})")
                return True
            else:
                # Buffer is full - save to disk
                return self._save_to_disk(audio_data, bypass_silence_check)
        except Exception as e:
            logger.error(f"Error buffering audio data: {e}")
            # Try to save to disk as last resort
            return self._save_to_disk(audio_data, bypass_silence_check)
    
    def _save_to_disk(self, audio_data, bypass_silence_check):
        """Save audio data to disk when buffer is full or offline"""
        try:
            # Create a unique filename
            filename = os.path.join(
                self.storage_dir, 
                f"audio_{int(time.time())}_{self.offline_counter}.pkl"
            )
            self.offline_counter += 1
            
            # Save the audio data and metadata
            with open(filename, 'wb') as f:
                pickle.dump({
                    'audio_data': audio_data,
                    'bypass_silence_check': bypass_silence_check,
                    'timestamp': time.time()
                }, f)
            
            logger.info(f"Saved audio data to disk: {filename}")
            return True
        except Exception as e:
            logger.error(f"Failed to save audio to disk: {e}")
            return False
    
    def _load_cached_audio(self):
        """Load previously cached audio files into buffer"""
        try:
            files = [f for f in os.listdir(self.storage_dir) if f.endswith('.pkl')]
            if not files:
                return
                
            logger.info(f"Found {len(files)} cached audio files to process")
            
            # Sort by timestamp in filename
            files.sort()
            
            for file in files:
                try:
                    filepath = os.path.join(self.storage_dir, file)
                    with open(filepath, 'rb') as f:
                        data = pickle.load(f)
                    
                    # Add to buffer if there's space
                    if self.buffer.qsize() < self.max_buffer_size:
                        self.buffer.put_nowait((
                            data['audio_data'], 
                            data['bypass_silence_check']
                        ))
                        # Remove the file after loading
                        os.remove(filepath)
                    else:
                        # Stop if buffer is full, will process remaining files later
                        logger.warning("Buffer full, will process remaining cached files later")
                        break
                except Exception as e:
                    logger.error(f"Error loading cached audio file {file}: {e}")
        except Exception as e:
            logger.error(f"Error scanning cached audio directory: {e}")
    
    def _retry_worker(self):
        """Worker thread that attempts to resend buffered data"""
        while self.running:
            # First check if we should exit offline mode
            if self.offline_mode:
                try:
                    # Test connection with a dummy request
                    logger.info("Testing connection to exit offline mode...")
                    if hasattr(self.send_func, '__code__') and 'bypass_silence_check' in self.send_func.__code__.co_varnames:
                        success = self.send_func(b'\x00\x00', True)
                    else:
                        success = self.send_func(b'\x00\x00')
                        
                    if success:
                        logger.info("Connection restored, exiting offline mode")
                        self.offline_mode = False
                        self.consecutive_failures = 0
                except Exception as e:
                    logger.warning(f"Still offline, connection test failed: {e}")
                    # Sleep longer when in offline mode
                    time.sleep(self.retry_interval * 2)
                    continue
            
            # Process buffer
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
                            self.consecutive_failures = 0
                            logger.debug(f"Successfully resent buffered audio data (remaining: {self.buffer.qsize()})")
                        else:
                            # If sending failed, increment failure counter
                            self.consecutive_failures += 1
                            # Sleep and try again later
                            time.sleep(self.retry_interval)
                    except Exception as e:
                        logger.warning(f"Error while retrying to send audio data: {e}")
                        self.consecutive_failures += 1
                        time.sleep(self.retry_interval)
                        
                except (IndexError, queue.Empty):
                    # Buffer became empty between checks
                    pass
            else:
                # Buffer is empty, check for cached files
                self._process_cached_files()
                
                # Buffer is still empty, wait before checking again
                time.sleep(self.retry_interval)
    
    def _process_cached_files(self):
        """Process any cached audio files from disk"""
        try:
            files = [f for f in os.listdir(self.storage_dir) if f.endswith('.pkl')]
            if not files:
                return
                
            # Process up to 5 files at a time to avoid loading too much at once
            for file in sorted(files)[:5]:
                try:
                    filepath = os.path.join(self.storage_dir, file)
                    with open(filepath, 'rb') as f:
                        data = pickle.load(f)
                    
                    # Try to send it directly
                    try:
                        if hasattr(self.send_func, '__code__') and 'bypass_silence_check' in self.send_func.__code__.co_varnames:
                            success = self.send_func(data['audio_data'], data['bypass_silence_check'])
                        else:
                            success = self.send_func(data['audio_data'])
                            
                        if success:
                            # If sending succeeded, remove the file
                            os.remove(filepath)
                            self.consecutive_failures = 0
                            logger.info(f"Successfully sent cached audio file: {file}")
                        else:
                            # If failed, break and try again later
                            self.consecutive_failures += 1
                            break
                    except Exception as e:
                        logger.warning(f"Error sending cached audio file {file}: {e}")
                        self.consecutive_failures += 1
                        break
                        
                except Exception as e:
                    logger.error(f"Error processing cached audio file {file}: {e}")
                    try:
                        # Move corrupted file to avoid repeated errors
                        corrupted_path = os.path.join(self.storage_dir, f"corrupted_{file}")
                        os.rename(os.path.join(self.storage_dir, file), corrupted_path)
                        logger.warning(f"Moved corrupted file to {corrupted_path}")
                    except Exception:
                        pass
        except Exception as e:
            logger.error(f"Error processing cached audio files: {e}") 