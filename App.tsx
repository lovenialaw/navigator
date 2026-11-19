import { SafeAreaProvider } from 'react-native-safe-area-context';

import { MapScreen } from './src/screens/MapScreen';

/** No login, no auth database: the map is the first and only thing a cold launch shows. */
export default function App() {
  return (
    <SafeAreaProvider>
      <MapScreen />
    </SafeAreaProvider>
  );
}
