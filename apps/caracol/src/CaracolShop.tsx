import { useReducer, useState, type JSX } from 'react';
import {
  CARACOL_COSMETIC_SLOTS,
  type CaracolCosmeticItem,
  type CaracolCosmeticSlot,
  type CaracolCosmeticWearer,
  type CaracolOutfit,
  type CaracolStateView,
} from '../shared/caracol';
import { CaracolFigure, CaracolMedallion } from './CaracolAvatar';
import { caracolShopItemTone } from './caracolArt/model';

// A gaveta da loja fica fora de CaracolGame.tsx, que abre o socket no import,
// para poder ser renderizada nos testes.

export interface CaracolShopDrawerProps {
  state: CaracolStateView;
  open: boolean;
  tab: CaracolCosmeticWearer;
  onTabChange: (tab: CaracolCosmeticWearer) => void;
  onClose: () => void;
  onPurchase: (itemId: string) => void;
  onEquip: (slot: CaracolCosmeticSlot, itemId: string | null) => void;
}

// Provador: passar o ponteiro ou o foco num card veste a peça na prévia, e o
// botão do medalhão fixa ou solta a prova, que é o caminho no toque. Nada aqui
// compra nem equipa.
//
// Hover e foco só fazem prova temporária e não mexem numa prova fixada. Sem
// `pinned`, um toque chega como mouseenter + foco + clique, e o clique desfaria
// na hora a prova que o hover acabou de fazer.
export interface ShopPreviewState {
  trying: string | null;
  pinned: boolean;
}

export type ShopPreviewAction =
  | { type: 'try'; itemId: string }
  | { type: 'leave' }
  | { type: 'toggle'; itemId: string }
  | { type: 'tab' };

const NO_PREVIEW: ShopPreviewState = { trying: null, pinned: false };

export function shopPreviewReducer(state: ShopPreviewState, action: ShopPreviewAction): ShopPreviewState {
  switch (action.type) {
    case 'try':
      return state.pinned ? state : { trying: action.itemId, pinned: false };
    case 'leave':
      return state.pinned ? state : NO_PREVIEW;
    case 'toggle':
      return state.pinned && state.trying === action.itemId ? NO_PREVIEW : { trying: action.itemId, pinned: true };
    case 'tab':
      return NO_PREVIEW;
  }
}

export function shopPreview(outfit: CaracolOutfit, tryingItem: CaracolCosmeticItem | null): { outfit: CaracolOutfit; label: 'Provando' | 'Visual atual' } {
  if (!tryingItem) return { outfit, label: 'Visual atual' };
  return { outfit: { ...outfit, [tryingItem.slot]: tryingItem.id }, label: 'Provando' };
}

export function shopCardHandlers(dispatch: (action: ShopPreviewAction) => void, itemId: string): {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onClick: () => void;
} {
  return {
    onMouseEnter: () => dispatch({ type: 'try', itemId }),
    onMouseLeave: () => dispatch({ type: 'leave' }),
    onFocus: () => dispatch({ type: 'try', itemId }),
    onBlur: () => dispatch({ type: 'leave' }),
    onClick: () => dispatch({ type: 'toggle', itemId }),
  };
}

