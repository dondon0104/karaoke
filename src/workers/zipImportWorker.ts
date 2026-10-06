import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';

const MEDIA_FILE_PATTERN = /\.(mp3|wav|ogg|m4a|aac|flac|mid|midi|kar|mp4|webm|mov|m4v)$/i;
const SOUNDFONT_FILE_PATTERN = /\.sf2$/i;
const BACKGROUND_VIDEO_FILE_PATTERN = /\.(mp4|webm|mov|m4v)$/i;

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

function reportError(message: string): void {
  if (failed) return;
  failed = true;
  workerScope.postMessage({ type: 'error', message });
}

function reportCompleteIfReady(): void {
  if (inputFinished && activeFiles.size === 0 && !failed) {
    workerScope.postMessage({ type: 'done', foundMedia, foundSoundFonts, foundBackgroundVideos });
  }
}

const unzip = new Unzip((file) => {
  if (file.name.endsWith('/')) return;
  const isSoundFont = SOUNDFONT_FILE_PATTERN.test(file.name);
  const isBackgroundVideo = isBackgroundVideoPath(file.name);
  if (!isSoundFont && !isBackgroundVideo && !MEDIA_FILE_PATTERN.test(file.name)) return;

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
      if (isSoundFont) foundSoundFonts += 1;
      else if (isBackgroundVideo) foundBackgroundVideos += 1;
      else foundMedia += 1;
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
