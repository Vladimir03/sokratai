import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface BackButtonProps {
  onClick?: () => void;
}

/**
 * Telegram back button wrapper component
 */
export function BackButton({ onClick }: BackButtonProps) {
  const navigate = useNavigate();

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    const handleBack = () => {
      if (onClick) {
        onClick();
      } else {
        navigate(-1);
      }
    };

    tg.BackButton.onClick(handleBack);
    tg.BackButton.show();

    return () => {
      tg.BackButton.offClick(handleBack);
      tg.BackButton.hide();
    };
  }, [navigate, onClick]);

  return null;
}