export function CaracolShopDrawer({ state, open, tab, onTabChange, onClose, onPurchase, onEquip }: CaracolShopDrawerProps): JSX.Element {
  const [trial, dispatch] = useReducer(shopPreviewReducer, NO_PREVIEW);
  const [trialTab, setTrialTab] = useState(tab);
  // A aba é controlada pelo jogo, que também a troca ao abrir a loja: a prova cai
  // no mesmo render da troca, sem um quadro com a peça no outro personagem.
  if (trialTab !== tab) {
    setTrialTab(tab);
    dispatch({ type: 'tab' });
  }
  const wardrobe = tab === 'player' ? state.shop.player : state.shop.snail;
  const preview = shopPreview(wardrobe.outfit, state.shop.catalog.find((item) => item.id === trial.trying) ?? null);
  const title = tab === 'player' ? 'Seu guarda-roupa' : 'O guarda-roupa do caracol';
  const description = tab === 'player'
    ? 'Peças compradas ficam para sempre na sua conta.'
    : 'Este visual é global. Todo mundo vê a mesma roupa no mapa.';
  return <aside id="caracol-shop-drawer" className={`caracol-shop-drawer ${open ? 'is-open' : ''}`} aria-label="Loja de cosméticos" aria-hidden={!open}>
    <div className="caracol-shop-head">
      <div><span className="micro-label">Loja de cosméticos</span><h2>{title}</h2><p>{description}</p></div>
      <button className="caracol-history-close" type="button" onClick={onClose} aria-label="Fechar loja">×</button>
    </div>
    <div className="caracol-shop-tabs" role="tablist" aria-label="Guarda-roupa">
      <button type="button" role="tab" aria-selected={tab === 'player'} className={tab === 'player' ? 'active' : ''} onClick={() => onTabChange('player')}><CaracolMedallion wearer="player" outfit={state.shop.player.outfit} size={32} label="Seu personagem" /><span>Você</span></button>
      <button type="button" role="tab" aria-selected={tab === 'snail'} className={tab === 'snail' ? 'active' : ''} onClick={() => onTabChange('snail')}><CaracolMedallion wearer="snail" outfit={state.shop.snail.outfit} size={32} label="Caracol" /><span>Caracol</span></button>
    </div>
    <div className={`caracol-shop-preview paper-card ${trial.trying ? 'is-trying' : ''}`}>
      <span className="caracol-shop-preview-full"><CaracolFigure wearer={tab} outfit={preview.outfit} crop="full" sizePx={176} /></span>
      <CaracolMedallion wearer={tab} outfit={preview.outfit} size={112} label={tab === 'player' ? 'Seu personagem vestido' : 'Caracol vestido'} />
      <div><span className="micro-label">{preview.label}</span><strong>{tab === 'player' ? state.you.nickname : 'Caracol global'}</strong><p>{wardrobe.ownedItemIds.length} de {state.shop.catalog.length} peças desbloqueadas</p></div>
    </div>
    <div className="caracol-shop-body">
      {CARACOL_COSMETIC_SLOTS.map((slot) => {
        const items = state.shop.catalog.filter((item) => item.slot === slot);
        const equipped = wardrobe.outfit[slot];
        return <section className="caracol-shop-section" key={slot} aria-labelledby={`shop-slot-${slot}`}>
          <div className="caracol-shop-section-head"><div><span className="micro-label">Categoria</span><h3 id={`shop-slot-${slot}`}>{cosmeticSlotLabel(slot)}</h3></div>{equipped && <button className="shop-clear-button" type="button" onClick={() => onEquip(slot, null)}>Tirar</button>}</div>
          <div className="caracol-shop-grid">{items.map((item) => {
            const owned = wardrobe.ownedItemIds.includes(item.id);
            const isEquipped = equipped === item.id;
            const previewOutfit: CaracolOutfit = { ...wardrobe.outfit, [slot]: item.id };
            const { onClick: onTry, ...trialHandlers } = shopCardHandlers(dispatch, item.id);
            return <article className={`caracol-shop-item ${isEquipped ? 'is-equipped' : ''}`} key={item.id} {...trialHandlers}>
              <div className="caracol-shop-item-preview"><button type="button" className="caracol-shop-try" aria-pressed={trial.pinned && trial.trying === item.id} aria-label={`Provar ${item.name}`} onClick={onTry}><CaracolMedallion wearer={tab} outfit={previewOutfit} crop={slot} size={88} tone={caracolShopItemTone({ owned, equipped: isEquipped, coins: state.you.coins, price: item.price })} label={`${item.name} para ${tab === 'player' ? 'você' : 'o caracol'}`} /></button></div>
              <div className="caracol-shop-item-copy"><strong>{item.name}</strong><span>{owned ? isEquipped ? 'Equipado' : 'Desbloqueado' : `${item.price} moedas`}</span></div>
              {isEquipped ? <button className="shop-item-button is-equipped" type="button" disabled>Equipado</button> : owned ? <button className="shop-item-button" type="button" onClick={() => onEquip(slot, item.id)}>Usar</button> : <button className="shop-item-button shop-item-buy" type="button" onClick={() => onPurchase(item.id)} disabled={state.you.coins < item.price}>Comprar <span>{item.price}</span></button>}
            </article>;
          })}</div>
        </section>;
      })}
    </div>
  </aside>;
}

function cosmeticSlotLabel(slot: CaracolCosmeticSlot): string {
  const labels: Record<CaracolCosmeticSlot, string> = { pants: 'Calças', shirt: 'Camisas', watch: 'Relógios', glasses: 'Óculos', cap: 'Bonés' };
  return labels[slot];
}
