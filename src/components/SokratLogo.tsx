import sokratLogo from "@/assets/sokrat-logo.png";

interface SokratLogoProps {
  className?: string;
}

const SokratLogo = ({ className = "" }: SokratLogoProps) => {
  return (
    <img
      src={sokratLogo}
      alt="Сократ AI"
      className={className}
    />
  );
};

export default SokratLogo;
