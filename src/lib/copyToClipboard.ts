/**
 * Копирование в буфер: primary `navigator.clipboard` (только secure context) +
 * fallback через скрытый textarea + `document.execCommand('copy')` — НЕ удалять
 * fallback (http preview / Safari < 15.4, паттерн ShareLinkDialog/TutorHomeworkPreview).
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // падаем в fallback
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
