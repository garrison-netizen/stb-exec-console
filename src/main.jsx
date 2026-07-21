import React from 'react';
import ReactDOM from 'react-dom/client';
import AuthGate from './Auth.jsx';
import Shell from './Shell.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthGate>
      <Shell />
    </AuthGate>
  </React.StrictMode>
);
