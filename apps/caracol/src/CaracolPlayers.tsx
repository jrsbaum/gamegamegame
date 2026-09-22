import type { JSX } from 'react';
import type { CaracolPlayerView } from '../shared/caracol';
import { CaracolMedallion } from './CaracolAvatar';
import { caracolPlayerTone } from './caracolArt/model';
import { PlayerEffects } from './CaracolRoulette';

// O cartão "No mapa" fica fora de CaracolGame.tsx, que abre o socket no import,
// para poder ser renderizado nos testes.

export interface CaracolPlayersCardProps {
  players: CaracolPlayerView[];
  targetAccountId: string | null;
}

export function CaracolPlayersCard({ players, targetAccountId }: CaracolPlayersCardProps): JSX.Element {
  return <div className="caracol-players paper-card">
    <div className="panel-heading">
      <div><span className="micro-label">No mapa</span><h2>{players.length} pessoa{players.length === 1 ? '' : 's'}</h2></div>
      <span className="panel-mark">AO VIVO</span>
    </div>
    <div className="caracol-player-list">{players.map((player) => {
      const isTarget = player.accountId === targetAccountId;
      return <div className={`caracol-player-row ${player.isYou ? 'is-you' : ''} ${player.alive ? '' : 'is-dead'} ${isTarget ? 'is-target' : ''}`} key={player.accountId}>
        {/* Filho direto da linha: `.caracol-player-row div span` pegaria um medalhão dentro do texto. */}
        <CaracolMedallion
          wearer="player"
          outfit={player.outfit}
          size={40}
          tone={caracolPlayerTone({ isYou: player.isYou, isTarget, alive: player.alive })}
          label={player.alive ? `${player.nickname} vestido` : `${player.nickname} morta`}
        />
        <div>
          <strong>{player.nickname}{player.isYou ? <small> você</small> : null}</strong>
          <span>{player.alive ? `${player.city.name} · ${player.city.uf}` : `morta · ${player.city.name} · ${player.city.uf}`}</span>
        </div>
        <PlayerEffects itemIds={player.effectItemIds} />
        <i className={player.online ? 'online-mark' : 'offline-mark'} title={player.online ? 'online' : 'offline'} />
        {!player.alive && <b className="dead-badge">morta</b>}
        {isTarget && <b className="target-badge">alvo</b>}
      </div>;
    })}</div>
  </div>;
}
