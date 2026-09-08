import React from 'react';
import { useFaceApp } from '../context/FaceAppContext.jsx';

export default function StartPanel() {
  const { tracking, trackingApi, faceMeshEnabled, setFaceMeshEnabled, showToast } = useFaceApp();

  const handleStart = async () => {
    const api = trackingApi.current;
    if (!api) {
      showToast('Tracking system not ready', 'error');
      return;
    }
    try {
      await api.start();
    } catch (err) {
      showToast(err?.message || 'Failed to start tracking', 'error');
    }
  };

  const handleStop = () => {
    const api = trackingApi.current;
    if (api) api.stop();
  };

  return React.createElement('div', { className: 'panel' },
    React.createElement('h3', null, 'Tracking'),
    React.createElement('button', {
      className: 'btn primary full',
      disabled: tracking.started,
      onClick: handleStart,
    }, tracking.started ? 'Tracking active…' : '1. Start camera + face tracking'),
    tracking.started && React.createElement('button', {
      className: 'btn secondary full',
      style: { marginTop: 6 },
      onClick: handleStop,
    }, 'Stop'),
    React.createElement('label', {
      className: 'toggle',
      style: { marginTop: 12 },
      title: 'When unchecked, the avatar stays in preview pose (camera still runs).',
    },
      React.createElement('input', {
        type: 'checkbox',
        checked: !!faceMeshEnabled,
        onChange: (e) => setFaceMeshEnabled(!!e.target.checked),
      }),
      faceMeshEnabled ? 'Mirror my face movements to avatar' : 'Face movements disabled (preview pose)'
    )
  );
}
