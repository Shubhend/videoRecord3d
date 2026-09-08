import React, { useEffect, useState } from 'react';
import { useFaceApp } from '../context/FaceAppContext.jsx';
import { DEFAULT_PLACEMENT } from '../lib/sharedDefaults.js';
import { listPresets } from '../lib/presetStore.js';

const NUMERIC_FIELDS = [
  { key: 'posX', label: 'Pos X', min: -20, max: 20, step: 0.001 },
  { key: 'posY', label: 'Pos Y', min: -20, max: 20, step: 0.001 },
  { key: 'posZ', label: 'Pos Z', min: -20, max: 20, step: 0.001 },
  { key: 'rotX', label: 'Rot X', min: -180, max: 180, step: 1 },
  { key: 'rotY', label: 'Rot Y', min: -180, max: 180, step: 1 },
  { key: 'rotZ', label: 'Rot Z', min: -180, max: 180, step: 1 },
  { key: 'scaleMul', label: 'Scale', min: 0.1, max: 10, step: 0.01 },
];

const AUTO_FIT = {
  posX: 0.025,
  posY: -13,
  posZ: 0.003,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  scaleMul: 1,
};

export default function PlacementPanel() {
  const {
    placement, setPlacement,
    activePreset, actions, showToast,
  } = useFaceApp();

  const [presets, setPresets] = useState([]);

  const refreshPresets = async () => {
    const list = await listPresets();
    setPresets(list);
  };

  useEffect(() => {
    refreshPresets();
  }, []);

  const handlePresetChange = (e) => {
    const id = e.target.value;
    if (!id) return;
    const act = actions.current;
    if (act?.applyPreset) {
      act.applyPreset(id).then(() => refreshPresets()).catch((err) => {
        showToast(err?.message || 'Failed to apply preset', 'error');
      });
    }
  };

  const handleDeletePreset = () => {
    if (!activePreset.id) return;
    const act = actions.current;
    if (act?.deletePreset) {
      act.deletePreset(activePreset.id).then(() => refreshPresets()).catch((err) => {
        showToast(err?.message || 'Failed to delete preset', 'error');
      });
    }
  };

  const handleSavePreset = () => {
    const act = actions.current;
    if (act?.savePresetAs) {
      act.savePresetAs().then(() => refreshPresets()).catch((err) => {
        showToast(err?.message || 'Failed to save preset', 'error');
      });
    }
  };

  const handleFieldChange = (key, raw) => {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    setPlacement({ ...placement, [key]: v });
  };

  const handleAutoFit = () => {
    setPlacement({ ...DEFAULT_PLACEMENT, ...AUTO_FIT });
  };

  const handleReset = () => {
    setPlacement({ ...DEFAULT_PLACEMENT });
  };

  return React.createElement('div', { className: 'panel' },
    React.createElement('h3', null, 'Model position (step 1+)'),
    React.createElement('div', { className: 'num-row' },
      React.createElement('label', null, 'Preset'),
      React.createElement('div', { style: { display: 'flex', gap: 4 } },
        React.createElement('select', {
          id: 'preset-select',
          value: activePreset.id || '',
          style: { flex: '1 1 auto' },
          onChange: handlePresetChange,
        },
          React.createElement('option', { value: '' }, '\u2014 Saved presets \u2014'),
          presets.map((p) => React.createElement('option', {
            key: p.id,
            value: p.id,
          }, `${p.name}${p.modelName ? ` \u00b7 ${p.modelName}` : ''}`))
        ),
        React.createElement('button', {
          className: 'btn tertiary',
          style: { flex: '0 0 auto', width: 34, padding: '6px 0' },
          title: 'Delete selected preset',
          disabled: !activePreset.id,
          onClick: handleDeletePreset,
        }, '\u00d7')
      )
    ),
    React.createElement('button', {
      className: 'btn secondary full',
      style: { marginTop: 6 },
      onClick: handleSavePreset,
    }, '\ud83d\udcbe Save current as preset\u2026'),
    NUMERIC_FIELDS.map((f) => React.createElement('div', {
      key: f.key,
      className: 'num-row',
      style: { marginTop: 8 },
    },
      React.createElement('label', null, f.label),
      React.createElement('input', {
        type: 'number',
        min: f.min,
        max: f.max,
        step: f.step,
        value: placement[f.key],
        onChange: (e) => handleFieldChange(f.key, e.target.value),
      })
    )),
    React.createElement('div', { className: 'btn-row', style: { marginTop: 8 } },
      React.createElement('button', {
        className: 'btn secondary',
        onClick: handleAutoFit,
      }, 'Auto-fit to face'),
      React.createElement('button', {
        className: 'btn secondary',
        onClick: handleReset,
      }, 'Reset placement')
    )
  );
}
