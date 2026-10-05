export type DeskSize = 'small' | 'medium' | 'large';
export type Privacy = 'none' | 'title' | 'description';
export interface Member { id: string; displayName: string; deskSize: DeskSize; online: boolean }
export type RobotLifecycle = 'spawned' | 'active' | 'completed' | 'interrupted' | 'offline';
export interface Robot { id: string; ownerId: string; connectionId?: string | null; connectionLabel?: string; parentId?: string | null; label: string; provider: 'codex' | 'cursor' | 'claude'; status: string; lifecycle?: RobotLifecycle; simulated: boolean; lastSignalAt: number | null; spawnedAt?: number | null; title?: string; description?: string }
export interface OwnRobot extends Robot { sessionId?: string | null; parentSessionId?: string | null; parentRobotId?: string | null; privacy?: Privacy; title?: string; description?: string }
export type ConnectorProvider = 'codex' | 'claude';
export type Shell = 'powershell' | 'git-bash' | 'zsh';
export interface Pairing { id: string; connectionId?: string; robotId?: string; code: string; expiresAt: number; provider: ConnectorProvider; label: string; shell?: Shell }
export interface Connection { id: string; ownerId?: string; provider: ConnectorProvider; label: string; defaultPrivacy?: Privacy; privacy?: Privacy; shell?: Shell; installed?: boolean; connectedAt?: number | null; lastSeenAt?: number | null }
export interface OwnConnection extends Connection { pairing?: Pairing | null }
export interface Snapshot { simulated: boolean; serverNow: number; members: Member[]; robots: Robot[]; step?: number; totalSteps?: number }
export interface Me { account: { id: string; username: string; displayName: string; deskSize: DeskSize }; connections?: OwnConnection[]; robots: OwnRobot[] }
export const statusLabels: Record<string, string> = { pending: 'Aguardando instalação', idle: 'Descansando', working: 'Trabalhando', reading: 'Lendo', tool: 'Usando ferramenta', waiting: 'Aguardando você', completed: 'Concluído', interrupted: 'Interrompido', error: 'Precisa de ajuda', offline: 'Desconectado' };
export const sizeLabels: Record<DeskSize, string> = { small: 'Cantinho', medium: 'Bancada', large: 'Ateliê' };
