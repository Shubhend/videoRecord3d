import React, { useState } from 'react';
import { useFaceApp } from '../context/FaceAppContext.jsx';
import { downloadFaceVideo } from '../lib/faceRecorder.js';

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const STATE_LABELS = {
  idle: 'Idle',
  recording: 'Recording',
  paused: 'Paused',
};

export default function RecordPanel() {
  const { tracking, model, recording, setRecording, recorderApi, audio, showToast } = useFaceApp();
  const [includeAudio, setIncludeAudio] = useState(true);

  const locked = !tracking.started || !model.loaded;
  const stateLabel = STATE_LABELS[recording.state] || recording.state;
  const isRecording = recording.state === 'recording';
  const isPaused = recording.state === 'paused';
  const isIdle = recording.state === 'idle';

  const handleStart = async (withAudio) => {
    const api = recorderApi.current;
    if (!api) {
      showToast('Recorder not ready', 'error');
      return;
    }
    try {
      await api.start(withAudio);
    } catch (err) {
      showToast(err?.message || 'Failed to start recording', 'error');
    }
  };

  const handlePause = () => {
    recorderApi.current?.pause?.();
  };

  const handleResume = () => {
    recorderApi.current?.resume?.();
  };

  const handleStop = async () => {
    const api = recorderApi.current;
    if (!api) return;
    try {
      const blob = await api.stop();
      if (blob) {
        downloadFaceVideo(blob, `face-follow-${Date.now()}`);
        showToast('Recording saved', 'ok');
      }
    } catch (err) {
      showToast(err?.message || 'Failed to save recording', 'error');
    }
  };

  const panelClass = `panel${locked ? ' locked' : ''}`;
  const panelStyle = locked ? { opacity: 0.5, pointerEvents: 'none' } : null;

  return React.createElement('div', { className: panelClass, style: panelStyle },
    React.createElement('h3', null, 'Record video (MP4)'),
    React.createElement('p', {
      id: 'record-status',
      className: 'small-text',
    }, `Record: ${stateLabel} \u00b7 exports .mp4${isRecording || isPaused ? ` \u00b7 ${formatDuration(recording.durationMs)}` : ''}`),
    React.createElement('label', { className: 'toggle', style: { marginTop: 8 } },
      React.createElement('input', {
        type: 'checkbox',
        checked: includeAudio,
        onChange: (e) => setIncludeAudio(e.target.checked),
      }),
      React.createElement('span', null, 'Play & include audio when recording')
    ),
    React.createElement('div', { className: 'btn-row', style: { marginTop: 8 } },
      React.createElement('button', {
        className: 'btn primary',
        disabled: !isIdle,
        onClick: () => handleStart(false),
      }, 'Start'),
      React.createElement('button', {
        className: 'btn primary',
        disabled: !isIdle,
        onClick: () => handleStart(includeAudio),
      }, 'Start + audio')
    ),
    React.createElement('div', {
      className: 'btn-row',
      style: { marginTop: 6, gridTemplateColumns: '1fr 1fr 1fr 1fr' },
    },
      React.createElement('button', {
        className: 'btn secondary',
        disabled: !isRecording,
        onClick: handlePause,
      }, 'Pause'),
      React.createElement('button', {
        className: 'btn secondary',
        disabled: !isPaused,
        onClick: handleResume,
      }, 'Resume'),
      React.createElement('button', {
        className: 'btn secondary',
        style: { gridColumn: 'span 2' },
        disabled: isIdle,
        onClick: handleStop,
      }, 'Stop & save')
    )
  );
}
