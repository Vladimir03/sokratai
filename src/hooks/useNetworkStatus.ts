import { useState, useEffect } from 'react';

interface NetworkStatus {
  online: boolean;
  effectiveType: string;
  rtt: number; // Round trip time in ms
  quality: 'excellent' | 'good' | 'poor' | 'offline';
}

export const useNetworkStatus = () => {
  const [status, setStatus] = useState<NetworkStatus>({
    online: navigator.onLine,
    effectiveType: 'unknown',
    rtt: 0,
    quality: 'excellent',
  });

  useEffect(() => {
    const updateNetworkStatus = () => {
      const connection = (navigator as any).connection || 
                        (navigator as any).mozConnection || 
                        (navigator as any).webkitConnection;

      const online = navigator.onLine;
      let quality: NetworkStatus['quality'] = 'excellent';
      let rtt = 0;

      if (!online) {
        quality = 'offline';
      } else if (connection) {
        rtt = connection.rtt || 0;
        const effectiveType = connection.effectiveType || 'unknown';
        
        // Определяем качество соединения по RTT
        if (rtt > 500 || effectiveType === 'slow-2g' || effectiveType === '2g') {
          quality = 'poor';
        } else if (rtt > 200 || effectiveType === '3g') {
          quality = 'good';
        } else {
          quality = 'excellent';
        }

        setStatus({
          online,
          effectiveType,
          rtt,
          quality,
        });
      } else {
        // Если API недоступен, делаем простую проверку ping
        const startTime = Date.now();
        fetch('https://www.google.com/favicon.ico', { 
          mode: 'no-cors',
          cache: 'no-cache'
        })
          .then(() => {
            const pingTime = Date.now() - startTime;
            let quality: NetworkStatus['quality'];
            
            if (pingTime > 500) {
              quality = 'poor';
            } else if (pingTime > 200) {
              quality = 'good';
            } else {
              quality = 'excellent';
            }

            setStatus({
              online: true,
              effectiveType: 'unknown',
              rtt: pingTime,
              quality,
            });
          })
          .catch(() => {
            setStatus({
              online: false,
              effectiveType: 'unknown',
              rtt: 0,
              quality: 'offline',
            });
          });
      }
    };

    updateNetworkStatus();

    // Обновляем статус каждые 30 секунд
    const interval = setInterval(updateNetworkStatus, 30000);

    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);

    const connection = (navigator as any).connection;
    if (connection) {
      connection.addEventListener('change', updateNetworkStatus);
    }

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', updateNetworkStatus);
      window.removeEventListener('offline', updateNetworkStatus);
      if (connection) {
        connection.removeEventListener('change', updateNetworkStatus);
      }
    };
  }, []);

  return status;
};
