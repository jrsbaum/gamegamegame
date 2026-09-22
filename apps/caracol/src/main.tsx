import { StrictMode, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { CaracolGame } from './CaracolGame';
import './styles.css';

function DedicatedEntry(): JSX.Element {
  return <CaracolGame onExit={() => { window.location.href = import.meta.env.VITE_LOBBY_URL || '/'; }} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DedicatedEntry />
  </StrictMode>,
);
