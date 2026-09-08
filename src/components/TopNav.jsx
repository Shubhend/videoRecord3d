import React from 'react';

export default function TopNav({ settingsOpen, setSettingsOpen }) {
  return React.createElement('div', { className: 'topbar' },
    React.createElement('div', { className: 'brand' },
      React.createElement('div', { className: 'brand-mark' }, 'EA'),
      React.createElement('span', null, 'Edge AI Avatar')
    ),
    React.createElement('div', { className: 'topbar-actions' },
      React.createElement('a', { href: './models.html' }, 'Models'),
      React.createElement('a', { href: './record.html' }, 'Webcam Recorder'),
      React.createElement('a', { href: './legacy-index.html' }, 'Full-body'),
      React.createElement('button', {
        className: 'nav-btn',
        onClick: () => setSettingsOpen((v) => !v),
      }, 'Settings')
    )
  );
}
