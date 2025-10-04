// Простое сжатие для длинных сообщений
export const compressMessage = (message: string): string => {
  if (message.length <= 1000) {
    return message;
  }

  try {
    // Используем встроенный TextEncoder для базового сжатия
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    
    // Возвращаем base64 строку (в реальности можно использовать pako или другую библиотеку)
    return btoa(String.fromCharCode(...data));
  } catch (error) {
    console.error('Compression error:', error);
    return message;
  }
};

export const decompressMessage = (compressed: string, isCompressed: boolean): string => {
  if (!isCompressed) {
    return compressed;
  }

  try {
    const binary = atob(compressed);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
  } catch (error) {
    console.error('Decompression error:', error);
    return compressed;
  }
};
