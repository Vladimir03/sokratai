import { useYandexMetrika } from "@/hooks/useYandexMetrika";

/**
 * Component to track analytics - should be inside BrowserRouter
 * Separated into its own file to enable lazy loading
 */
const AnalyticsTracker = () => {
  useYandexMetrika();
  return null;
};

export default AnalyticsTracker;
