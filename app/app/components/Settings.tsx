import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';

interface SettingsProps {
  webSocketUrl: string;
  onSetWebSocketUrl: (url: string) => void;
  isEditable: boolean;
}

const Settings: React.FC<SettingsProps> = ({
  webSocketUrl,
  onSetWebSocketUrl,
  isEditable
}) => {
  const [localUrl, setLocalUrl] = useState(webSocketUrl);
  const [isEditing, setIsEditing] = useState(false);

  const handleSave = () => {
    onSetWebSocketUrl(localUrl);
    setIsEditing(false);
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Settings</Text>
      
      <View style={styles.settingGroup}>
        <Text style={styles.settingLabel}>WebSocket URL:</Text>
        {isEditing ? (
          <View style={styles.editContainer}>
            <TextInput
              style={styles.textInput}
              value={localUrl}
              onChangeText={setLocalUrl}
              placeholder="wss://your-backend.com/ws/audio"
              autoCapitalize="none"
              keyboardType="url"
              returnKeyType="done"
              autoCorrect={false}
              editable={isEditable}
            />
            <TouchableOpacity 
              style={styles.saveButton}
              onPress={handleSave}
            >
              <Text style={styles.saveButtonText}>Save</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.displayContainer}>
            <Text style={styles.urlText} numberOfLines={1} ellipsizeMode="middle">
              {webSocketUrl || "No URL set"}
            </Text>
            <TouchableOpacity 
              style={styles.editButton}
              onPress={() => setIsEditing(true)}
              disabled={!isEditable}
            >
              <Text style={styles.editButtonText}>Edit</Text>
            </TouchableOpacity>
          </View>
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
  settingGroup: {
    marginBottom: 15,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#f8f8f8',
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
    color: '#444',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 10,
    fontSize: 14,
    marginRight: 10,
  },
  editContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  saveButton: {
    backgroundColor: '#4CD964',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  saveButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  displayContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  urlText: {
    flex: 1,
    fontSize: 14,
    color: '#666',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#efefef',
    borderRadius: 6,
    marginRight: 10,
  },
  editButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  editButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
});

export default Settings; 