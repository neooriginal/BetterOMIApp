import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ScrollView } from 'react-native';
import { BleAudioCodec } from 'friend-lite-react-native';

interface DeviceDetailsProps {
  // Device Info
  connectedDeviceId: string | null;
  onGetAudioCodec: () => void;
  currentCodec: BleAudioCodec | null;
  onGetBatteryLevel: () => void;
  batteryLevel: number;

  // Audio Listener
  isListeningAudio: boolean;
  onStartAudioListener: () => void;
  onStopAudioListener: () => void;
  audioPacketsReceived: number;

  // Custom Audio Streamer Status
  isAudioStreaming: boolean;
  isConnectingAudioStreamer: boolean;
  audioStreamerError: string | null;
}

export const DeviceDetails: React.FC<DeviceDetailsProps> = ({
  connectedDeviceId,
  onGetAudioCodec,
  currentCodec,
  onGetBatteryLevel,
  batteryLevel,
  isListeningAudio,
  onStartAudioListener,
  onStopAudioListener,
  audioPacketsReceived,
  isAudioStreaming,
  isConnectingAudioStreamer,
  audioStreamerError
}) => {
  // Blinking indicator state
  const [isBlinking, setIsBlinking] = useState(false);
  
  // Blinking effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (isListeningAudio) {
      // Create blinking effect
      interval = setInterval(() => {
        setIsBlinking(prev => !prev);
      }, 500);
    }
    
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isListeningAudio]);

  if (!connectedDeviceId) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Device Functions</Text>

      {/* Audio Controls */}
      <View style={styles.subSection}>
        <TouchableOpacity
          style={[
            styles.button, 
            isListeningAudio ? styles.buttonWarning : null,
            { marginTop: 15 }
          ]}
          onPress={isListeningAudio ? onStopAudioListener : onStartAudioListener}
        >
          <Text style={styles.buttonText}>
            {isListeningAudio ? "STOP AUDIO STREAMING" : "Start Audio Streaming"}
          </Text>
        </TouchableOpacity>
        
        {isListeningAudio && (
          <View style={styles.infoContainerSM}>
            <Text style={styles.infoTitle}>Audio Packets Received:</Text>
            <Text style={styles.infoValueLg}>{audioPacketsReceived}</Text>
          </View>
        )}
        
        {/* Clear status indicator */}
        {isListeningAudio && (
          <View style={styles.streamingStatusContainer}>
            <View style={[styles.streamingStatusIndicator, { opacity: isBlinking ? 0.3 : 1 }]} />
            <Text style={styles.streamingStatusText}>
              Audio streaming is active
            </Text>
          </View>
        )}
      </View>

      {/* Transcription Controls - Entire section REMOVED and replaced by WebSocket URL input */}
      <View style={styles.customStreamerSection}>
        <Text style={styles.subSectionTitle}>Custom Audio Streaming</Text>
        <Text style={styles.inputLabel}>Backend WebSocket URL:</Text>
        <TextInput
          style={styles.textInput}
          value={webSocketUrl}
          onChangeText={onSetWebSocketUrl}
          placeholder="wss://your-backend.com/ws/audio"
          autoCapitalize="none"
          keyboardType="url"
          returnKeyType="done"
          autoCorrect={false}
          editable={!isListeningAudio && !isAudioStreaming} // Prevent edit while listening/streaming
        />

        {/* Display Streamer Status */}
        {isConnectingAudioStreamer && (
          <Text style={styles.statusText}>Connecting to WebSocket...</Text>
        )}
        {isAudioStreaming && (
          <Text style={[styles.statusText, styles.statusStreaming]}>Streaming audio to WebSocket...</Text>
        )}
        {audioStreamerError && (
          <Text style={[styles.statusText, styles.statusError]}>Error: {audioStreamerError}</Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginBottom: 25,
    padding: 15,
    backgroundColor: 'white',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 15,
    color: '#333',
  },
  subSection: {
    marginTop: 20,
  },
  subSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: '#444',
  },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    elevation: 2,
  },
  buttonWarning: {
    backgroundColor: '#FF9500',
  },
  buttonDisabled: {
    backgroundColor: '#A0A0A0',
    opacity: 0.7,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  infoContainerSM: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    alignItems: 'center',
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#555',
  },
  infoValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#007AFF',
    marginTop: 5,
  },
  infoValueLg: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FF9500',
    marginTop: 5,
  },
  batteryContainer: {
    marginTop: 10,
    padding: 12,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    alignItems: 'center',
    borderLeftWidth: 4,
    borderLeftColor: '#4CD964',
  },
  batteryLevelDisplayContainer: {
    width: '100%',
    height: 24,
    backgroundColor: '#e0e0e0',
    borderRadius: 12,
    marginTop: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  batteryLevelBar: {
    height: '100%',
    backgroundColor: '#4CD964',
    borderRadius: 12,
    position: 'absolute',
    left: 0,
    top: 0,
  },
  batteryLevelText: {
    position: 'absolute',
    width: '100%',
    textAlign: 'center',
    lineHeight: 24,
    fontSize: 12,
    fontWeight: 'bold',
    color: '#333',
  },
  // Transcription Specific Styles - Some can be repurposed or removed
  customStreamerSection: {
    marginTop: 20,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    // alignItems: 'center', // No longer centering checkbox etc.
  },
  inputLabel: {
    fontSize: 14,
    color: '#333',
    marginBottom: 5,
    fontWeight: '500',
  },
  textInput: {
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 10,
    fontSize: 14,
    width: '100%', // Ensure input takes full width of its container
    marginBottom: 10,
  },
  statusText: { // New style for status messages
    marginTop: 8,
    fontSize: 13,
    color: '#555',
    textAlign: 'left',
  },
  statusStreaming: {
    color: 'green',
  },
  statusError: {
    color: 'red',
    fontWeight: 'bold',
  },
  streamingStatusContainer: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  streamingStatusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'red',
    marginRight: 8,
  },
  streamingStatusText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#555',
  },
});

export default DeviceDetails; 