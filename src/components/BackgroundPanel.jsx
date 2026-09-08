import React, { useEffect, useState } from 'react';
import { useFaceApp } from '../context/FaceAppContext.jsx';

const MODE_OPTIONS = [
  { value: 'camera', label: 'Live camera' },
  { value: 'blur', label: 'Camera blur' },
  { value: 'color', label: 'Solid color' },
  { value: 'image', label: 'Image' },
  { value: 'screen', label: 'Screen share' },
];

export default function BackgroundPanel() {
  const { background, setBackground, showToast } = useFaceApp();
  const ctrl = background.controller;
  const [screenActive, setScreenActive] = useState(false);

  useEffect(() => {
    if (!ctrl || typeof ctrl.onScreenShareChange !== 'undefined') {
      setScreenActive(!!ctrl?.screenStream);
    }
  }, [ctrl, background.mode]);

  const handleModeChange = (e) => {
    setBackground({ mode: e.target.value });
  };

  const handleBlurChange = (e) => {
    const v = Math.max(0, Math.min(40, Number(e.target.value) || 0));
    setBackground({ blurPx: v });
  };

  const handleColorChange = (e) => {
    setBackground({ color: e.target.value });
  };

  const handleImageFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (ctrl && typeof ctrl.setImageFile === 'function') {
      ctrl.setImageFile(file);
      setBackground({ mode: 'image' });
    }
  };

  const handleClearImage = () => {
    if (ctrl && typeof ctrl.clearImage === 'function') {
      ctrl.clearImage();
    }
  };

  const handleStartScreenShare = async () => {
    if (!ctrl || typeof ctrl.startScreenShare !== 'function') {
      showToast('Background controller not ready', 'error');
      return;
    }
    try {
      await ctrl.startScreenShare();
      setScreenActive(true);
    } catch (err) {
      showToast(err?.message || 'Failed to start screen share', 'error');
    }
  };

  const handleStopScreenShare = () => {
    if (ctrl && typeof ctrl.stopScreenShare === 'function') {
      ctrl.stopScreenShare();
      setScreenActive(false);
    }
  };

  const isScreen = background.mode === 'screen';

  return React.createElement('div', { className: 'panel' },
    React.createElement('h3', null, 'Background'),
    React.createElement('div', { className: 'num-row' },
      React.createElement('label', null, 'Mode'),
      React.createElement('select', {
        value: background.mode,
        onChange: handleModeChange,
      },
        MODE_OPTIONS.map((o) => React.createElement('option', {
          key: o.value,
          value: o.value,
        }, o.label))
      )
    ),
    React.createElement('div', { className: 'num-row' },
      React.createElement('label', null, 'Blur (px)'),
      React.createElement('input', {
        type: 'number',
        min: 0,
        max: 40,
        step: 1,
        value: background.blurPx ?? 12,
        onChange: handleBlurChange,
      })
    ),
    React.createElement('div', { className: 'num-row' },
      React.createElement('label', null, 'Color'),
      React.createElement('input', {
        type: 'color',
        value: background.color || '#0a0e14',
        onChange: handleColorChange,
      })
    ),
    React.createElement('div', { style: { marginTop: 8 } },
      React.createElement('input', {
        type: 'file',
        accept: 'image/*',
        onChange: handleImageFile,
      })
    ),
    React.createElement('button', {
      className: 'btn secondary full',
      style: { marginTop: 6 },
      onClick: handleClearImage,
    }, 'Clear image'),
    React.createElement('div', { className: 'btn-row', style: { marginTop: 8 } },
      React.createElement('button', {
        className: 'btn secondary',
        disabled: screenActive || isScreen,
        onClick: handleStartScreenShare,
      }, 'Start screen share'),
      React.createElement('button', {
        className: 'btn secondary',
        disabled: !screenActive,
        onClick: handleStopScreenShare,
      }, 'Stop screen share')
    ),
    React.createElement('p', {
      className: 'small-text',
      style: { marginTop: 6 },
    }, `Screen: ${screenActive ? 'active' : 'off'}`)
  );
}
