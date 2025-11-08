interface SokratLogoProps {
  className?: string;
}

const SokratLogo = ({ className = "" }: SokratLogoProps) => {
  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 80 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* First bubble (green with question mark) - student's question */}
      <g>
        <path
          d="M4 32C4 27.5817 7.58172 24 12 24H24C28.4183 24 32 27.5817 32 32V38C32 42.4183 28.4183 46 24 46H16L8 52V46C5.79086 46 4 44.2091 4 42V32Z"
          fill="#10b981"
          opacity="0.9"
        />
        {/* Question mark */}
        <text
          x="18"
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
          d="M36 14C36 9.58172 39.5817 6 44 6H56C60.4183 6 64 9.58172 64 14V20C64 24.4183 60.4183 28 56 28H48L40 34V28C37.7909 28 36 26.2091 36 24V14Z"
          fill="white"
          stroke="#10b981"
          strokeWidth="2"
        />
        {/* Lightbulb */}
        <g transform="translate(50, 12)">
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
