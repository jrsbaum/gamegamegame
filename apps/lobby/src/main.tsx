import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LobbyApp } from './LobbyApp';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LobbyApp />
  </StrictMode>,
);
