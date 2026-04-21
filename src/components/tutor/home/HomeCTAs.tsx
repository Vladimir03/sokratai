import { memo, type KeyboardEvent } from 'react';
import { ArrowRight, ClipboardPlus, Wallet } from 'lucide-react';

export interface HomeCTAsProps {
  onAssignHomework: () => void;
  onAddPayment: () => void;
  paymentSummary: {
    pending: number;
    overdue: number;
  };
}

interface CTAProps {
  title: string;
  sub: string;
  icon: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
}

const HomeCTA = memo(function HomeCTA({
  title,
  sub,
  icon,
  onClick,
  ariaLabel,
}: CTAProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <button
      type="button"
      className="home-cta"
      onClick={onClick}
      onKeyDown={handleKeyDown}
      aria-label={ariaLabel}
      style={{ touchAction: 'manipulation' }}
    >
      <span className="home-cta__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="home-cta__body">
        <span className="home-cta__title">{title}</span>
        <span className="home-cta__sub">{sub}</span>
      </span>
      <ArrowRight
        size={16}
        aria-hidden="true"
        style={{ color: 'var(--sokrat-fg3)', flex: 'none' }}
      />
    </button>
  );
});

function HomeCTAsImpl({
  onAssignHomework,
  onAddPayment,
  paymentSummary,
}: HomeCTAsProps) {
  const paymentSub =
    `${paymentSummary.pending} ждёт оплаты · ${paymentSummary.overdue} долг`;

  return (
    <div className="home-ctas">
      <HomeCTA
        title="Назначить ДЗ"
        sub="Из базы или по теме"
        icon={<ClipboardPlus size={18} aria-hidden="true" />}
        onClick={onAssignHomework}
        ariaLabel="Назначить домашнее задание"
      />
      <HomeCTA
        title="Выставить счёт"
        sub={paymentSub}
        icon={<Wallet size={18} aria-hidden="true" />}
        onClick={onAddPayment}
        ariaLabel="Выставить счёт"
      />
    </div>
  );
}

export const HomeCTAs = memo(HomeCTAsImpl);
