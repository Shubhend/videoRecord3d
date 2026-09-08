import React, { useEffect, useRef } from 'react';
import { useFaceApp } from '../context/FaceAppContext.jsx';
import { AudioLipSync } from '../lib/audioLipSync.js';

export default function AudioPanel() {
  const { audio, setAudio, showToast } = useFaceApp();
  const { fileName, duration, syncEnabled, engine, loaded, playing } = audio;
  const intervalRef = useRef(null);

  const clearTicker = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const startTicker = () => {
    clearTicker();
    intervalRef.current = setInterval(() => {
      if (audio.engine?.sampleCurrent) {
        const t = audio.engine.getPlaybackTime?.() ?? 0;
        setAudio({ currentTime: t, playing: audio.engine.isPlaying?.() ?? false });
      }
    }, 100);
  };

  useEffect(() => {
    if (engine?.sampleCurrent) {
      startTicker();
    } else {
      clearTicker();
    }
    return () => clearTicker();
  }, [engine]);

  useEffect(() => {
    return () => clearTicker();
  }, []);

  const handleLoadFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      let eng = engine;
      if (!eng) {
        eng = new AudioLipSync();
      }
      const { duration: dur } = await eng.loadFile(file);
      setAudio({
        engine: eng,
        loaded: true,
        fileName: file.name,
        duration: dur,
        currentTime: 0,
        playing: false,
      });
      showToast('Audio loaded', 'ok');
    } catch (err) {
      showToast(err?.message || 'Failed to load audio', 'error');
    }
  };

  const handlePlay = async () => {
    if (!engine) {
      showToast('Load an audio file first', 'error');
      return;
    }
    try {
      await engine.play(false);
      setAudio({ playing: true });
    } catch (err) {
      showToast(err?.message || 'Playback failed', 'error');
    }
  };

  const handlePause = () => {
    if (!engine) return;
    engine.pause();
    setAudio({ playing: false });
  };

  const statusText = `Audio: ${fileName ?? 'None'}${duration ? ` \u00b7 ${Math.round(duration)}s` : ''}`;

  return React.createElement('div', { className: 'panel' },
    React.createElement('h3', null, 'Audio lip-sync'),
    React.createElement('input', {
      type: 'file',
      id: 'audio-file',
      accept: 'audio/*',
      onChange: handleLoadFile,
    }),
    React.createElement('p', {
      className: 'small-text',
      style: { marginTop: 6 },
    }, statusText),
    React.createElement('label', { className: 'toggle', style: { marginTop: 8 } },
      React.createElement('input', {
        type: 'checkbox',
        checked: syncEnabled,
        onChange: (e) => setAudio({ syncEnabled: e.target.checked }),
      }),
      React.createElement('span', null, 'Sync mouth to audio (then press Play audio)')
    ),
    React.createElement('div', { className: 'btn-row', style: { marginTop: 8 } },
      React.createElement('button', {
        className: 'btn secondary',
        disabled: !loaded,
        onClick: handlePlay,
      }, 'Play audio'),
      React.createElement('button', {
        className: 'btn secondary',
        disabled: !loaded || !playing,
        onClick: handlePause,
      }, 'Pause audio')
    )
  );
}
