import logging
from opuslib import Decoder
from opuslib.exceptions import OpusError

# Configure logging
logger = logging.getLogger(__name__)

class OmiOpusDecoder:
    def __init__(self):
        self.decoder = Decoder(16000, 1)  # 16kHz mono
        self.consecutive_errors = 0
        self.max_consecutive_errors = 5

    def decode_packet(self, data):
        """
        Decode an Opus packet to PCM audio
        Returns PCM data or empty bytes if decoding fails
        """
        # Check data validity
        if not data or len(data) <= 3:
            return b''

        # Remove 3-byte header
        clean_data = bytes(data[3:])

        # Decode Opus to PCM 16-bit
        try:
            pcm = self.decoder.decode(clean_data, 960, decode_fec=False)
            # Reset error counter on success
            self.consecutive_errors = 0
            return pcm
        except OpusError as e:
            self.consecutive_errors += 1
            logger.warning(f"Opus decode error: {e}")
            
            # If we have too many consecutive errors, recreate the decoder
            if self.consecutive_errors >= self.max_consecutive_errors:
                logger.warning(f"Too many consecutive errors ({self.consecutive_errors}), recreating decoder")
                try:
                    self.decoder = Decoder(16000, 1)
                    self.consecutive_errors = 0
                except Exception as reinit_err:
                    logger.error(f"Failed to reinitialize decoder: {reinit_err}")
            
            return b''
        except Exception as e:
            logger.error(f"Unexpected decode error: {e}")
            return b''
