const NOTES_KEY_PREFIX = 'quem-sou-eu:notes';

export const MAX_NOTE_LENGTH = 2000;

/** Chave isolada por sala e por rodada, para que uma rodada nova comece vazia. */
export function notesStorageKey(roomCode: string, round: number): string {
  return `${NOTES_KEY_PREFIX}:${roomCode}:${round}`;
}

/**
 * Lê a nota da rodada. Storage bloqueado ou conteúdo de tipo inesperado
 * degradam para bloco vazio, sem lançar para a interface.
 */
export function readNotes(storage: Storage, roomCode: string, round: number): string {
  try {
    const raw = storage.getItem(notesStorageKey(roomCode, round));
    return typeof raw === 'string' ? raw : '';
  } catch {
    return '';
  }
}

/** Grava a nota truncada em `MAX_NOTE_LENGTH`. Devolve `false` se o storage recusar. */
export function saveNotes(storage: Storage, roomCode: string, round: number, text: string): boolean {
  try {
    storage.setItem(notesStorageKey(roomCode, round), text.slice(0, MAX_NOTE_LENGTH));
    return true;
  } catch {
    return false;
  }
}

/** Remove a nota da rodada. */
export function clearNotes(storage: Storage, roomCode: string, round: number): void {
  try {
    storage.removeItem(notesStorageKey(roomCode, round));
  } catch {
    // Storage indisponível: não há entrada persistida para remover.
  }
}
