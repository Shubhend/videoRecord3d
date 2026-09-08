import React, { useEffect } from 'react';
import { useFaceApp } from '../context/FaceAppContext.jsx';
import { applyBodyVisibility } from '../lib/modelVisibility.js';

const TOGGLES = [
  { key: 'showHead', label: 'Head' },
  { key: 'showHair', label: 'Hair' },
  { key: 'showBody', label: 'Torso/outfit' },
  { key: 'showArms', label: 'Arms/hands' },
  { key: 'showLegs', label: 'Legs/feet' },
  { key: 'headOnly', label: 'Head only (hide rest)' },
];

export default function BodyVisibilityPanel() {
  const { bodyParts, setBodyParts, classified, model } = useFaceApp();

  const handleToggle = (key) => {
    setBodyParts({ ...bodyParts, [key]: !bodyParts[key] });
  };

  useEffect(() => {
    const classifiedReady = classified && classified.headMeshes !== null;
    if (!classifiedReady || !model.modelRoot) return;
    applyBodyVisibility(model.modelRoot, model.vrm, classified, bodyParts);
  }, [bodyParts, classified, model.modelRoot, model.vrm]);

  return React.createElement('div', { className: 'panel' },
    React.createElement('h3', null, 'Hide body parts (step 2)'),
    TOGGLES.map((t) => React.createElement('label', {
      key: t.key,
      className: 'toggle',
    },
      React.createElement('input', {
        type: 'checkbox',
        checked: !!bodyParts[t.key],
        onChange: () => handleToggle(t.key),
      }),
      React.createElement('span', null, t.label)
    ))
  );
}
