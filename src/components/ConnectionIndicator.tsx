import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { Wifi, WifiOff } from "lucide-react";

const ConnectionIndicator = () => {
  const { quality, rtt, online } = useNetworkStatus();

  const getIndicatorColor = () => {
    switch (quality) {
      case 'excellent':
        return 'text-green-500';
      case 'good':
        return 'text-yellow-500';
      case 'poor':
        return 'text-orange-500';
      case 'offline':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  const getQualityText = () => {
    switch (quality) {
      case 'excellent':
        return 'Отличное';
      case 'good':
        return 'Хорошее';
      case 'poor':
        return 'Слабое';
      case 'offline':
        return 'Оффлайн';
      default:
        return 'Неизвестно';
    }
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      {online ? (
        <Wifi className={`w-4 h-4 ${getIndicatorColor()}`} />
      ) : (
        <WifiOff className="w-4 h-4 text-red-500" />
      )}
      <span className={`${getIndicatorColor()}`}>
        {getQualityText()}
        {rtt > 0 && ` (${rtt}ms)`}
      </span>
    </div>
  );
};

export default ConnectionIndicator;
