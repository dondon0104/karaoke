import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';

const MEDIA_FILE_PATTERN = /\.(mp3|wav|ogg|m4a|aac|flac|mid|midi|kar|mp4|webm|mov|m4v)$/i;
const SOUNDFONT_FILE_PATTERN = /\.sf2$/i;
const BACKGROUND_VIDEO_FILE_PATTERN = /\.(mp4|webm|mov|m4v)$/i;
const SHUBIDX_FILE_NAME = 'shubidx';

function readUtf8Character(bytes: Uint8Array, offset: number): { character: string; length: number } | null {
  const firstByte = bytes[offset];
  const length = firstByte >= 0xc2 && firstByte <= 0xdf ? 2
    : firstByte >= 0xe0 && firstByte <= 0xef ? 3
      : firstByte >= 0xf0 && firstByte <= 0xf4 ? 4
        : 0;
  if (!length || offset + length > bytes.length) return null;

  const secondByte = bytes[offset + 1];
  const validSecondByte = length === 2
    ? secondByte >= 0x80 && secondByte <= 0xbf
    : firstByte === 0xe0
      ? secondByte >= 0xa0 && secondByte <= 0xbf
      : firstByte === 0xed
        ? secondByte >= 0x80 && secondByte <= 0x9f
        : firstByte === 0xf0
          ? secondByte >= 0x90 && secondByte <= 0xbf
          : firstByte === 0xf4
            ? secondByte >= 0x80 && secondByte <= 0x8f
            : secondByte >= 0x80 && secondByte <= 0xbf;
  if (!validSecondByte) return null;
  for (let index = 2; index < length; index += 1) {
    if (bytes[offset + index] < 0x80 || bytes[offset + index] > 0xbf) return null;
  }

  const character = new TextDecoder().decode(bytes.subarray(offset, offset + length));
  return /[\p{L}\p{N}\p{M}\p{P}\p{S}]/u.test(character) ? { character, length } : null;
}

function parseShubidxTitles(chunks: SongChunk[]): string[] {
  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), offset);
    offset += chunk.byteLength;
  });

  const titleMarker = new TextEncoder().encode('_all in the Family_');
  let titleSectionStart = -1;
  for (let index = 0; index <= bytes.length - titleMarker.length; index += 1) {
    if (titleMarker.every((value, markerIndex) => bytes[index + markerIndex] === value)) {
      titleSectionStart = index;
      break;
    }
  }
  if (titleSectionStart < 0) {
    throw new Error('Hindi nakilala ang song-title section sa shubidx. Walang na-import na catalog titles.');
  }

  const titles = new Set<string>();
  const seenTitles = new Set<string>();
  let candidate = '';
  const addCandidate = () => {
    const title = candidate.trim().replace(/^_+|_+$/g, '').trim();
    candidate = '';
    if (title.length < 3 || title.length > 120 || !/[\p{L}\p{N}]/u.test(title)) return;
    const key = title.toLocaleLowerCase();
    if (seenTitles.has(key)) return;
    seenTitles.add(key);
    titles.add(title);
  };

  for (let index = titleSectionStart; index < bytes.length;) {
    const firstByte = bytes[index];
    if (firstByte >= 0x20 && firstByte <= 0x7e) {
      candidate += String.fromCharCode(firstByte);
      index += 1;
      continue;
    }

    const unicodeCharacter = readUtf8Character(bytes, index);
    if (unicodeCharacter) {
      candidate += unicodeCharacter.character;
      index += unicodeCharacter.length;
      continue;
    }

    addCandidate();
    index += 1;
  }
  addCandidate();
  if (!titles.size) {
    throw new Error('Walang nabasang song titles sa shubidx catalog.');
  }
  return [...titles];
}

function isBackgroundVideoPath(fileName: string): boolean {
  const pathParts = fileName.split(/[\\/]/);
  return pathParts.some((part) => part.toLocaleLowerCase() === 'bgv')
    && BACKGROUND_VIDEO_FILE_PATTERN.test(fileName);
}

interface ZipChunkMessage {
  type: 'chunk';
  chunk: ArrayBuffer;
  loaded: number;
  total: number;
}

