import React from 'react';
import { useFaceApp } from '../context/FaceAppContext.jsx';

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function StatusHud() {
  const { tracking, faceMeshEnabled, model, activePreset, recording } = useFaceApp();

  let stepMsg;
  if (!tracking.started) {
    stepMsg = 'Preview mode';
  } else if (tracking.started && !model.loaded) {
    stepMsg = 'Step 2: Load model on face';
  } else if (recording.state === 'recording') {
    stepMsg = 'Recording';
  } else {
    stepMsg = 'Ready';
  }

  const okClass = tracking.faceDetected && tracking.started && faceMeshEnabled ? ' ok' : '';
  const hudLine2 = activePreset.name ? `\nPreset: ${activePreset.name}` : '';
  let meshState;
  if (!faceMeshEnabled) meshState = 'off (disabled)';
  else if (!tracking.started) meshState = 'preview';
  else if (!tracking.faceDetected) meshState = 'waiting…';
  else meshState = 'active';

  return React.createElement('div', { className: `panel status-panel${okClass}` },
    React.createElement('strong', null, stepMsg),
    recording.state === 'recording' && React.createElement('span', {
      className: 'rec-indicator',
      style: { marginLeft: 10 },
    },
      React.createElement('span', { className: 'rec-dot' }),
      React.createElement('span', null, formatDuration(recording.durationMs))
    ),
    React.createElement('pre', { className: 'hud' },
      `Face mesh: ${meshState}\nModel: ${model.name || 'none'}${hudLine2}`
    )
  );
}
