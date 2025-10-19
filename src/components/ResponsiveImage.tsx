import { useState } from 'react';
import { cn } from '@/lib/utils';

interface ResponsiveImageProps {
  src: string;
  alt: string;
  className?: string;
  onClick?: () => void;
  priority?: boolean;
  sizes?: string;
}

export function ResponsiveImage({
  src,
  alt,
  className,
  onClick,
  priority = false,
  sizes = "(max-width: 768px) 100vw, 50vw"
}: ResponsiveImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Generate responsive URLs based on the original URL
  const getResponsiveUrls = (url: string) => {
    // If it's a Supabase storage URL, generate multiple sizes
    if (url.includes('supabase')) {
      const baseUrl = url.split('?')[0];
      return {
        mobile320: `${baseUrl}?width=320&quality=80`,
        mobile640: `${baseUrl}?width=640&quality=80`,
        desktop1024: `${baseUrl}?width=1024&quality=85`,
        desktop1920: `${baseUrl}?width=1920&quality=85`,
        thumbnail: `${baseUrl}?width=32&quality=40&blur=10`
      };
    }
    return null;
  };

  const urls = getResponsiveUrls(src);

  if (hasError) {
    return (
      <div className={cn("bg-muted flex items-center justify-center text-muted-foreground", className)}>
        Изображение недоступно
      </div>
    );
  }

  if (!urls) {
    // Fallback for non-Supabase images
    return (
      <img
        src={src}
        alt={alt}
        className={className}
        onClick={onClick}
        loading={priority ? "eager" : "lazy"}
        onError={() => setHasError(true)}
      />
    );
  }

  return (
    <div className="relative">
      {/* LQIP - Low Quality Image Placeholder */}
      {!isLoaded && (
        <img
          src={urls.thumbnail}
          alt=""
          className={cn("absolute inset-0 blur-md scale-110", className)}
          aria-hidden="true"
        />
      )}
      
      {/* Main responsive image */}
      <picture>
        <source
          media="(max-width: 768px)"
          srcSet={`${urls.mobile320} 320w, ${urls.mobile640} 640w`}
          sizes={sizes}
          type="image/webp"
        />
        <source
          media="(min-width: 769px)"
          srcSet={`${urls.desktop1024} 1024w, ${urls.desktop1920} 1920w`}
          sizes={sizes}
          type="image/webp"
        />
        <img
          src={urls.mobile640}
          alt={alt}
          className={cn(
            "transition-opacity duration-300",
            isLoaded ? "opacity-100" : "opacity-0",
            className
          )}
          onClick={onClick}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
        />
      </picture>
    </div>
  );
}
