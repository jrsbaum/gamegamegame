import type { ServerPlayer } from './network';

export type PostAuthScreen = 'confirm' | 'onboarding' | 'game';

type OnboardingProfile = Pick<ServerPlayer, 'name' | 'farmName' | 'specialization'> & {
  homeRegionId?: string | null;
  plot?: Pick<NonNullable<ServerPlayer['plot']>, 'id'> | null;
};

export function resolvePostAuthScreen(mode: 'login' | 'create', player: OnboardingProfile): PostAuthScreen {
  if (mode === 'create') return 'confirm';

  const hasHome = Boolean(player.homeRegionId?.trim() || player.plot?.id.trim());
  const hasIdentity = Boolean(player.name.trim() && player.farmName.trim());
  return hasHome && Boolean(player.specialization) && hasIdentity ? 'game' : 'onboarding';
}
