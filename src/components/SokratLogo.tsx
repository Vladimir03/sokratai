interface SokratLogoProps {
  className?: string;
}

const SokratLogo = ({ className = "" }: SokratLogoProps) => {
  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* First bubble (green with question mark) - student's question */}
      <g>
        <path
          d="M12 32C12 27.5817 15.5817 24 20 24H32C36.4183 24 40 27.5817 40 32V38C40 42.4183 36.4183 46 32 46H24L16 52V46C13.7909 46 12 44.2091 12 42V32Z"
          fill="#10b981"
          opacity="0.9"
        />
        {/* Question mark */}
        <text
          x="26"
          y="40"
          fontSize="18"
          fontWeight="bold"
          fill="white"
          textAnchor="middle"
        >
          ?
        </text>
      </g>

      {/* Second bubble (white with lightbulb) - insight/understanding */}
      <g>
        <path
          d="M24 14C24 9.58172 27.5817 6 32 6H44C48.4183 6 52 9.58172 52 14V20C52 24.4183 48.4183 28 44 28H36L28 34V28C25.7909 28 24 26.2091 24 24V14Z"
          fill="white"
          stroke="#10b981"
          strokeWidth="2"
        />
        {/* Lightbulb */}
        <g transform="translate(38, 12)">
          <path
            d="M0 4C0 1.79086 1.79086 0 4 0C6.20914 0 8 1.79086 8 4C8 5.86384 6.72864 7.42994 5 7.87398V9C5 9.55228 4.55228 10 4 10C3.44772 10 3 9.55228 3 9V7.87398C1.27136 7.42994 0 5.86384 0 4Z"
            fill="#fbbf24"
          />
          <path
            d="M3 11H5V12H3V11Z"
            fill="#fbbf24"
          />
        </g>
      </g>
    </svg>
  );
};

export default SokratLogo;
