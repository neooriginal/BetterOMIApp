import { Platform, Linking } from 'react-native';
import { Alert, PermissionsAndroid, NativeModules } from 'react-native';

export const requestBatteryOptimizationPermission = async (): Promise<void> => {
  // Only applies to Android
  if (Platform.OS !== 'android') {
    return;
  }

  try {
    const packageName = NativeModules.PlatformConstants?.packageName || 'com.betteromi.app';
    
    Alert.alert(
      'Battery Optimization',
      'To ensure reliable background operation, please disable battery optimization for this app.',
      [
        { 
          text: 'Cancel', 
          style: 'cancel' 
        },
        {
          text: 'Open Settings',
          onPress: async () => {
            try {
              // First try to open the specific battery optimization exemption page
              const batteryOptUri = `package:${packageName}`;
              const canOpen = await Linking.canOpenURL(batteryOptUri);
              
              if (canOpen) {
                // This opens the specific battery optimization page for this app
                await Linking.openURL(`android.settings.APPLICATION_DETAILS_SETTINGS?${batteryOptUri}`);
              } else {
                // Fallback to general settings if specific page can't be opened
                await Linking.openSettings();
              }
            } catch (error) {
              console.error('[BatteryOptimizationHelper] Error opening settings:', error);
              // Fallback to general settings
              try {
                await Linking.openSettings();
              } catch (innerError) {
                console.error('[BatteryOptimizationHelper] Error opening general settings:', innerError);
              }
            }
          },
        },
      ],
      { cancelable: true }
    );
  } catch (error) {
    console.error('[BatteryOptimizationHelper] Error requesting battery optimization permission:', error);
  }
};

export const checkAndRequestBatteryOptimization = async (): Promise<void> => {
  // Only applicable for Android
  if (Platform.OS === 'android') {
    requestBatteryOptimizationPermission();
  }
}; 