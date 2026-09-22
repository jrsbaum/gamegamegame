import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { MAX_NOTE_LENGTH, clearNotes, readNotes, saveNotes } from './notes';

interface NotesPanelProps {
  roomCode: string;
  round: number;
}

/**
 * Bloco de notas privado do jogador. Fica só no cliente: nada aqui toca socket
 * nem rede. O texto vive em `sessionStorage` sob chave por sala e rodada, então
 * um reload restaura a nota e uma rodada nova começa em branco.
 */
export function NotesPanel({ roomCode, round }: NotesPanelProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * A caixa cresce com o conteúdo em vez de ganhar uma alça de redimensionar.
   * O passo por `auto` é obrigatório: sem zerar a altura antes de medir,
   * `scrollHeight` nunca diminui e a caixa só cresceria, nunca encolheria ao
   * apagar linhas. O teto e a barra de rolagem ficam no CSS (`max-height`), que
   * vence esta altura inline — por isso não há cálculo de limite aqui.
   *
   * `useLayoutEffect` e não `useEffect`: medir e aplicar antes da pintura evita
   * o pisca de um quadro com a altura errada a cada tecla.
   */
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    // `box-sizing: border-box` é global no projeto, então a altura precisa
    // incluir as bordas que o scrollHeight não conta.
    const borders = element.offsetHeight - element.clientHeight;
    element.style.height = `${element.scrollHeight + borders}px`;
  }, [text, open]);

  useEffect(() => {
    setText(readNotes(sessionStorage, roomCode, round));
  }, [roomCode, round]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const handleChange = (value: string): void => {
    setText(value);
    saveNotes(sessionStorage, roomCode, round, value);
  };

  const handleClear = (): void => {
    setText('');
    clearNotes(sessionStorage, roomCode, round);
  };

  return (
    <div className="notes-dock">
      {open && (
        <div id="notes-panel" className="notes-panel paper-card" role="dialog" aria-label="Bloco de notas">
          <div className="notes-panel-head">
            <div><span className="micro-label">Só você vê</span><h2>Bloco de notas</h2></div>
            <button className="notes-clear" type="button" onClick={handleClear} aria-label="Limpar notas">Limpar</button>
          </div>
          <label className="field-label" htmlFor="notes-text">Suas deduções</label>
          <textarea
            id="notes-text"
            ref={textareaRef}
            className="notes-textarea"
            value={text}
            onChange={(event) => handleChange(event.target.value)}
            placeholder="Ex.: não sou homem · sou desenho"
            maxLength={MAX_NOTE_LENGTH}
          />
        </div>
      )}
      <button
        className="notes-toggle"
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={open ? 'Fechar bloco de notas' : 'Abrir bloco de notas'}
        aria-expanded={open}
        aria-controls="notes-panel"
      >
        ✎
      </button>
    </div>
  );
}
