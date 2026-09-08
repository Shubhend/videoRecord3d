import React, { useEffect, useState } from 'react';
import { useFaceApp } from '../context/FaceAppContext.jsx';
import { listModels, getSelectedModelId, setSelectedModelId } from '../lib/modelStore.js';

export default function ModelPanel() {
  const { tracking, model, actions, showToast } = useFaceApp();
  const [models, setModels] = useState([]);
  const [selectedId, setSelectedId] = useState(() => model.id || getSelectedModelId());

  useEffect(() => {
    listModels().then((ms) => {
      setModels(ms);
      if (!ms.some((m) => m.id === selectedId) && ms.length) {
        setSelectedId(ms[0].id);
        setSelectedModelId(ms[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (model.id && model.id !== selectedId) {
      setSelectedId(model.id);
    }
  }, [model.id]);

  const handleSelectChange = (e) => {
    const v = e.target.value;
    setSelectedId(v);
    setSelectedModelId(v);
  };

  const handleLoad = async () => {
    const act = actions.current;
    if (!act || !act.loadModelById) {
      showToast('Model loader not ready', 'error');
      return;
    }
    try {
      await act.loadModelById(selectedId);
    } catch (err) {
      showToast(err?.message || 'Failed to load model', 'error');
    }
  };

  return React.createElement('div', { className: 'panel' },
    React.createElement('h3', null, 'Avatar model'),
    React.createElement('label', { htmlFor: 'model-select' }, 'Model'),
    React.createElement('div', { style: { marginTop: 4 } },
      React.createElement('select', {
        id: 'model-select',
        value: selectedId,
        onChange: handleSelectChange,
      },
        models.map((m) => React.createElement('option', {
          key: m.id,
          value: m.id,
        }, m.builtIn ? m.name : `${m.name} (uploaded)`))
      )
    ),
    React.createElement('p', { className: 'small-text' }, 'Same list as legacy Models page.'),
    React.createElement('button', {
      className: 'btn primary full',
      style: { marginTop: 10 },
      disabled: !tracking.started || model.loading,
      onClick: handleLoad,
    }, model.loading ? 'Loading…' : '2. Load model on face')
  );
}
