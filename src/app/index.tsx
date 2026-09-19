import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

export default function MainMenu() {
  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.emoji}>🤠</Text>
        <Text style={styles.title}>WILD WEST</Text>
        <Text style={styles.subtitle}>D U E L O</Text>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.playBtn} onPress={() => router.push('/game' as any)}>
          <Text style={styles.playText}>JUGAR</Text>
        </Pressable>

        <Pressable style={styles.calibBtn} onPress={() => router.push('/calibration' as any)}>
          <Text style={styles.calibText}>Calibrar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingTop: 100,
    paddingBottom: 60,
  },
  hero: {
    alignItems: 'center',
    gap: 12,
  },
  emoji: {
    fontSize: 80,
  },
  title: {
    fontSize: 38,
    fontWeight: '900',
    color: '#e0a63e',
    letterSpacing: 10,
  },
  subtitle: {
    fontSize: 14,
    color: '#4a5160',
    letterSpacing: 8,
  },
  actions: {
    gap: 14,
  },
  playBtn: {
    backgroundColor: '#e0a63e',
    paddingVertical: 22,
    borderRadius: 14,
    alignItems: 'center',
  },
  playText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0d1117',
    letterSpacing: 6,
  },
  calibBtn: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e2530',
  },
  calibText: {
    fontSize: 15,
    color: '#4a5160',
    fontWeight: '600',
  },
});
