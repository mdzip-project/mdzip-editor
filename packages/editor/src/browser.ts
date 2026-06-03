export interface ClipboardImagePayload {
  bytes: Uint8Array;
  mimeType: string;
}

export function browserClipboardHasImage(clipboard: DataTransfer | null): boolean {
  if (!clipboard) {
    return false;
  }

  if (Array.from(clipboard.files || []).some((file) => isBrowserImageFile(file))) {
    return true;
  }

  if (Array.from(clipboard.items || []).some((item) => item.type.startsWith('image/'))) {
    return true;
  }

  return extractDataUrlFromClipboardData(clipboard) !== null;
}

export async function readBrowserClipboardImage(
  clipboard: DataTransfer | null
): Promise<ClipboardImagePayload | null> {
  if (clipboard) {
    const fileFromFiles = Array.from(clipboard.files || []).find((file) => isBrowserImageFile(file));
    if (fileFromFiles) {
      return {
        bytes: new Uint8Array(await fileFromFiles.arrayBuffer()),
        mimeType: fileFromFiles.type || 'image/png'
      };
    }

    for (const item of Array.from(clipboard.items || [])) {
      const file = item.kind === 'file' || item.type.startsWith('image/') ? item.getAsFile() : null;
      if (isBrowserImageFile(file)) {
        return {
          bytes: new Uint8Array(await file.arrayBuffer()),
          mimeType: file.type || item.type || `image/${imageExtensionFromFileName(file.name)}`
        };
      }
    }

    const dataUrl = extractDataUrlFromClipboardData(clipboard);
    if (dataUrl) {
      return {
        bytes: bytesFromDataUrl(dataUrl),
        mimeType: mimeTypeFromDataUrl(dataUrl)
      };
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.read === 'function') {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const clipboardItem of clipboardItems) {
        const imageType = clipboardItem.types.find((type) => type.startsWith('image/'));
        if (!imageType) {
          continue;
        }
        const blob = await clipboardItem.getType(imageType);
        return {
          bytes: new Uint8Array(await blob.arrayBuffer()),
          mimeType: imageType
        };
      }
    } catch {
      // Normal paste should continue when async clipboard access is blocked.
    }
  }

  return null;
}

function isBrowserImageFile(file: File | null | undefined): file is File {
  if (!file) {
    return false;
  }
  if (file.type.startsWith('image/')) {
    return true;
  }
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
}

function extractDataUrlFromClipboardData(clipboard: DataTransfer): string | null {
  const html = clipboard.getData('text/html');
  if (html) {
    const htmlMatch = html.match(/src=["'](data:image\/[a-zA-Z0-9.+-]+;base64,[^"']+)["']/i);
    if (htmlMatch?.[1]) {
      return htmlMatch[1];
    }
  }

  const text = clipboard.getData('text/plain');
  if (text && /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(text.trim())) {
    return text.trim();
  }

  return null;
}

function bytesFromDataUrl(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function mimeTypeFromDataUrl(dataUrl: string): string {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/i);
  return match?.[1]?.toLowerCase() ?? 'image/png';
}

function imageExtensionFromFileName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'jpeg';
  if (lower.endsWith('.gif')) return 'gif';
  if (lower.endsWith('.webp')) return 'webp';
  if (lower.endsWith('.svg')) return 'svg+xml';
  return 'png';
}
