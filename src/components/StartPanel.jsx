import React from 'react';
import { useFaceApp } from '../context/FaceAppContext.jsx';

export default function StartPanel() {
  const { tracking, trackingApi, showToast } = useFaceApp();

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
    }, tracking.started ? 'Tracking active…' : '1. Start face mesh tracking'),
    tracking.started && React.createElement('button', {
      className: 'btn secondary full',
      style: { marginTop: 6 },
      onClick: handleStop,
    }, 'Stop')
  );
}
