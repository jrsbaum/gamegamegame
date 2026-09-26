import { describe, expect, it } from 'vitest';
import { resolvePostAuthScreen } from '../apps/web/src/auth-flow';

const completedProfile = {
  name: 'Jasmim',
  farmName: 'Vale Jasmim',
  specialization: 'fruits' as const,
  homeRegionId: null,
  plot: { id: 'plot-jasmim' }
};

describe('LaFarmer post-auth routing', () => {
  it('sends a completed account straight to the game after login', () => {
    expect(resolvePostAuthScreen('login', completedProfile)).toBe('game');
  });

  it('sends an incomplete existing account to onboarding', () => {
    expect(resolvePostAuthScreen('login', { ...completedProfile, specialization: null })).toBe('onboarding');
  });

  it('asks newly created accounts to confirm saved credentials', () => {
    expect(resolvePostAuthScreen('create', { ...completedProfile, specialization: null })).toBe('confirm');
  });
});
