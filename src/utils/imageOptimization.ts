/**
 * Image optimization utilities for responsive images
 */

const MAX_WIDTH = 1024;
const MAX_HEIGHT = 1024;
const QUALITY = 0.85;

/**
 * Compress and resize image before upload
 */
export async function optimizeImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Canvas context not available'));
      return;
    }

    img.onload = () => {
      let { width, height } = img;

      // Calculate new dimensions maintaining aspect ratio
      if (width > MAX_WIDTH || height > MAX_HEIGHT) {
        const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
        width *= ratio;
        height *= ratio;
      }

      canvas.width = width;
      canvas.height = height;

      // Draw and compress
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to compress image'));
          }
        },
        'image/webp',
        QUALITY
      );
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Generate multiple sizes for an image
 */
export async function generateImageSizes(file: File): Promise<{
  original: Blob;
  sizes: { width: number; blob: Blob }[];
}> {
  const sizes = [320, 640, 1024];
  const results: { width: number; blob: Blob }[] = [];

  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });

  for (const targetWidth of sizes) {
    if (img.width < targetWidth) continue; // Skip if original is smaller

    const blob = await resizeImageToWidth(img, targetWidth);
    results.push({ width: targetWidth, blob });
  }

  // Also create optimized original
  const original = await optimizeImage(file);

  return { original, sizes: results };
}

/**
 * Resize image to specific width
 */
async function resizeImageToWidth(img: HTMLImageElement, targetWidth: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Canvas context not available'));
      return;
    }

    const ratio = targetWidth / img.width;
    const targetHeight = img.height * ratio;

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to resize image'));
        }
      },
      'image/webp',
      QUALITY
    );
  });
}

/**
 * Check if browser supports WebP
 */
export function supportsWebP(): Promise<boolean> {
  return new Promise((resolve) => {
    const webP = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=';
    const img = new Image();
    img.onload = () => resolve(img.width === 1);
    img.onerror = () => resolve(false);
    img.src = webP;
  });
}
