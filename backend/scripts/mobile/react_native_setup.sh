#!/bin/bash
# PROMPT #67 - React Native Mobile Support
# Sets up React Native project structure

set -e  # Exit on error

PROJECT_NAME=$1
PROJECT_DIR="/projects/$PROJECT_NAME"
MOBILE_DIR="$PROJECT_DIR/mobile"

echo "🚀 PROMPT #67 - Setting up React Native project: $PROJECT_NAME"

# Create mobile directory
mkdir -p "$MOBILE_DIR"
cd "$MOBILE_DIR"

echo "📱 Initializing React Native project with TypeScript..."

# Create package.json for React Native project
cat > package.json << EOF
{
  "name": "${PROJECT_NAME}-mobile",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "android": "react-native run-android",
    "ios": "react-native run-ios",
    "start": "react-native start",
    "test": "jest",
    "lint": "eslint . --ext .js,.jsx,.ts,.tsx"
  },
  "dependencies": {
    "react": "18.2.0",
    "react-native": "0.73.0",
    "@react-navigation/native": "^6.1.9",
    "@react-navigation/stack": "^6.3.20",
    "react-native-gesture-handler": "^2.14.0",
    "react-native-reanimated": "^3.6.0",
    "react-native-screens": "^3.29.0",
    "react-native-safe-area-context": "^4.8.0",
    "axios": "^1.6.2"
  },
  "devDependencies": {
    "@babel/core": "^7.20.0",
    "@babel/preset-env": "^7.20.0",
    "@babel/runtime": "^7.20.0",
    "@react-native/babel-preset": "0.73.0",
    "@react-native/eslint-config": "0.73.0",
    "@react-native/metro-config": "0.73.0",
    "@react-native/typescript-config": "0.73.0",
    "@types/react": "^18.2.6",
    "@types/react-test-renderer": "^18.0.0",
    "babel-jest": "^29.6.3",
    "eslint": "^8.19.0",
    "jest": "^29.6.3",
    "prettier": "2.8.8",
    "react-test-renderer": "18.2.0",
    "typescript": "5.0.4",
    "@testing-library/react-native": "^12.4.0"
  },
  "engines": {
    "node": ">=18"
  }
}
EOF

echo "📦 Installing dependencies (this may take a few minutes)..."
# Note: In Docker container, we skip actual npm install as it's resource-intensive
# The structure is created, and the user can run npm install manually in their environment
echo "⚠️  Skipping npm install (run manually: cd $MOBILE_DIR && npm install)"

# Create folder structure
echo "📁 Creating project structure..."
mkdir -p src/{screens,components,hooks,contexts,services,utils,types,styles,navigation}

# Create App.tsx
cat > App.tsx << 'EOF'
/**
 * Sample React Native App
 * PROMPT #67 - React Native Mobile Support
 */

import React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createStackNavigator} from '@react-navigation/stack';
import HomeScreen from './src/screens/HomeScreen';

const Stack = createStackNavigator();

function App(): JSX.Element {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{title: 'Welcome'}}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default App;
EOF

# Create HomeScreen
cat > src/screens/HomeScreen.tsx << EOF
import React from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

interface HomeScreenProps {
  navigation: any;
}

export default function HomeScreen({navigation}: HomeScreenProps) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentInsetAdjustmentBehavior="automatic">
        <View style={styles.content}>
          <Text style={styles.title}>Welcome to ${PROJECT_NAME}!</Text>
          <Text style={styles.subtitle}>
            Your React Native app is ready to go.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#000',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
});
EOF

# Create API service template
cat > src/services/api.ts << 'EOF'
import axios from 'axios';

const API_URL = process.env.API_URL || 'http://localhost:8000/api/v1';

const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
apiClient.interceptors.request.use(
  config => {
    // Add auth token if available
    // const token = await AsyncStorage.getItem('authToken');
    // if (token) {
    //   config.headers.Authorization = `Bearer ${token}`;
    // }
    return config;
  },
  error => {
    return Promise.reject(error);
  }
);

// Response interceptor
apiClient.interceptors.response.use(
  response => response.data,
  error => {
    if (error.response?.status === 401) {
      // Handle unauthorized
    }
    return Promise.reject(error);
  }
);

export default apiClient;
EOF

# Create TypeScript types
cat > src/types/index.ts << 'EOF'
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
}
EOF

# Create config file
cat > src/config/index.ts << 'EOF'
import {Platform} from 'react-native';

export const config = {
  api: {
    baseURL: process.env.API_URL || 'http://localhost:8000/api/v1',
    timeout: 10000,
  },
  app: {
    name: process.env.APP_NAME || 'MyApp',
    version: '1.0.0',
  },
  platform: {
    isIOS: Platform.OS === 'ios',
    isAndroid: Platform.OS === 'android',
  },
};

export default config;
EOF

# Create .env template
cat > .env.example << 'EOF'
API_URL=http://localhost:8000/api/v1
APP_NAME=MyApp
EOF

# Create tsconfig.json
cat > tsconfig.json << 'EOF'
{
  "extends": "@react-native/typescript-config/tsconfig.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
EOF

# Create .gitignore
cat > .gitignore << 'EOF'
# OSX
.DS_Store

# Node
node_modules/
npm-debug.log
yarn-error.log

# React Native
.expo/
.expo-shared/

# Android
android/app/build/
android/.gradle/

# iOS
ios/Pods/
ios/build/

# Environment
.env
.env.local

# IDE
.vscode/
.idea/
*.iml

# Misc
*.log
.watchmanconfig
EOF

# Create README
cat > README.md << EOF
# ${PROJECT_NAME} - React Native Mobile App

## PROMPT #67 - React Native Mobile Support

This is a React Native project scaffolded by Orbit 2.1.

## Setup

1. Install dependencies:
   \`\`\`bash
   npm install
   # or
   yarn install
   \`\`\`

2. Install iOS dependencies (macOS only):
   \`\`\`bash
   cd ios && pod install && cd ..
   \`\`\`

3. Create \`.env\` file:
   \`\`\`bash
   cp .env.example .env
   \`\`\`

## Running

### Android
\`\`\`bash
npm run android
\`\`\`

### iOS (macOS only)
\`\`\`bash
npm run ios
\`\`\`

### Development Server
\`\`\`bash
npm start
\`\`\`

## Project Structure

- \`src/screens/\` - Screen components
- \`src/components/\` - Reusable components
- \`src/navigation/\` - Navigation configuration
- \`src/services/\` - API services
- \`src/hooks/\` - Custom hooks
- \`src/contexts/\` - React Context providers
- \`src/utils/\` - Utility functions
- \`src/types/\` - TypeScript type definitions
- \`src/styles/\` - Shared styles

## Technologies

- React Native 0.73
- TypeScript
- React Navigation
- Axios (API client)

EOF

echo "✅ React Native project structure created at: $MOBILE_DIR"
echo ""
echo "📋 Next steps:"
echo "   1. cd $MOBILE_DIR"
echo "   2. npm install (or yarn install)"
echo "   3. cd ios && pod install && cd .. (macOS only, for iOS)"
echo "   4. npm run android (or npm run ios)"
echo ""
echo "📱 Project ready for mobile development!"
