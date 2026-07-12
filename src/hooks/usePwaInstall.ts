import { useSyncExternalStore } from 'react';
import {
  getInstallCapability,
  subscribeInstallState,
  type InstallCapability,
} from '@/lib/pwaInstall';

/** Реактивная capability установки PWA (обновляется при beforeinstallprompt/appinstalled). */
export function usePwaInstall(): InstallCapability {
  return useSyncExternalStore(subscribeInstallState, getInstallCapability, () => 'unsupported');
}
