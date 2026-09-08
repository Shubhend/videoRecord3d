import React, { useEffect, useState } from 'react';
import { loadAppSettings, saveAppSettings } from '../lib/settingsStore.js';

const SENSITIVITY_FIELDS = [
  { key: 'expressions', label: 'Face / expressions' },
  { key: 'eyes', label: 'Eyes' },
  { key: 'mouth', label: 'Mouth' },
  { key: 'audioLipSync', label: 'Audio lip-sync' },
];

const SMOOTHING_FIELDS = [
  { key: 'face', label: 'Face' },
];

export default function SettingsPanel({ settingsOpen, setSettingsOpen }) {
  const [sensitivity, setSensitivity] = useState({
    expressions: 1.0,
    eyes: 1.0,
    mouth: 1.0,
    audioLipSync: 1.8,
  });
  const [smoothing, setSmoothing] = useState({
    face: 0.22,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const s = loadAppSettings();
    const sens = s.sensitivity || {};
    const smoo = s.smoothing || {};
    setSensitivity({
      expressions: Number(sens.expressions) ?? 1.0,
      eyes: Number(sens.eyes) ?? 1.0,
      mouth: Number(sens.mouth) ?? 1.0,
      audioLipSync: Number(sens.audioLipSync) ?? 1.8,
    });
    setSmoothing({
      face: Number(smoo.face) ?? 0.22,
    });
    setLoaded(true);
  }, []);

  const saveSettings = (nextSens, nextSmoo) => {
    const curSens = nextSens || sensitivity;
    const curSmoo = nextSmoo || smoothing;
    const merged = loadAppSettings();
    saveAppSettings({
      ...merged,
      sensitivity: {
        ...(merged.sensitivity || {}),
        ...curSens,
      },
      smoothing: {
        ...(merged.smoothing || {}),
        ...curSmoo,
      },
    });
  };

  const handleSensChange = (key, raw) => {
    const v = Math.max(0, Math.min(2, Number(raw) || 0));
    const next = { ...sensitivity, [key]: v };
    setSensitivity(next);
    if (loaded) saveSettings(next, null);
  };

  const handleSmoothChange = (key, raw) => {
    const v = Math.max(0, Math.min(1, Number(raw) || 0));
    const next = { ...smoothing, [key]: v };
    setSmoothing(next);
    if (loaded) saveSettings(null, next);
  };

  return React.createElement('details', {
    className: 'panel',
    style: { borderColor: '#5c8bff' },
    open: settingsOpen,
    onToggle: (e) => {
      if (setSettingsOpen) setSettingsOpen(e.target.open);
    },
  },
    React.createElement('summary', null, 'Settings'),
    React.createElement('div', null,
      React.createElement('h3', { style: { marginTop: 4 } }, 'Sensitivity (0\u2013200%)'),
      SENSITIVITY_FIELDS.map((f) => React.createElement('div', {
        key: f.key,
        className: 'num-row',
      },
        React.createElement('label', null, f.label),
        React.createElement('input', {
          type: 'number',
          min: 0,
          max: 2,
          step: 0.05,
          value: sensitivity[f.key],
          onChange: (e) => handleSensChange(f.key, e.target.value),
        })
      )),
      React.createElement('h3', { style: { marginTop: 10 } }, 'Smoothing (higher = smoother)'),
      SMOOTHING_FIELDS.map((f) => React.createElement('div', {
        key: f.key,
        className: 'num-row',
      },
        React.createElement('label', null, f.label),
        React.createElement('input', {
          type: 'number',
          min: 0,
          max: 1,
          step: 0.01,
          value: smoothing[f.key],
          onChange: (e) => handleSmoothChange(f.key, e.target.value),
        })
      ))
    )
  );
}
