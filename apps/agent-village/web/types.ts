export type DeskSize = 'small' | 'medium' | 'large';
export type Privacy = 'none' | 'title' | 'description';
export interface Member { id: string; displayName: string; deskSize: DeskSize; online: boolean }
export interface Robot { id: string; ownerId: string; label: string; provider: 'codex' | 'cursor' | 'claude'; status: string; simulated: boolean; lastSignalAt: number | null; title?: string; description?: string }
export interface OwnRobot extends Robot { sessionId: string | null; privacy: Privacy; title: string; description: string }
export type ConnectorProvider = 'codex' | 'claude';
export type Shell = 'powershell' | 'git-bash' | 'zsh';
export interface Pairing { id: string; robotId: string; code: string; expiresAt: number; provider: ConnectorProvider; label: string; shell: Shell }
export interface Snapshot { simulated: boolean; serverNow: number; members: Member[]; robots: Robot[]; step?: number; totalSteps?: number }
export interface Me { account: { id: string; username: string; displayName: string; deskSize: DeskSize }; robots: OwnRobot[] }
export const statusLabels: Record<string, string> = { pending: 'Aguardando instalação', idle: 'Descansando', working: 'Trabalhando', reading: 'Lendo', tool: 'Usando ferramenta', waiting: 'Aguardando você', completed: 'Concluído', interrupted: 'Interrompido', error: 'Precisa de ajuda', offline: 'Desconectado' };
export const sizeLabels: Record<DeskSize, string> = { small: 'Cantinho', medium: 'Bancada', large: 'Ateliê' };
