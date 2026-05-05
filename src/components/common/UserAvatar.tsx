import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type UserAvatarSize = "sm" | "md" | "lg";
type UserAvatarGender = "male" | "female" | null;

export interface UserAvatarProps {
  name?: string;
  avatarUrl?: string | null;
  gender?: UserAvatarGender;
  size?: UserAvatarSize;
  className?: string;
}

const sizeClasses: Record<UserAvatarSize, string> = {
  sm: "h-8 w-8 text-xs",
  md: "h-12 w-12 text-base",
  lg: "h-[120px] w-[120px] text-3xl",
};

const placeholderByGender: Record<Exclude<UserAvatarGender, null>, string> = {
  male: "/avatar-placeholder-male.svg",
  female: "/avatar-placeholder-female.svg",
};

function getInitials(name: string): string {
  const words = name.trim().match(/\p{L}+/gu) ?? [];

  if (words.length >= 2) {
    return words
      .slice(0, 2)
      .map((word) => String.fromCodePoint(word.codePointAt(0) ?? 0))
      .join("")
      .toLocaleUpperCase("ru-RU");
  }

  return Array.from(words[0] ?? "")
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase("ru-RU");
}

export function UserAvatar({
  name,
  avatarUrl,
  gender = null,
  size = "md",
  className,
}: UserAvatarProps) {
  const trimmedAvatarUrl = avatarUrl?.trim();
  const placeholderUrl = gender ? placeholderByGender[gender] : undefined;
  const imageUrl = trimmedAvatarUrl || placeholderUrl;
  const displayName = name?.trim() || "Пользователь";
  // Initials are derived from displayName (which has the "Пользователь"
  // fallback), guaranteeing a non-empty letter to render even when
  // `name` is missing AND no gender placeholder exists. Per ChatGPT-5.5
  // review ISSUE 2 — previously a missing name + missing gender produced
  // a blank green circle (AC-6 regression).
  const initials = getInitials(displayName);

  return (
    <Avatar className={cn(sizeClasses[size], "bg-socrat-surface", className)}>
      {imageUrl ? (
        <AvatarImage
          src={imageUrl}
          alt={displayName}
          loading="lazy"
          className="object-cover"
        />
      ) : null}
      <AvatarFallback
        className="select-none bg-accent text-center font-semibold leading-none text-white"
        aria-label={displayName}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

export default UserAvatar;
