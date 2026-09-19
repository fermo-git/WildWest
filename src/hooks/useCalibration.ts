import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type CalibrationData = {
  restAngle: number | null;
  targetAngle: number | null;
  threshold: number;
  timeWindowMs: number;
  angleTolerance: number;
  restTolerance: number;
  skipAutoCalibration: boolean;
};

const DEFAULTS: CalibrationData = {
  restAngle: null,
  targetAngle: null,
  threshold: 16,
  timeWindowMs: 600,
  angleTolerance: 15,
  restTolerance: 20,
  skipAutoCalibration: false,
};

const KEY = 'wildwest:calibration';

export function useCalibration() {
  const [data, setData] = useState<CalibrationData>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const hasLoaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then(raw => { if (raw) setData({ ...DEFAULTS, ...JSON.parse(raw) }); })
      .catch(() => {})
      .finally(() => { hasLoaded.current = true; setLoaded(true); });
  }, []);

  const update = useCallback((patch: Partial<CalibrationData>) => {
    setData(prev => {
      const next = { ...prev, ...patch };
      if (hasLoaded.current) {
        AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    AsyncStorage.removeItem(KEY).catch(() => {});
    setData(DEFAULTS);
  }, []);

  return { data, update, clear, loaded };
}
