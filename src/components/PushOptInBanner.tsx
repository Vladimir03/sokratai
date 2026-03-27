import { useState, useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isPushSupported, subscribeToPush } from '@/lib/pushApi';

const DISMISS_KEY = 'push_banner_dismissed';
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isDismissedRecently(): boolean {
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const ts = parseInt(raw, 10);
  if (isNaN(ts)) return false;
  return Date.now() - ts < DISMISS_DURATION_MS;
}

function shouldShowBanner(): boolean {
  if (!isPushSupported()) return false;
  if (Notification.permission !== 'default') return false;
  if (isDismissedRecently()) return false;
  return true;
}

export default function PushOptInBanner() {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setVisible(shouldShowBanner());
  }, []);

  if (!visible) return null;

  const handleEnable = async () => {
    setLoading(true);
    try {
      const success = await subscribeToPush();
      if (success) {
        setVisible(false);
        return;
      }
      // Permission denied → hide permanently (re-asking is blocked by browser)
      if (Notification.permission === 'denied') {
        setVisible(false);
        return;
      }
      // Other failure (network, missing VAPID, etc.) → keep banner visible
    } catch {
      // subscribeToPush logs internally
    }
    setLoading(false);
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
    setVisible(false);
  };

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 md:p-4 flex items-center gap-3 transition-all duration-300">
      <Bell className="h-5 w-5 text-amber-600 shrink-0" />

      <p className="text-sm md:text-base text-amber-900 flex-1 min-w-0">
        Включите уведомления, чтобы не пропустить ДЗ
      </p>

      <Button
        disabled={loading}
        onClick={handleEnable}
        className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white text-base h-9 px-3 md:h-10 md:px-4"
        style={{ touchAction: 'manipulation' }}
      >
        {loading ? '...' : 'Включить'}
      </Button>

      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Закрыть"
        className="shrink-0 p-1 text-amber-500 hover:text-amber-700 transition-colors"
        style={{ touchAction: 'manipulation' }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
