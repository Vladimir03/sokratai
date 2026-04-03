interface SokratLogoProps {
  className?: string;
}

const SokratLogo = ({ className = "" }: SokratLogoProps) => {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Green circle background */}
      <circle cx="50" cy="50" r="50" className="fill-accent" />

      {/* Top-left bubble (question) — larger */}
      <path
        d="M18 22 Q18 14 26 14 L48 14 Q56 14 56 22 L56 38 Q56 46 48 46 L34 46 L24 54 L24 46 Q18 46 18 38 Z"
        fill="white"
      />
      {/* Question mark */}
      <text
        x="37"
        y="37"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="22"
        fontWeight="bold"
        className="fill-accent"
        textAnchor="middle"
      >
        ?
      </text>

      {/* Curved arrow from question to insight */}
      <path
        d="M54 38 C62 42 66 48 64 56"
        stroke="white"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        opacity="0.7"
      />
      {/* Arrow head */}
      <path
        d="M60 54 L64 57 L67 52"
        stroke="white"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.7"
      />

      {/* Bottom-right bubble (insight/lightbulb) — slightly smaller */}
      <path
        d="M42 56 Q42 48 50 48 L74 48 Q82 48 82 56 L82 72 Q82 80 74 80 L60 80 L70 88 L50 80 Q42 80 42 72 Z"
        fill="white"
      />

      {/* Lightbulb icon */}
      <g transform="translate(62, 56)">
        {/* Bulb */}
        <circle cx="0" cy="0" r="8" fill="none" stroke="#E8913A" strokeWidth="2" />
        {/* Filament */}
        <path
          d="M-3 0 C-2 -5 2 -5 3 0"
          fill="none"
          stroke="#E8913A"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {/* Base */}
        <line x1="-3" y1="7" x2="3" y2="7" stroke="#E8913A" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="-2" y1="9.5" x2="2" y2="9.5" stroke="#E8913A" strokeWidth="1.5" strokeLinecap="round" />
        {/* Rays */}
        <line x1="0" y1="-12" x2="0" y2="-15" stroke="#E8913A" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="9" y1="-6" x2="12" y2="-8" stroke="#E8913A" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="-9" y1="-6" x2="-12" y2="-8" stroke="#E8913A" strokeWidth="1.5" strokeLinecap="round" />
      </g>
    </svg>
  );
};

export default SokratLogo;
