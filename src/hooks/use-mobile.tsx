import * as React from "react";

const MOBILE_BREAKPOINT = 768;

// Device detection utilities
export const isIOS = () => {
  if (typeof window === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

export const isAndroid = () => {
  if (typeof window === 'undefined') return false;
  return /Android/.test(navigator.userAgent);
};

export const isMobileDevice = () => {
  if (typeof window === 'undefined') return false;
  return isIOS() || isAndroid() || /Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

// Hook to detect device type
export function useDeviceType() {
  const [deviceType, setDeviceType] = React.useState<'ios' | 'android' | 'desktop'>('desktop');

  React.useEffect(() => {
    if (isIOS()) {
      setDeviceType('ios');
    } else if (isAndroid()) {
      setDeviceType('android');
    } else {
      setDeviceType('desktop');
    }
  }, []);

  return deviceType;
}