interface ZipEndMessage {
  type: 'end';
}

type ZipInputMessage = ZipChunkMessage | ZipEndMessage;

interface WorkerScope {
  onmessage: ((event: MessageEvent<ZipInputMessage>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

interface SongChunk {
  buffer: ArrayBuffer;
  byteOffset: number;
  byteLength: number;
}

const workerScope = self as unknown as WorkerScope;
const activeFiles = new Set<string>();
let inputFinished = false;
let failed = false;
let foundMedia = 0;
let foundSoundFonts = 0;
let foundBackgroundVideos = 0;
let foundCatalogTitles = 0;

function reportError(message: string): void {
  if (failed) return;
  failed = true;
  workerScope.postMessage({ type: 'error', message });
}

function reportCompleteIfReady(): void {
  if (inputFinished && activeFiles.size === 0 && !failed) {
    workerScope.postMessage({ type: 'done', foundMedia, foundSoundFonts, foundBackgroundVideos, foundCatalogTitles });
  }
}

const unzip = new Unzip((file) => {
  if (file.name.endsWith('/')) return;
  const isShubidx = file.name.split(/[\\/]/).pop()?.toLocaleLowerCase() === SHUBIDX_FILE_NAME;
  const isSoundFont = SOUNDFONT_FILE_PATTERN.test(file.name);
  const isBackgroundVideo = isBackgroundVideoPath(file.name);
  if (!isShubidx && !isSoundFont && !isBackgroundVideo && !MEDIA_FILE_PATTERN.test(file.name)) return;

  activeFiles.add(file.name);
  const chunks: SongChunk[] = [];
  const transferables = new Set<ArrayBuffer>();
  file.ondata = (error, chunk, final) => {
    if (error) {
      reportError(`Hindi ma-unzip ang ${file.name}: ${error.message}`);
      return;
    }

    if (chunk.length) {
      const buffer = chunk.buffer as ArrayBuffer;
      chunks.push({
        buffer,
        byteOffset: chunk.byteOffset,
        byteLength: chunk.byteLength,
      });
      transferables.add(buffer);
    }

    if (!final) return;
    activeFiles.delete(file.name);
    if (chunks.length) {
      if (isShubidx) {
        try {
          const titles = parseShubidxTitles(chunks);
          foundCatalogTitles = titles.length;
          workerScope.postMessage({ type: 'catalog-titles', titles });
        } catch (parseError: unknown) {
          reportError(parseError instanceof Error ? parseError.message : `Hindi mabasa ang song-title catalog na ${file.name}.`);
          return;
        }
      } else if (isSoundFont) foundSoundFonts += 1;
      else if (isBackgroundVideo) foundBackgroundVideos += 1;
      else foundMedia += 1;
      if (isShubidx) {
        reportCompleteIfReady();
        return;
      }
      try {
        workerScope.postMessage({
          type: isSoundFont ? 'soundfont' : isBackgroundVideo ? 'background' : 'song',
          fileName: file.name,
          chunks,
        }, [...transferables]);
      } catch (error: unknown) {
        reportError(error instanceof Error ? `Hindi maipadala ang ${file.name}: ${error.message}` : `Hindi maipadala ang ${file.name}.`);
        return;
      }
    }
    reportCompleteIfReady();
  };

  try {
    file.start();
  } catch (error: unknown) {
    reportError(error instanceof Error ? `Hindi mabasa ang ${file.name}: ${error.message}` : `Hindi mabasa ang ${file.name}.`);
  }
});

unzip.register(UnzipPassThrough);
unzip.register(UnzipInflate);

workerScope.onmessage = (event: MessageEvent<ZipInputMessage>) => {
  if (failed) return;
  if (event.data.type === 'end') {
    inputFinished = true;
    reportCompleteIfReady();
    return;
  }

  try {
    unzip.push(new Uint8Array(event.data.chunk), false);
    workerScope.postMessage({
      type: 'progress',
      loaded: event.data.loaded,
      total: event.data.total,
    });
  } catch (error: unknown) {
    reportError(error instanceof Error ? `Hindi mabasa ang ZIP file: ${error.message}` : 'Hindi mabasa ang ZIP file.');
  }
};
