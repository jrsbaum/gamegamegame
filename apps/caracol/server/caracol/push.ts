import webpush from 'web-push';
import type { CaracolNoticePayload } from '../../shared/caracol';
import type { CaracolPushRecord } from './store';

/** Sem prazo, o `web-push` espera o TCP desistir, o que leva minutos num endpoint pendurado. */
const PUSH_TIMEOUT_MS = 5_000;

export interface CaracolPushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
  data: CaracolNoticePayload;
}

export class CaracolPushService {
  private readonly publicKey: string | null;
  private readonly configured: boolean;

  constructor(
    private readonly removeSubscription: (endpoint: string) => Promise<void>,
    private readonly subject = process.env.CARACOL_VAPID_SUBJECT || 'mailto:caracol@gamegamegame.site',
  ) {
    const publicKey = process.env.CARACOL_VAPID_PUBLIC_KEY?.trim();
    const privateKey = process.env.CARACOL_VAPID_PRIVATE_KEY?.trim();
    this.configured = Boolean(publicKey && privateKey);
    this.publicKey = publicKey || null;
    if (this.configured) {
      webpush.setVapidDetails(this.subject, publicKey!, privateKey!);
    }
  }

  getPublicKey(): string | null {
    return this.publicKey;
  }

  async send(accountId: string, subscriptions: CaracolPushRecord[], payload: CaracolPushPayload): Promise<void> {
    if (!this.configured) return;
    const targets = subscriptions.filter((subscription) => subscription.accountId === accountId);
    await Promise.all(targets.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            expirationTime: subscription.expirationTime,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
          { timeout: PUSH_TIMEOUT_MS },
        );
      } catch (error) {
        const statusCode = error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : null;
        if (statusCode === 404 || statusCode === 410) {
          await this.removeSubscription(subscription.endpoint);
        } else {
          console.warn(`[caracol] falha ao enviar Push (${statusCode ?? 'sem status'}).`);
        }
      }
    }));
  }
}
