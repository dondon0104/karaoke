import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { IonPage } from '@ionic/react';
import { Midi } from '@tonejs/midi';
import { parseMidi } from 'midi-file';
import type { MidiEvent } from 'midi-file';
import { WorkletSynthesizer } from 'spessasynth_lib';
import soundFontProcessorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import './Home.css';

interface Song {
  id: string;
  title: string;
  artist: string;
  fileName: string;
  fileType: string;
  file: Blob;
}

interface CatalogTitleCollection {
  id: 'shubidx';
  titles: string[];
}

interface MidiNote {
  time: number;
  duration: number;
  midi: number;
  velocity: number;
  program: number;
}

interface MidiLyric {
  time: number;
  text: string;
  parts: Array<{ time: number; start: number; length: number }>;
}

type MidiPlaybackEvent =
  | { time: number; type: 'noteOn' | 'noteOff'; channel: number; note: number; velocity: number }
  | { time: number; type: 'programChange'; channel: number; program: number }
  | { time: number; type: 'controller'; channel: number; controller: number; value: number }
  | { time: number; type: 'pitchBend'; channel: number; value: number };

interface MidiSongData {
  songId: string;
  notes: MidiNote[];
  lyrics: MidiLyric[];
  events: MidiPlaybackEvent[];
  duration: number;
}

interface SoundFontData {
  id: string;
  fileName: string;
  buffer: ArrayBuffer;
}

interface SoundFontLoadResult {
  soundFonts: SoundFontData[];
  soundFont: SoundFontData | null;
  needsReimport: boolean;
}

interface BackgroundVideo {
  id: string;
  fileName: string;
  buffer: ArrayBuffer;
}

const DATABASE_NAME = 'home-karaoke-library';
const STORE_NAME = 'songs';
const SOUND_FONT_STORE_NAME = 'soundfonts';
const ACTIVE_SOUND_FONT_KEY = 'home-karaoke-active-soundfont';
const BACKGROUND_VIDEO_STORE_NAME = 'backgroundVideos';
const CATALOG_TITLE_STORE_NAME = 'catalogTitles';
const FORMAT_PATTERN = /\.(mp3|wav|ogg|m4a|aac|flac|mid|midi|kar|sf2|mp4|webm|mov|m4v)$/i;
const MIME_TYPES: Record<string, string> = {
  aac: 'audio/aac',
  flac: 'audio/flac',
  kar: 'audio/midi',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  mid: 'audio/midi',
  midi: 'audio/midi',
  ogg: 'audio/ogg',
  sf2: 'application/octet-stream',
  wav: 'audio/wav',
  webm: 'video/webm',
};

function openSongDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 5);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!request.result.objectStoreNames.contains(SOUND_FONT_STORE_NAME)) {
        request.result.createObjectStore(SOUND_FONT_STORE_NAME, { keyPath: 'id' });
      }
      if (!request.result.objectStoreNames.contains(BACKGROUND_VIDEO_STORE_NAME)) {
        request.result.createObjectStore(BACKGROUND_VIDEO_STORE_NAME, { keyPath: 'id' });
      }
      if (!request.result.objectStoreNames.contains(CATALOG_TITLE_STORE_NAME)) {
        request.result.createObjectStore(CATALOG_TITLE_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Hindi mabuksan ang song library.'));
    request.onblocked = () => reject(new Error('Isara muna ang ibang tab na gumagamit ng song library.'));
  });
}

function getSoundFontId(fileName: string, size: number): string {
  return `sf2:${fileName.toLocaleLowerCase()}:${size}`;
}

async function readSoundFont(): Promise<SoundFontLoadResult> {
  const database = await openSongDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SOUND_FONT_STORE_NAME, 'readonly');
    const request = transaction.objectStore(SOUND_FONT_STORE_NAME).getAll();
    request.onsuccess = () => {
      const records = request.result as SoundFontData[];
      const soundFonts = records.filter((record) => record.buffer instanceof ArrayBuffer);
      let selectedId: string | null = null;
      try {
        selectedId = localStorage.getItem(ACTIVE_SOUND_FONT_KEY);
      } catch {
        selectedId = null;
      }
      const soundFont = soundFonts.find((record) => record.id === selectedId) ?? soundFonts[0] ?? null;
      resolve({
        soundFonts,
        soundFont,
        needsReimport: records.some((record) => !(record.buffer instanceof ArrayBuffer)),
      });
    };
    request.onerror = () => reject(request.error ?? new Error('Hindi mabasa ang naka-save na SoundFont.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('May problema sa naka-save na SoundFont.'));
    };
  });
}

async function saveSoundFont(soundFont: SoundFontData): Promise<void> {
  const database = await openSongDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SOUND_FONT_STORE_NAME, 'readwrite');
    transaction.objectStore(SOUND_FONT_STORE_NAME).put(soundFont);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error(`Hindi na-save ang SoundFont na ${soundFont.fileName}.`));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error(`Hindi na-save ang SoundFont na ${soundFont.fileName}.`));
    };
  });
}

async function deleteSoundFont(id: string): Promise<void> {
  const database = await openSongDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SOUND_FONT_STORE_NAME, 'readwrite');
    transaction.objectStore(SOUND_FONT_STORE_NAME).delete(id);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('Hindi maalis ang SoundFont.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error('Hindi maalis ang SoundFont.'));
    };
  });
}

async function readBackgroundVideos(): Promise<BackgroundVideo[]> {
  const database = await openSongDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(BACKGROUND_VIDEO_STORE_NAME, 'readonly');
    const request = transaction.objectStore(BACKGROUND_VIDEO_STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as BackgroundVideo[]);
    request.onerror = () => reject(request.error ?? new Error('Hindi mabasa ang mga background video.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('May problema sa mga background video.'));
    };
  });
}

async function saveBackgroundVideo(video: BackgroundVideo): Promise<void> {
  const database = await openSongDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(BACKGROUND_VIDEO_STORE_NAME, 'readwrite');
    transaction.objectStore(BACKGROUND_VIDEO_STORE_NAME).put(video);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error(`Hindi na-save ang background video na ${video.fileName}.`));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error(`Hindi na-save ang background video na ${video.fileName}.`));
    };
  });
}

async function readSongs(): Promise<Song[]> {
  const database = await openSongDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as Song[]).sort((a, b) => a.title.localeCompare(b.title)));
    request.onerror = () => reject(request.error ?? new Error('Hindi mabasa ang song library.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('May problema sa song library.'));
    };
  });
}

async function saveSong(song: Song): Promise<void> {
  const database = await openSongDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).add(song);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error(`Hindi na-save ang ${song.fileName}.`));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error(`Hindi na-save ang ${song.fileName}.`));
    };
  });
}

async function saveSongs(songs: Song[]): Promise<void> {
  if (!songs.length) return;
  const database = await openSongDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    songs.forEach((song) => store.add(song));
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('Hindi na-save ang ilang kanta sa library.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error('Hindi na-save ang ilang kanta sa library.'));
    };
  });
}

async function readCatalogTitles(): Promise<string[]> {
  const database = await openSongDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(CATALOG_TITLE_STORE_NAME, 'readonly');
    const request = transaction.objectStore(CATALOG_TITLE_STORE_NAME).get('shubidx');
    request.onsuccess = () => resolve((request.result as CatalogTitleCollection | undefined)?.titles ?? []);
    request.onerror = () => reject(request.error ?? new Error('Hindi mabasa ang IDX title catalog.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('May problema sa IDX title catalog.'));
    };
  });
}

async function saveCatalogTitles(titles: string[]): Promise<void> {
  const database = await openSongDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(CATALOG_TITLE_STORE_NAME, 'readwrite');
    transaction.objectStore(CATALOG_TITLE_STORE_NAME).put({ id: 'shubidx', titles } satisfies CatalogTitleCollection);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('Hindi na-save ang IDX title catalog.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error('Hindi na-save ang IDX title catalog.'));
    };
  });
}

async function deleteSong(id: string): Promise<void> {
  const database = await openSongDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('Hindi maalis ang kanta sa library.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error('Hindi maalis ang kanta sa library.'));
    };
  });
}

async function clearSongStore(): Promise<void> {
  const database = await openSongDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('Hindi ma-clear ang mga kanta sa library.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error('Hindi ma-clear ang mga kanta sa library.'));
    };
  });
}

function getSongTitle(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim() || fileName;
}

function getLyricHighlightIndex(lyric: MidiLyric | undefined, time: number): number {
  if (!lyric || time < lyric.time) return 0;
  const partIndex = lyric.parts.findLastIndex((part) => part.time <= time);
  if (partIndex < 0) return 0;
  const part = lyric.parts[partIndex];
  const nextPart = lyric.parts[partIndex + 1];
  if (!nextPart || nextPart.time <= part.time) return part.start + part.length;
  const progress = Math.min(1, Math.max(0, (time - part.time) / (nextPart.time - part.time)));
  return part.start + Math.ceil(part.length * progress);
}

function isVideoSong(song: Song): boolean {
  return song.fileType.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(song.fileName);
}

function isMidiSong(song: Song): boolean {
  return /\.(mid|midi|kar)$/i.test(song.fileName);
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00';
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

function getMediaType(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return MIME_TYPES[extension] ?? 'application/octet-stream';
}

function parseMidiLyrics(midi: Midi, midiEvents: MidiEvent[][]): MidiLyric[] {
  const lyricEvents: Array<{ time: number; text: string }> = [];
  const textEvents: Array<{ time: number; text: string }> = [];

  midiEvents.forEach((track) => {
    let ticks = 0;
    track.forEach((event) => {
      ticks += event.deltaTime;
      if (event.type !== 'lyrics' && event.type !== 'text') return;
      const rawText = event.text;
      const trimmedText = rawText.trim();
      if (!rawText || (trimmedText && trimmedText.startsWith('@'))) return;
      const lyric = { time: midi.header.ticksToSeconds(ticks), text: rawText };
      (event.type === 'lyrics' ? lyricEvents : textEvents).push(lyric);
    });
  });

  const timedEvents = (lyricEvents.length ? lyricEvents : textEvents)
    .sort((first, second) => first.time - second.time);
  const lines: MidiLyric[] = [];
  let lineText = '';
  let lineParts: Array<{ time: number; start: number; length: number }> = [];
  let lineStart = 0;
  let lastTime = 0;

  const finishLine = () => {
    const text = lineText.trim();
    if (text) {
      const leadingTrim = lineText.length - lineText.trimStart().length;
      const trailingTrim = lineText.trimEnd().length;
      const parts = lineParts.flatMap((part) => {
        const start = Math.max(part.start, leadingTrim);
        const end = Math.min(part.start + part.length, trailingTrim);
        return end > start
          ? [{ time: part.time, start: start - leadingTrim, length: end - start }]
          : [];
      });
      lines.push({ time: lineStart, text, parts });
    }
    lineText = '';
    lineParts = [];
  };

  timedEvents.forEach((event) => {
    const marksLineStart = /^[\s]*[\\/]/.test(event.text);
    const marksLineEnd = /[\\/\r\n][\s]*$/.test(event.text);
    if (lineText && (marksLineStart || event.time - lastTime > 1.7)) finishLine();
    if (!lineText) lineStart = event.time;
    const lyricText = event.text
      .replace(/[\r\n]+$/g, '')
      .replace(/^(\s*)[\\/]+/, '$1')
      .replace(/[\\/]+(\s*)$/, '$1');
    if (lyricText) {
      lineParts.push({ time: event.time, start: lineText.length, length: lyricText.length });
      lineText += lyricText;
    }
    lastTime = event.time;
    if (marksLineEnd) finishLine();
  });
  finishLine();
  return lines;
}

function parseMidiSong(songId: string, midi: Midi, rawMidi: Uint8Array): MidiSongData {
  const notes = midi.tracks.flatMap((track) =>
    track.notes.map((note) => ({
      time: note.time,
      duration: note.duration,
      midi: note.midi,
      velocity: note.velocity,
      program: track.instrument.number,
    })),
  );
  const parsedMidi = parseMidi(rawMidi);
  const lyrics = parseMidiLyrics(midi, parsedMidi.tracks);
  const events: MidiPlaybackEvent[] = [];
  parsedMidi.tracks.forEach((track) => {
    let ticks = 0;
    track.forEach((event) => {
      ticks += event.deltaTime;
      const time = midi.header.ticksToSeconds(ticks);
      if (event.type === 'noteOn') {
        events.push({ time, type: 'noteOn', channel: event.channel, note: event.noteNumber, velocity: event.velocity });
      } else if (event.type === 'noteOff') {
        events.push({ time, type: 'noteOff', channel: event.channel, note: event.noteNumber, velocity: event.velocity });
      } else if (event.type === 'programChange') {
        events.push({ time, type: 'programChange', channel: event.channel, program: event.programNumber });
      } else if (event.type === 'controller') {
        events.push({ time, type: 'controller', channel: event.channel, controller: event.controllerType, value: event.value });
      } else if (event.type === 'pitchBend') {
        events.push({ time, type: 'pitchBend', channel: event.channel, value: event.value });
      }
    });
  });
  events.sort((first, second) => first.time - second.time);

  if (!notes.length) {
    throw new Error('Walang musical notes sa MIDI file na ito.');
  }

  return {
    songId,
    notes,
    lyrics,
    events,
    duration: Math.max(midi.duration, ...notes.map((note) => note.time + note.duration)),
  };
}

const Home: React.FC = () => {
  const [searchMode, setSearchMode] = useState<'all' | 'title' | 'artist'>('all');
  const [songs, setSongs] = useState<Song[]>([]);
  const [catalogTitles, setCatalogTitles] = useState<string[]>([]);
  const [backgroundVideos, setBackgroundVideos] = useState<BackgroundVideo[]>([]);
  const [queue, setQueue] = useState<string[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [currentUrl, setCurrentUrl] = useState('');
  const [backgroundVideoUrl, setBackgroundVideoUrl] = useState('');
  const [backgroundVideoIndex, setBackgroundVideoIndex] = useState(0);
  const [search, setSearch] = useState('');
  const [visibleSongLimit, setVisibleSongLimit] = useState(50);
  const [searchOpen, setSearchOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [midiSong, setMidiSong] = useState<MidiSongData | null>(null);
  const [soundFonts, setSoundFonts] = useState<SoundFontData[]>([]);
  const [soundFont, setSoundFont] = useState<SoundFontData | null>(null);
  const [isMidiSynthReady, setIsMidiSynthReady] = useState(false);
  const [error, setError] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isLibraryReady, setIsLibraryReady] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [songCode, setSongCode] = useState('');
  const [keyValue, setKeyValue] = useState(0);
  const [tempo, setTempo] = useState(0);
  const [volume, setVolume] = useState(80);
  const [duration, setDuration] = useState(Number.NaN);
  const [currentTime, setCurrentTime] = useState(0);
  const mediaRef = useRef<HTMLMediaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const soundFontInputRef = useRef<HTMLInputElement>(null);
  const activeLyricTextRef = useRef<HTMLSpanElement>(null);
  const previewLyricTextRef = useRef<HTMLSpanElement>(null);
  const historyRef = useRef<Song[]>([]);
  const midiPositionRef = useRef(0);
  const midiContextRef = useRef<AudioContext | null>(null);
  const midiGainRef = useRef<GainNode | null>(null);
  const midiCompressorRef = useRef<DynamicsCompressorNode | null>(null);
  const midiNodesRef = useRef<OscillatorNode[]>([]);
  const midiSynthRef = useRef<WorkletSynthesizer | null>(null);
  const midiSynthLoadRef = useRef<Promise<void> | null>(null);
  const loadedSoundFontRef = useRef<SoundFontData | null>(null);
  const playNextRef = useRef<() => void>(() => {});
  const isPlayingRef = useRef(false);
  const isRotatingRef = useRef(false);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    let orientationTimer: number | undefined;
    const handleOrientationChange = () => {
      if (!isPlayingRef.current) return;
      isRotatingRef.current = true;
      window.clearTimeout(orientationTimer);
      orientationTimer = window.setTimeout(() => {
        isRotatingRef.current = false;
        const media = mediaRef.current;
        if (media?.paused) void media.play().catch(() => {});
        const context = midiContextRef.current;
        if (context?.state === 'suspended') void context.resume();
      }, 500);
    };

    window.addEventListener('orientationchange', handleOrientationChange);
    window.addEventListener('resize', handleOrientationChange);
    return () => {
      window.removeEventListener('orientationchange', handleOrientationChange);
      window.removeEventListener('resize', handleOrientationChange);
      window.clearTimeout(orientationTimer);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    Promise.all([readSongs(), readSoundFont(), readBackgroundVideos(), readCatalogTitles()])
      .then(([loadedSongs, soundFontResult, loadedBackgroundVideos, loadedCatalogTitles]) => {
        if (!isMounted) return;
        setSongs(loadedSongs);
        setIsLibraryReady(true);
        setSoundFonts(soundFontResult.soundFonts);
        setSoundFont(soundFontResult.soundFont);
        setBackgroundVideos(loadedBackgroundVideos);
        setCatalogTitles(loadedCatalogTitles);
        if (soundFontResult.needsReimport) {
          setError('I-re-import ang ZIP para maayos ang lumang SoundFont at marinig ang buong MIDI instruments.');
        }
      })
      .catch((loadError: unknown) => {
        if (isMounted) setError(loadError instanceof Error ? loadError.message : 'Hindi mabuksan ang song library.');
      });
    return () => {
      isMounted = false;
      midiSynthRef.current?.destroy();
      void midiContextRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (soundFont || !midiSynthRef.current) return;
    midiSynthRef.current.destroy();
    midiSynthRef.current = null;
    loadedSoundFontRef.current = null;
    setIsMidiSynthReady(false);
  }, [soundFont]);

  useEffect(() => {
    if (!backgroundVideos.length) {
      setBackgroundVideoUrl('');
      return;
    }
    const background = backgroundVideos[backgroundVideoIndex % backgroundVideos.length];
    const url = URL.createObjectURL(new Blob([background.buffer], { type: getMediaType(background.fileName) }));
    setBackgroundVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [backgroundVideos, backgroundVideoIndex]);

  useEffect(() => {
    if (!currentSong) {
      setCurrentUrl('');
      return;
    }
    const url = URL.createObjectURL(currentSong.file);
    setCurrentUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [currentSong]);

  useEffect(() => {
    if (!currentSong || !isMidiSong(currentSong)) {
      setMidiSong(null);
      midiPositionRef.current = 0;
      return;
    }

    let isMounted = true;
    setMidiSong(null);
    midiPositionRef.current = 0;
    currentSong.file.arrayBuffer()
      .then((buffer) => parseMidiSong(currentSong.id, new Midi(buffer), new Uint8Array(buffer)))
      .then((parsedSong) => {
        if (!isMounted) return;
        setMidiSong(parsedSong);
        setDuration(parsedSong.duration);
        setError('');
      })
      .catch((parseError: unknown) => {
        if (!isMounted) return;
        setIsPlaying(false);
        setError(parseError instanceof Error ? `Hindi mabasa ang MIDI file: ${parseError.message}` : 'Hindi mabasa ang MIDI file.');
      });

    return () => {
      isMounted = false;
    };
  }, [currentSong]);

  const playbackRate = useMemo(
    () => Math.min(2, Math.max(0.5, Math.pow(2, keyValue / 12) * (1 + tempo / 100))),
    [keyValue, tempo],
  );

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.volume = volume / 100;
    media.playbackRate = playbackRate;
  }, [volume, playbackRate, currentUrl]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !currentUrl) return;
    if (isPlaying) {
      void media.play().catch(() => {
        if (mediaRef.current !== media) return;
        setIsPlaying(false);
        setError('Hindi ma-play ang file na ito. Subukan ang ibang audio o video format.');
      });
    } else {
      media.pause();
    }
  }, [currentUrl, isPlaying]);

  const searchableSongs = useMemo(
    () => songs.map((song, index) => ({
      song,
      songNumber: index + 1,
      searchText: `${song.title} ${song.artist} ${song.fileName}`.toLocaleLowerCase(),
    })),
    [songs],
  );
  const deferredQuery = useDeferredValue(search.trim().toLocaleLowerCase());
  const matchingSongs = useMemo(
    () => deferredQuery
      ? searchableSongs.filter((entry) => {
        if (searchMode === 'title') return entry.song.title.toLocaleLowerCase().includes(deferredQuery);
        if (searchMode === 'artist') return entry.song.artist.toLocaleLowerCase().includes(deferredQuery);
        return entry.searchText.includes(deferredQuery);
      })
      : searchableSongs,
    [deferredQuery, searchMode, searchableSongs],
  );
  const matchingCatalogTitles = useMemo(
    () => searchMode === 'artist'
      ? []
      : deferredQuery
        ? catalogTitles.filter((title) => title.toLocaleLowerCase().includes(deferredQuery))
        : catalogTitles,
    [catalogTitles, deferredQuery, searchMode],
  );
  const visibleSongs = matchingSongs.slice(0, visibleSongLimit);
  const visibleCatalogTitles = matchingCatalogTitles.slice(0, visibleSongLimit);

  const unlockMidiAudio = useCallback(async () => {
    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) {
      setError('Hindi suportado ng browser ang MIDI audio. Gumamit ng updated na Chrome o Edge.');
      return;
    }

    try {
      let context = midiContextRef.current;
      if (!context || context.state === 'closed') {
        context = new AudioContextConstructor();
        midiContextRef.current = context;
        midiGainRef.current = null;
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 12;
        compressor.ratio.value = 8;
        compressor.connect(context.destination);
        midiCompressorRef.current = compressor;
      }

      if (!midiGainRef.current) {
        const gain = context.createGain();
        gain.connect(midiCompressorRef.current ?? context.destination);
        midiGainRef.current = gain;
      }

      await context.resume();
      if (context.state !== 'running') {
        throw new Error('Walang audio output. Tingnan kung naka-mute ang device.');
      }
      if (!soundFont || loadedSoundFontRef.current === soundFont) return;
      if (midiSynthLoadRef.current) {
        await midiSynthLoadRef.current;
        return;
      }

      const loadPromise = (async () => {
        await context.audioWorklet.addModule(soundFontProcessorUrl);
        midiSynthRef.current?.destroy();
        midiSynthRef.current = null;
        loadedSoundFontRef.current = null;
        setIsMidiSynthReady(false);
        const synthesizer = new WorkletSynthesizer(context);
        synthesizer.connect(midiGainRef.current ?? context.destination);
        await synthesizer.isReady;
        await synthesizer.soundBankManager.addSoundBank(soundFont.buffer.slice(0), 'karaoke-soundfont');
        midiSynthRef.current = synthesizer;
        loadedSoundFontRef.current = soundFont;
        setIsMidiSynthReady(true);
      })();
      midiSynthLoadRef.current = loadPromise;
      try {
        await loadPromise;
      } finally {
        midiSynthLoadRef.current = null;
      }
    } catch (audioError: unknown) {
      setError(audioError instanceof Error
        ? `Hindi ma-load ang SoundFont o MIDI audio: ${audioError.message}`
        : 'Hindi ma-load ang SoundFont o MIDI audio.');
    }
  }, [soundFont]);

  useEffect(() => {
    if (soundFont && currentSong && isMidiSong(currentSong) && isPlaying) {
      void unlockMidiAudio();
    }
  }, [currentSong, isPlaying, soundFont, unlockMidiAudio]);

  const playSong = useCallback((song: Song, remainingQueue?: string[]) => {
    setError('');
    setDuration(Number.NaN);
    setCurrentTime(0);
    if (isMidiSong(song)) unlockMidiAudio();
    setCurrentSong((previousSong) => {
      if (previousSong?.id !== song.id) historyRef.current = [...historyRef.current, song].slice(-30);
      return song;
    });
    setQueue((existingQueue) => (remainingQueue ?? existingQueue).filter((id) => id !== song.id));
    setIsPlaying(true);
    setSearchOpen(false);
    setQueueOpen(false);
  }, [unlockMidiAudio]);

  const playNext = useCallback(() => {
    const [nextId, ...remainingQueue] = queue;
    const nextSong = songs.find((song) => song.id === nextId);
    if (nextSong) {
      setQueue(remainingQueue);
      playSong(nextSong, remainingQueue);
    } else {
      setQueue([]);
      setCurrentSong(null);
      setIsPlaying(false);
      setCurrentTime(0);
    }
  }, [playSong, queue, songs]);

  useEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  useEffect(() => {
    if (!currentSong || !isMidiSong(currentSong) || midiSong?.songId !== currentSong.id || !isPlaying) {
      return;
    }
    const synthesizer = midiSynthRef.current;
    if (soundFont && (!synthesizer || !isMidiSynthReady)) return;

    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) {
      setIsPlaying(false);
      setError('Hindi suportado ng browser ang MIDI playback.');
      return;
    }

    const context = midiContextRef.current ?? new AudioContextConstructor();
    midiContextRef.current = context;
    let masterGain = midiGainRef.current;
    if (!masterGain) {
      masterGain = context.createGain();
      masterGain.connect(midiCompressorRef.current ?? context.destination);
      midiGainRef.current = masterGain;
    }
    masterGain.gain.setTargetAtTime((volume / 100) * 0.8, context.currentTime, 0.02);
    void context.resume().catch(() => {
      setIsPlaying(false);
      setError('Na-block ang tunog ng browser. Pindutin ulit ang Play para payagan ang audio.');
    });

    const rate = Math.max(0.5, Math.min(2, 1 + tempo / 100));
    const startOffset = midiPositionRef.current >= midiSong.duration ? 0 : midiPositionRef.current;
    midiPositionRef.current = startOffset;
    const startAt = context.currentTime + 0.06;
    let finished = false;
    const firstRemainingEvent = midiSong.events.findIndex((event) => event.time >= startOffset);
    let nextEventIndex = firstRemainingEvent < 0 ? midiSong.events.length : firstRemainingEvent;

    const sendMidiEvent = (event: MidiPlaybackEvent, eventTime: number, transpose: boolean) => {
      if (!synthesizer) return;
      const eventOptions = { time: eventTime };
      if (event.type === 'noteOn') {
        const note = event.channel === 9 ? event.note : Math.max(0, Math.min(127, event.note + (transpose ? keyValue : 0)));
        if (event.velocity === 0) synthesizer.noteOff(event.channel, note, eventOptions);
        else synthesizer.noteOn(event.channel, note, event.velocity, eventOptions);
      } else if (event.type === 'noteOff') {
        const note = event.channel === 9 ? event.note : Math.max(0, Math.min(127, event.note + (transpose ? keyValue : 0)));
        synthesizer.noteOff(event.channel, note, eventOptions);
      } else if (event.type === 'programChange') {
        synthesizer.programChange(event.channel, event.program, eventOptions);
      } else if (event.type === 'controller') {
        synthesizer.sendMessage([0xb0 + event.channel, event.controller, event.value], 0, eventOptions);
      } else if (event.type === 'pitchBend') {
        const bend = Math.max(0, Math.min(16383, event.value + 8192));
        synthesizer.sendMessage([0xe0 + event.channel, bend & 0x7f, bend >> 7], 0, eventOptions);
      }
    };

    if (synthesizer) {
      synthesizer.stopAll(true);
      for (const event of midiSong.events) {
        if (event.time >= startOffset) break;
        if (event.type === 'programChange' || event.type === 'controller' || event.type === 'pitchBend') {
          sendMidiEvent(event, context.currentTime, false);
        }
      }
    } else {
      midiNodesRef.current = midiSong.notes
        .filter((note) => note.time + note.duration > startOffset)
        .map((note) => {
          const oscillator = context.createOscillator();
          const noteGain = context.createGain();
          const noteStart = startAt + Math.max(0, note.time - startOffset) / rate;
          const noteEnd = startAt + Math.max(0, note.time + note.duration - startOffset) / rate;
          const frequency = 440 * Math.pow(2, (note.midi + keyValue - 69) / 12);
          oscillator.type = note.program >= 10 && note.program <= 14 ? 'sine' : note.program >= 80 && note.program <= 103 ? 'square' : 'triangle';
          oscillator.frequency.setValueAtTime(frequency, noteStart);
          noteGain.gain.setValueAtTime(0, noteStart);
          noteGain.gain.linearRampToValueAtTime(Math.max(0.025, note.velocity * 0.24), noteStart + 0.015);
          noteGain.gain.setValueAtTime(Math.max(0.025, note.velocity * 0.24), Math.max(noteStart + 0.016, noteEnd - 0.03));
          noteGain.gain.linearRampToValueAtTime(0, noteEnd);
          oscillator.connect(noteGain);
          noteGain.connect(masterGain);
          oscillator.start(noteStart);
          oscillator.stop(Math.max(noteStart + 0.025, noteEnd));
          return oscillator;
        });
    }

    const timer = window.setInterval(() => {
      const position = startOffset + Math.max(0, context.currentTime - startAt) * rate;
      if (synthesizer) {
        const scheduleThrough = position + 0.12 * rate;
        while (nextEventIndex < midiSong.events.length && midiSong.events[nextEventIndex].time <= scheduleThrough) {
          const event = midiSong.events[nextEventIndex];
          sendMidiEvent(event, startAt + Math.max(0, event.time - startOffset) / rate, true);
          nextEventIndex += 1;
        }
      }
      midiPositionRef.current = Math.min(position, midiSong.duration);
      setCurrentTime(midiPositionRef.current);
      if (position >= midiSong.duration && !finished) {
        finished = true;
        window.clearInterval(timer);
        midiPositionRef.current = 0;
        setCurrentTime(midiSong.duration);
        setIsPlaying(false);
        playNextRef.current();
      }
    }, 30);

    return () => {
      window.clearInterval(timer);
      if (!finished) {
        midiPositionRef.current = Math.min(
          midiSong.duration,
          startOffset + Math.max(0, context.currentTime - startAt) * rate,
        );
      }
      midiNodesRef.current.forEach((oscillator) => {
        try {
          oscillator.stop();
        } catch {
          // An oscillator may already have stopped at its scheduled note-off.
        }
      });
      midiNodesRef.current = [];
      synthesizer?.stopAll(true);
      void context.suspend();
    };
  }, [currentSong, isMidiSynthReady, isPlaying, keyValue, midiSong, soundFont, tempo, volume]);

  const playPrevious = () => {
    historyRef.current.pop();
    const previousSong = historyRef.current.pop();
    if (previousSong) {
      setCurrentSong(previousSong);
      setCurrentTime(0);
      setIsPlaying(true);
    }
    else if (mediaRef.current) mediaRef.current.currentTime = 0;
  };

  const selectedSong = songCode ? songs[Number(songCode) - 1] : undefined;

  const importZip = (archive: File, knownSongKeys: Set<string>, soundFontsOnly = false): Promise<{
    songs: number;
    soundFonts: number;
    backgrounds: number;
    catalogTitles: number;
  }> => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/zipImportWorker.ts', import.meta.url), { type: 'module' });
    const reader = archive.stream().getReader();
    let loadedBytes = 0;
    let importedCount = 0;
    let importedBackgroundCount = 0;
    let importedCatalogTitleCount = 0;
    let pendingBytes = 0;
    let pendingSongs: Song[] = [];
    const knownBackgroundIds = new Set(backgroundVideos.map((video) => video.id));
    let saveChain: Promise<void> = Promise.resolve();
    let soundFontSaveChain: Promise<void> = Promise.resolve();
    let backgroundSaveChain: Promise<void> = Promise.resolve();
    let catalogTitleSaveChain: Promise<void> = Promise.resolve();
    let acknowledgeChunk: (() => void) | null = null;
    let settled = false;

    const finishWithError = (message: string) => {
      if (settled) return;
      settled = true;
      acknowledgeChunk?.();
      acknowledgeChunk = null;
      void reader.cancel();
      worker.terminate();
      reject(new Error(message));
    };

    const flushSongs = () => {
      if (!pendingSongs.length) return;
      const batch = pendingSongs;
      pendingSongs = [];
      pendingBytes = 0;
      saveChain = saveChain.then(async () => {
        await saveSongs(batch);
        setSongs((currentSongs) => [...currentSongs, ...batch].sort((a, b) => a.title.localeCompare(b.title)));
      });
    };

    worker.onmessage = (event: MessageEvent<{
      type: 'progress' | 'song' | 'soundfont' | 'background' | 'catalog-titles' | 'done' | 'error';
      loaded?: number;
      total?: number;
      foundMedia?: number;
      foundSoundFonts?: number;
      foundBackgroundVideos?: number;
      foundCatalogTitles?: number;
      message?: string;
      fileName?: string;
      chunks?: Array<{ buffer: ArrayBuffer; byteOffset: number; byteLength: number }>;
      titles?: string[];
    }>) => {
      const result = event.data;
      if (result.type === 'progress') {
        const percent = result.total ? Math.floor((result.loaded ?? 0) / result.total * 100) : 0;
        setImportProgress(`Unzipping ZIP ${percent}% · ${importedCount} kanta`);
        acknowledgeChunk?.();
        acknowledgeChunk = null;
        return;
      }
      if (result.type === 'error') {
        finishWithError(result.message ?? 'Hindi ma-unzip ang ZIP file.');
        return;
      }
      if (result.type === 'catalog-titles' && result.titles) {
        if (soundFontsOnly) return;
        importedCatalogTitleCount = result.titles.length;
        catalogTitleSaveChain = catalogTitleSaveChain.then(async () => {
          await saveCatalogTitles(result.titles ?? []);
          setCatalogTitles(result.titles ?? []);
        });
        setImportProgress(`Nababasa ang ${importedCatalogTitleCount.toLocaleString()} title-only entries…`);
        return;
      }
      if (result.type === 'song' && result.fileName && result.chunks) {
        if (soundFontsOnly) return;
        const fileName = result.fileName.split(/[\\/]/).pop() ?? result.fileName;
        const fileType = getMediaType(fileName);
        const parts = result.chunks.map((chunk) => new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        const file = new Blob(parts, { type: fileType });
        const songKey = `${fileName.toLocaleLowerCase()}:${file.size}`;
        if (knownSongKeys.has(songKey)) return;
        knownSongKeys.add(songKey);
        const song: Song = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          title: getSongTitle(fileName),
          artist: 'Hindi pa alam ang artist',
          fileName,
          fileType,
          file,
        };
        pendingSongs.push(song);
        pendingBytes += file.size;
        importedCount += 1;
        setImportProgress(`Ini-import ang ${importedCount} kanta…`);
        if (pendingSongs.length >= 10 || pendingBytes >= 64 * 1024 * 1024) flushSongs();
        return;
      }
      if ((result.type === 'soundfont' || result.type === 'background') && result.fileName && result.chunks) {
        if (soundFontsOnly && result.type !== 'soundfont') return;
        const fileName = result.fileName.split(/[\\/]/).pop() ?? result.fileName;
        const byteLength = result.chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
        if (!Number.isSafeInteger(byteLength) || byteLength === 0) {
          finishWithError(`Walang laman o hindi wasto ang ${result.type === 'soundfont' ? 'SoundFont' : 'background video'} na ${fileName}.`);
          return;
        }
        const fileBuffer = new Uint8Array(byteLength);
        let offset = 0;
        result.chunks.forEach((chunk) => {
          const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
          fileBuffer.set(bytes, offset);
          offset += bytes.byteLength;
        });
        if (result.type === 'soundfont') {
          const soundFontFile: SoundFontData = {
            id: getSoundFontId(fileName, byteLength),
            fileName,
            buffer: fileBuffer.buffer,
          };
          soundFontSaveChain = soundFontSaveChain.then(async () => {
            await saveAndSelectSoundFont(soundFontFile);
          });
          setImportProgress(`Ini-import ang SoundFont ${fileName}…`);
        } else {
          const backgroundPath = result.fileName.replace(/\\/g, '/');
          const id = `${backgroundPath.toLocaleLowerCase()}:${byteLength}`;
          if (!knownBackgroundIds.has(id)) {
            knownBackgroundIds.add(id);
            const backgroundVideo: BackgroundVideo = { id, fileName: backgroundPath, buffer: fileBuffer.buffer };
            backgroundSaveChain = backgroundSaveChain.then(async () => {
              await saveBackgroundVideo(backgroundVideo);
              setBackgroundVideos((current) => [...current.filter((video) => video.id !== id), backgroundVideo]);
              importedBackgroundCount += 1;
              setImportProgress(`Ini-import ang background video ${fileName}…`);
            });
          }
          backgroundSaveChain = backgroundSaveChain.then(async () => {
            const previousSongIds = songs
              .filter((song) => song.fileName.toLocaleLowerCase() === fileName.toLocaleLowerCase() && song.file.size === byteLength)
              .map((song) => song.id);
            if (previousSongIds.length) {
              await Promise.all(previousSongIds.map((songId) => deleteSong(songId)));
              const previousSongIdSet = new Set(previousSongIds);
              setSongs((current) => current.filter((song) => !previousSongIdSet.has(song.id)));
              setQueue((current) => current.filter((songId) => !previousSongIdSet.has(songId)));
              if (currentSong && previousSongIdSet.has(currentSong.id)) {
                setCurrentSong(null);
                setCurrentTime(0);
                setIsPlaying(false);
              }
            }
          });
        }
        return;
      }
      if (result.type === 'done') {
        flushSongs();
        void Promise.all([saveChain, soundFontSaveChain, backgroundSaveChain, catalogTitleSaveChain]).then(() => {
          if (settled) return;
          settled = true;
          worker.terminate();
          if (soundFontsOnly && !result.foundSoundFonts) {
            reject(new Error(`${archive.name}: walang .sf2 SoundFont sa loob ng ZIP.`));
            return;
          }
          if (!result.foundMedia && !result.foundSoundFonts && !result.foundBackgroundVideos && !result.foundCatalogTitles) {
            reject(new Error(`${archive.name}: walang suportadong kanta, .sf2 SoundFont, o background MP4 sa loob ng ZIP.`));
            return;
          }
          resolve({
            songs: importedCount,
            soundFonts: result.foundSoundFonts ?? 0,
            backgrounds: importedBackgroundCount,
            catalogTitles: importedCatalogTitleCount,
          });
        }).catch((saveError: unknown) => {
          finishWithError(saveError instanceof Error ? saveError.message : 'Hindi na-save sa library ang laman ng ZIP.');
        });
      }
    };

    worker.onerror = (event) => {
      const workerError = event.error instanceof Error ? event.error.message : event.message;
      finishWithError(workerError
        ? `Nagkaroon ng problema habang binubuksan ang ZIP file: ${workerError}`
        : 'Nagkaroon ng problema habang binubuksan ang ZIP file. Subukang i-extract muna ang ZIP at idagdag ang mga kanta nang direkta.');
    };

    void (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          loadedBytes += value.byteLength;
          const chunk = value.slice();
          await new Promise<void>((resolveChunk) => {
            acknowledgeChunk = resolveChunk;
            worker.postMessage(
              { type: 'chunk', chunk: chunk.buffer, loaded: loadedBytes, total: archive.size },
              [chunk.buffer],
            );
          });
        }
        worker.postMessage({ type: 'end' });
      } catch (readError: unknown) {
        finishWithError(readError instanceof Error ? readError.message : 'Hindi mabasa ang ZIP file.');
      }
    })();
  });

  const enterDigit = (digit: number) => {
    setSongCode((code) => (code.length >= 6 ? String(digit) : `${code}${digit}`));
  };

  const reserveSong = (first = false) => {
    if (!selectedSong) {
      setError(songCode ? `Walang kanta na may code ${songCode}. Mag-import muna ng kanta o tingnan ang library.` : 'Ilagay ang song code gamit ang keypad, o hanapin sa library.');
      return;
    }
    setError('');
    setQueue((currentQueue) => first ? [selectedSong.id, ...currentQueue.filter((id) => id !== selectedSong.id)] : [...currentQueue, selectedSong.id]);
    setSongCode('');
  };

  const onImportFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    setError('');
    setIsImporting(true);
    const knownSongKeys = new Set(songs.map((song) => `${song.fileName.toLocaleLowerCase()}:${song.file.size}`));
    try {
      for (const file of files) {
        if (/\.zip$/i.test(file.name)) {
          setImportProgress('Binubuksan ang ZIP…');
          const imported = await importZip(file, knownSongKeys);
          setImportProgress(`Tapos · ${imported.songs} kanta · ${imported.soundFonts} sound bank · ${imported.backgrounds} background · ${imported.catalogTitles.toLocaleString()} title-only`);
          if (!imported.backgrounds && !backgroundVideos.length && !imported.catalogTitles) {
            setError(`${file.name}: walang nakilalang background video. Dapat nasa bgv/ folder o subfolder nito ang MP4, WebM, MOV, o M4V.`);
          }
          continue;
        }

        if (/\.sf2$/i.test(file.name)) {
          const importedSoundFont: SoundFontData = {
            id: getSoundFontId(file.name, file.size),
            fileName: file.name,
            buffer: await file.arrayBuffer(),
          };
          await saveAndSelectSoundFont(importedSoundFont);
          if (currentSong && isMidiSong(currentSong)) void unlockMidiAudio();
          setImportProgress(`SoundFont handa · ${file.name}`);
          continue;
        }

        if (!file.type.startsWith('audio/') && !file.type.startsWith('video/') && !FORMAT_PATTERN.test(file.name)) {
          throw new Error(`${file.name} ay hindi suportadong ZIP, audio, o video file.`);
        }
        const songKey = `${file.name.toLocaleLowerCase()}:${file.size}`;
        if (knownSongKeys.has(songKey)) continue;
        knownSongKeys.add(songKey);
        const song: Song = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          title: getSongTitle(file.name),
          artist: 'Hindi pa alam ang artist',
          fileName: file.name,
          fileType: file.type,
          file,
        };
        await saveSong(song);
        setSongs((currentSongs) => [...currentSongs, song].sort((a, b) => a.title.localeCompare(b.title)));
      }
    } catch (importError: unknown) {
      setError(importError instanceof Error ? importError.message : 'Hindi na-import ang mga napiling kanta.');
    } finally {
      setIsImporting(false);
      window.setTimeout(() => setImportProgress(''), 2500);
    }
  };

  const removeSong = async (song: Song) => {
    setError('');
    try {
      await deleteSong(song.id);
      setSongs((currentSongs) => currentSongs.filter((item) => item.id !== song.id));
      setQueue((currentQueue) => currentQueue.filter((id) => id !== song.id));
      if (currentSong?.id === song.id) {
        setCurrentSong(null);
        setIsPlaying(false);
      }
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'Hindi maalis ang kanta sa library.');
    }
  };

  const removeAllSongs = async () => {
    if (!songs.length || !window.confirm(`Sigurado ka bang aalisin ang lahat ng ${songs.length.toLocaleString()} kanta? Hindi mabubura ang SoundFont, background videos, o title catalog.`)) {
      return;
    }
    setError('');
    try {
      await clearSongStore();
      mediaRef.current?.pause();
      if (mediaRef.current) mediaRef.current.currentTime = 0;
      setSongs([]);
      setQueue([]);
      setCurrentSong(null);
      setCurrentTime(0);
      setDuration(Number.NaN);
      setIsPlaying(false);
      setMidiSong(null);
      setSongCode('');
      historyRef.current = [];
    } catch (clearError: unknown) {
      setError(clearError instanceof Error ? clearError.message : 'Hindi ma-clear ang mga kanta sa library.');
    }
  };

  const stopPlayback = () => {
    mediaRef.current?.pause();
    if (mediaRef.current) mediaRef.current.currentTime = 0;
    setCurrentTime(0);
    setIsPlaying(false);
  };

  const saveAndSelectSoundFont = async (font: SoundFontData) => {
    await saveSoundFont(font);
    setSoundFonts((current) => [...current.filter((item) => item.id !== font.id), font]);
    try {
      localStorage.setItem(ACTIVE_SOUND_FONT_KEY, font.id);
    } catch (storageError: unknown) {
      throw new Error(storageError instanceof Error
        ? `Na-save ang ${font.fileName}, pero hindi ma-save ang napiling SoundFont: ${storageError.message}`
        : `Na-save ang ${font.fileName}, pero hindi ma-save ang napiling SoundFont.`);
    }
    setSoundFont(font);
  };

  const chooseSoundFont = (font: SoundFontData) => {
    try {
      localStorage.setItem(ACTIVE_SOUND_FONT_KEY, font.id);
      setSoundFont(font);
      setError('');
    } catch (storageError: unknown) {
      setError(storageError instanceof Error
        ? `Hindi ma-save ang napiling SoundFont: ${storageError.message}`
        : 'Hindi ma-save ang napiling SoundFont.');
    }
  };

  const removeSavedSoundFont = async (font: SoundFontData) => {
    if (!window.confirm(`Alisin ang SoundFont na ${font.fileName}?`)) return;
    try {
      await deleteSoundFont(font.id);
      const remaining = soundFonts.filter((item) => item.id !== font.id);
      setSoundFonts(remaining);
      if (soundFont?.id === font.id) {
        const nextSoundFont = remaining[0] ?? null;
        setSoundFont(nextSoundFont);
        try {
          if (nextSoundFont) localStorage.setItem(ACTIVE_SOUND_FONT_KEY, nextSoundFont.id);
          else localStorage.removeItem(ACTIVE_SOUND_FONT_KEY);
        } catch (storageError: unknown) {
          setError(storageError instanceof Error
            ? `Naalis ang SoundFont, pero hindi ma-save ang bagong selection: ${storageError.message}`
            : 'Naalis ang SoundFont, pero hindi ma-save ang bagong selection.');
        }
      }
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'Hindi maalis ang SoundFont.');
    }
  };

  const onImportSoundFonts = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    setError('');
    setIsImporting(true);
    try {
      for (const file of files) {
        if (/\.zip$/i.test(file.name)) {
          setImportProgress(`Hinahanap ang .sf2 sa ${file.name}…`);
          const imported = await importZip(file, new Set(), true);
          setImportProgress(`Tapos · ${imported.soundFonts} SoundFont`);
          continue;
        }
        if (!/\.sf2$/i.test(file.name)) {
          throw new Error(`${file.name} ay hindi .sf2 SoundFont file.`);
        }
        setImportProgress(`Ini-import ang SoundFont ${file.name}…`);
        await saveAndSelectSoundFont({
          id: getSoundFontId(file.name, file.size),
          fileName: file.name,
          buffer: await file.arrayBuffer(),
        });
      }
      if (currentSong && isMidiSong(currentSong)) void unlockMidiAudio();
    } catch (importError: unknown) {
      setError(importError instanceof Error ? importError.message : 'Hindi na-import ang SoundFont.');
    } finally {
      setIsImporting(false);
      window.setTimeout(() => setImportProgress(''), 2500);
    }
  };

  const queuedSongs = queue.map((id) => songs.find((song) => song.id === id)).filter((song): song is Song => Boolean(song));
  const currentMidiSong = midiSong?.songId === currentSong?.id ? midiSong : null;
  const midiLyricIndex = currentMidiSong
    ? currentMidiSong.lyrics.findLastIndex((lyric) => lyric.time <= currentTime)
    : -1;
  const activeIndex = Math.max(0, midiLyricIndex);
  const isUpperLyricActive = activeIndex % 2 === 0;
  const upperLyricIndex = isUpperLyricActive ? activeIndex : activeIndex + 1;
  const lowerLyricIndex = isUpperLyricActive ? activeIndex + 1 : activeIndex;
  const upperLyric = currentMidiSong?.lyrics[upperLyricIndex];
  const lowerLyric = currentMidiSong?.lyrics[lowerLyricIndex];
  const upperLyricText = upperLyric?.text ?? currentMidiSong?.lyrics[0].text ?? '';
  const lowerLyricText = lowerLyric?.text ?? '';
  const activeLyricHighlight = midiLyricIndex >= 0
    ? getLyricHighlightIndex(isUpperLyricActive ? upperLyric : lowerLyric, currentTime)
    : 0;

  useLayoutEffect(() => {
    const fitLyric = (element: HTMLSpanElement | null) => {
      const container = element?.parentElement;
      if (!element || !container) return;
      element.style.transform = 'none';
      const textWidth = element.getBoundingClientRect().width;
      const availableWidth = container.clientWidth;
      const scale = textWidth > availableWidth && textWidth > 0
        ? availableWidth / textWidth
        : 1;
      element.style.transform = `scaleX(${scale})`;
    };
    const fitBothLines = () => {
      fitLyric(activeLyricTextRef.current);
      fitLyric(previewLyricTextRef.current);
    };

    fitBothLines();
    window.addEventListener('resize', fitBothLines);
    return () => window.removeEventListener('resize', fitBothLines);
  }, [upperLyricText, lowerLyricText]);

  const showBackgroundVideo = Boolean(backgroundVideoUrl && (!currentSong || !isVideoSong(currentSong)));
  const nextBackgroundVideo = () => {
    if (backgroundVideos.length < 2) return;
    setBackgroundVideoIndex((index) => (index + 1) % backgroundVideos.length);
  };

  return (
    <IonPage>
      <main className="karaoke-app cinema-layout">
        <div className="karaoke-shell">
          <header className="top-status">
            <span className="song-counter">{currentSong ? `▶ ${formatTime(currentTime)}${Number.isFinite(duration) ? ` / ${formatTime(duration)}` : ''}` : `${songs.length} kanta${catalogTitles.length ? ` · ${catalogTitles.length.toLocaleString()} title-only` : ''}`}</span>
            <button className="import-button" onClick={() => fileInputRef.current?.click()} disabled={isImporting || !isLibraryReady} title="Mag-import ng kanta mula sa ZIP o audio/video file">
              {isImporting ? importProgress || 'Nag-i-import…' : isLibraryReady ? '＋ KANTA' : 'NAGLO-LOAD…'}
            </button>
            <button
              type="button"
              className="settings-button"
              onClick={() => { setSettingsOpen((open) => !open); setSearchOpen(false); setQueueOpen(false); }}
              aria-label="SoundFont settings"
              title="Palitan ang MIDI SoundFont"
            >⚙</button>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              disabled={!isLibraryReady || isImporting}
              accept=".zip,application/zip,audio/*,video/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.mid,.midi,.kar,.sf2,.mp4,.webm,.mov,.m4v"
              multiple
              onChange={onImportFiles}
              aria-label="Pumili ng audio o video files"
            />
            <input
              ref={soundFontInputRef}
              className="visually-hidden"
              type="file"
              accept=".sf2,.zip,application/zip,application/octet-stream"
              multiple
              onChange={onImportSoundFonts}
              aria-label="Mag-import ng SoundFont files"
            />
          </header>
          {queuedSongs[0] && (
            <button
              type="button"
              className="next-song-banner"
              onClick={() => { setQueueOpen(true); setSearchOpen(false); }}
              aria-label={`Susunod na kanta: code ${String(songs.findIndex((song) => song.id === queuedSongs[0].id) + 1).padStart(6, '0')}, ${queuedSongs[0].title}`}
            >
              <span className="next-song-label">NEXT</span>
              <strong>{String(songs.findIndex((song) => song.id === queuedSongs[0].id) + 1).padStart(6, '0')}</strong>
              <span className="next-song-title">{queuedSongs[0].title}</span>
              <span className="next-song-open">RSV ›</span>
            </button>
          )}

          <section className={`karaoke-screen${currentSong && isVideoSong(currentSong) ? ' has-video' : ''}${currentSong && isMidiSong(currentSong) ? ' has-midi' : ''}${showBackgroundVideo ? ' has-motion' : ''}`} aria-label="Song display">
            {showBackgroundVideo && (
              <video
                key={backgroundVideoUrl}
                className="motion-background"
                src={backgroundVideoUrl}
                autoPlay
                loop
                muted
                playsInline
                aria-hidden="true"
                onError={() => setError('Hindi ma-play ang background MP4. Subukang i-export ito bilang H.264 MP4.')}
              />
            )}
            {currentSong && currentUrl && isVideoSong(currentSong) && (
              <video
                ref={(element) => { mediaRef.current = element; }}
                src={currentUrl}
                preload="auto"
                playsInline
                onEnded={playNext}
                onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => { if (!isRotatingRef.current) setIsPlaying(false); }}
                aria-label={`Karaoke video: ${currentSong.title}`}
              />
            )}
            {currentSong && currentUrl && !isVideoSong(currentSong) && !isMidiSong(currentSong) && (
              <audio
                ref={(element) => { mediaRef.current = element; }}
                src={currentUrl}
                preload="auto"
                onEnded={playNext}
                onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => { if (!isRotatingRef.current) setIsPlaying(false); }}
                aria-label={`Audio: ${currentSong.title}`}
              />
            )}
            <div className="water-glow" aria-hidden="true" />
            <div className="title-block">
              {currentSong && isMidiSong(currentSong) ? (
                <>
                  {currentMidiSong?.lyrics.length ? (
                    <>
                      <span className={`line ${isUpperLyricActive ? 'active-line' : 'preview-line'}`}>
                        <span ref={isUpperLyricActive ? activeLyricTextRef : previewLyricTextRef} className="lyric-text">
                          {isUpperLyricActive ? (
                            <>
                              <span className="lyric-read">{upperLyricText.slice(0, activeLyricHighlight)}</span>
                              <span className="lyric-unread">{upperLyricText.slice(activeLyricHighlight)}</span>
                            </>
                          ) : upperLyricText}
                        </span>
                      </span>
                      <span className={`line accent ${isUpperLyricActive ? 'preview-line' : 'active-line'}`}>
                        <span ref={!isUpperLyricActive ? activeLyricTextRef : previewLyricTextRef} className="lyric-text">
                          {!isUpperLyricActive ? (
                            <>
                              <span className="lyric-read">{lowerLyricText.slice(0, activeLyricHighlight)}</span>
                              <span className="lyric-unread">{lowerLyricText.slice(activeLyricHighlight)}</span>
                            </>
                          ) : lowerLyricText}
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="line song-title">
                        <span ref={activeLyricTextRef} className="lyric-text">{upperLyricText}</span>
                      </span>
                      <span className="line accent song-artist">
                        <span ref={previewLyricTextRef} className="lyric-text">{currentSong?.artist ?? ''}</span>
                      </span>
                    </>
                  )}
                  {soundFont && !currentMidiSong?.lyrics.length && <span className="lyric-hint">MIDI sound: {soundFont.fileName}</span>}
                  {!currentMidiSong?.lyrics.length && <span className="lyric-hint">Walang lyrics sa file na ito · pumili ng .KAR na may lyrics</span>}
                </>
              ) : currentSong ? (
                <>
                  <span className="line song-title">{currentSong.title}</span>
                  <span className="line accent song-artist">Singer: {currentSong.artist}</span>
                  {!isVideoSong(currentSong) && <span className="lyric-hint">Audio track · idagdag ang karaoke video para sa lyrics</span>}
                </>
              ) : (
                <>
                  <span className="line song-title idle-title">Select a Song</span>
                  <span className="idle-song-code">{(songCode || '0').padStart(6, '0')}</span>
                  {selectedSong && <span className="line accent song-artist">{selectedSong.title}</span>}
                </>
              )}
            </div>
            {currentSong && Number.isFinite(duration) && (
              <div className="video-progress" aria-label={`Playback ${formatTime(currentTime)} of ${formatTime(duration)}`}>
                <span style={{ width: `${duration ? Math.min(100, currentTime / duration * 100) : 0}%` }} />
              </div>
            )}
          </section>

          <div className="karaoke-transport">
          <div className="control-strip">
            <div className="control-box">
              <span>KEY:</span>
              <button type="button" onClick={() => setKeyValue((current) => Math.max(current - 1, -6))} aria-label="Ibaba ang key">−</button>
              <strong>{keyValue > 0 ? `+${keyValue}` : keyValue}</strong>
              <button type="button" onClick={() => setKeyValue((current) => Math.min(current + 1, 6))} aria-label="Itaas ang key">+</button>
            </div>
            <div className="control-box">
              <span>TEM:</span>
              <button type="button" onClick={() => setTempo((current) => Math.max(current - 5, -25))} aria-label="Bagalan ang kanta">−</button>
              <strong>{tempo}</strong>
              <button type="button" onClick={() => setTempo((current) => Math.min(current + 5, 25))} aria-label="Bilisan ang kanta">+</button>
            </div>
            <label className="control-box success volume-control">
              <span>MEL:</span>
              <input type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="Media volume" />
              <strong>{volume}</strong>
            </label>
          </div>

          <div className="player-controls">
            <button type="button" className="tool-button search" onClick={() => { setSearchOpen((open) => !open); setQueueOpen(false); }} aria-label="Hanapin ang kanta">⌕</button>
            <button type="button" className="tool-button" onClick={playPrevious} aria-label="Nakaraang kanta">|◀</button>
            <button type="button" className="tool-button active" onClick={() => currentSong && setIsPlaying((playing) => !playing)} disabled={!currentSong} aria-label={isPlaying ? 'I-pause' : 'I-play'}>{isPlaying ? 'Ⅱ' : '▶'}</button>
            <button type="button" className="tool-button" onClick={playNext} disabled={!queue.length} aria-label="Susunod na kanta">▶|</button>
            <button type="button" className="tool-button stop-button" onClick={stopPlayback} disabled={!currentSong} aria-label="I-stop ang playback">■</button>
          </div>
          </div>

          {searchOpen && (
            <section className="library-drawer" aria-label="Song library">
              <div className="drawer-heading">
                <strong>SONG LIBRARY <span>{songs.length}</span></strong>
                <div className="drawer-heading-actions">
                  <button type="button" className="drawer-clear" onClick={() => void removeAllSongs()} disabled={!songs.length}>I-clear lahat</button>
                  <button type="button" onClick={() => setSearchOpen(false)} aria-label="Isara ang library">×</button>
                </div>
              </div>
              <input
                className="song-search"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setVisibleSongLimit(50);
                }}
                placeholder={searchMode === 'title' ? 'Hanapin ang title' : searchMode === 'artist' ? 'Hanapin ang singer' : 'Search song or singer'}
                aria-label="Hanapin ang kanta o artist"
                autoFocus
              />
              <div className="search-filters" aria-label="Uri ng paghahanap">
                <button type="button" className={searchMode === 'all' ? 'selected' : ''} onClick={() => setSearchMode('all')}>ALL</button>
                <button type="button" className={searchMode === 'title' ? 'selected' : ''} onClick={() => setSearchMode('title')}>TITLE</button>
                <button type="button" className={searchMode === 'artist' ? 'selected' : ''} onClick={() => setSearchMode('artist')}>SINGER</button>
              </div>
              {songs.length === 0 && catalogTitles.length === 0 ? (
                <div className="drawer-empty">
                  Wala pang kanta. <button type="button" onClick={() => fileInputRef.current?.click()}>Mag-import ng files</button>
                </div>
              ) : (
                <div className="library-list">
                  {visibleSongs.map(({ song, songNumber }) => {
                    return (
                      <div className={`library-song${currentSong?.id === song.id ? ' playing' : ''}`} key={song.id}>
                        <button type="button" className="library-song-main" onClick={() => playSong(song)}>
                          <span className="library-number">{String(songNumber).padStart(2, '0')}</span>
                          <span><strong>{song.title}</strong><small>{song.artist} · {isMidiSong(song) ? 'MIDI' : isVideoSong(song) ? 'VIDEO' : 'AUDIO'}</small></span>
                        </button>
                        <button type="button" className="library-reserve" onClick={() => { setSongCode(String(songNumber)); setSearchOpen(false); }} aria-label={`Piliin ang code ${songNumber}`}>CODE</button>
                        <button type="button" className="library-delete" onClick={() => void removeSong(song)} aria-label={`Alisin ang ${song.title}`}>×</button>
                      </div>
                    );
                  })}
                  {catalogTitles.length > 0 && (
                    <>
                      <div className="catalog-title-heading">
                        IDX TITLE CATALOG · {catalogTitles.length.toLocaleString()} title-only · walang code/playback
                      </div>
                      {visibleCatalogTitles.map((title, index) => (
                        <div className="library-song catalog-title-row" key={`${title}-${index}`}>
                          <span className="library-number">—</span>
                          <span className="catalog-title-text"><strong>{title}</strong><small>Title lang · walang song code o media</small></span>
                        </div>
                      ))}
                    </>
                  )}
                  {visibleSongs.length === 0 && visibleCatalogTitles.length === 0 && <p className="drawer-empty">Walang kantang tumugma.</p>}
                  {visibleSongs.length < matchingSongs.length && (
                    <button type="button" className="library-more" onClick={() => setVisibleSongLimit((limit) => limit + 50)}>
                      Magpakita pa ({matchingSongs.length - visibleSongs.length} pa)
                    </button>
                  )}
                  {visibleCatalogTitles.length < matchingCatalogTitles.length && (
                    <button type="button" className="library-more" onClick={() => setVisibleSongLimit((limit) => limit + 50)}>
                      Magpakita pa ng title-only ({matchingCatalogTitles.length - visibleCatalogTitles.length} pa)
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

          {settingsOpen && (
            <section className="settings-drawer" aria-label="SoundFont settings">
              <div className="drawer-heading">
                <strong>MIDI SOUNDFONTS <span>{soundFonts.length}</span></strong>
                <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Isara ang settings">×</button>
              </div>
              <p className="settings-description">
                Piliin ang tunog ng mga MIDI/KAR kanta. Aktibo ngayon: {soundFont?.fileName ?? 'walang SoundFont'}.
              </p>
              <button
                type="button"
                className="settings-import-button"
                onClick={() => soundFontInputRef.current?.click()}
                disabled={isImporting}
              >
                {isImporting ? importProgress || 'Ini-import…' : '＋ Mag-import ng .SF2 o ZIP'}
              </button>
              <div className="soundfont-list">
                {soundFonts.length ? soundFonts.map((font) => (
                  <div className="soundfont-option" key={font.id}>
                    <button
                      type="button"
                      className={`soundfont-select${soundFont?.id === font.id ? ' selected' : ''}`}
                      onClick={() => chooseSoundFont(font)}
                      disabled={soundFont?.id === font.id}
                    >
                      <strong>{font.fileName}</strong>
                      <small>{soundFont?.id === font.id ? 'GINAGAMIT' : 'Pindutin para gamitin'}</small>
                    </button>
                    <button
                      type="button"
                      className="soundfont-delete"
                      onClick={() => void removeSavedSoundFont(font)}
                      aria-label={`Alisin ang SoundFont ${font.fileName}`}
                    >×</button>
                  </div>
                )) : (
                  <p className="drawer-empty">Wala pang naka-save na SoundFont. Mag-import ng .sf2 para pumili ng tunog.</p>
                )}
              </div>
            </section>
          )}

          {queueOpen && (
            <section className="queue-drawer" aria-label="Reservation list">
              <div className="drawer-heading">
                <strong>RSV LIST <span>{queuedSongs.length}</span></strong>
                <button type="button" onClick={() => setQueueOpen(false)} aria-label="Isara ang pila">×</button>
              </div>
              {queuedSongs.length ? (
                <ol>
                  {queuedSongs.map((song, index) => (
                    <li key={`${song.id}-${index}`}>
                      <button type="button" onClick={() => playSong(song)}><span>{String(index + 1).padStart(2, '0')}</span>{song.title}</button>
                      <button type="button" onClick={() => setQueue((list) => { const i = list.indexOf(song.id); return i < 0 ? list : list.filter((_, itemIndex) => itemIndex !== i); })} aria-label={`Alisin sa pila: ${song.title}`}>×</button>
                    </li>
                  ))}
                </ol>
              ) : <p className="drawer-empty">Wala pang naka-reserve. Piliin ang kanta at pindutin ang RES.</p>}
            </section>
          )}

          <div className="karaoke-keypad">
          <div className="code-display" aria-live="polite">
            <span>SONG CODE</span>
            <strong>{(songCode || '0').padStart(6, '0')}</strong>
            {selectedSong && <small>{selectedSong.title}</small>}
            {!selectedSong && songCode && <small className="invalid-code">Hindi nahanap ang code na ito</small>}
          </div>

          <div className="keypad-grid">
            {[1, 2, 3, 'mic', 4, 5, 6, 'rsv', 7, 8, 9, 'library', 'res', 0, 'can', 'first'].map((key) => {
              if (typeof key === 'number') {
                return <button key={key} type="button" className="keypad-btn" onClick={() => enterDigit(key)} aria-label={`Ilagay ang ${key}`}>{key}</button>;
              }
              if (key === 'mic') return <button key={key} type="button" className="keypad-btn action background-next" onClick={nextBackgroundVideo} disabled={backgroundVideos.length < 2} aria-label={`Susunod na background video. ${backgroundVideos.length} na-load`}><span>▶▶</span><small>BG VIDEO · {backgroundVideos.length}</small></button>;
              if (key === 'rsv') return <button key={key} type="button" className="keypad-btn action purple" onClick={() => { setQueueOpen((open) => !open); setSearchOpen(false); }}>RSV List <small>{queue.length || ''}</small></button>;
              if (key === 'library') return <button key={key} type="button" className="keypad-btn action camera" onClick={() => fileInputRef.current?.click()} aria-label="Magdagdag ng kanta">＋ KANTA</button>;
              if (key === 'res') return <button key={key} type="button" className="keypad-btn action green" onClick={() => reserveSong()}>RES</button>;
              if (key === 'can') return <button key={key} type="button" className="keypad-btn action red" onClick={() => { setSongCode(''); setError(''); }}>CAN</button>;
              return <button key={key} type="button" className="keypad-btn action blue" onClick={() => reserveSong(true)}>1st RSV</button>;
            })}
          </div>

          </div>

          {error && <div className="error-message" role="alert">{error}<button onClick={() => setError('')} aria-label="Isara">×</button></div>}
        </div>
      </main>
    </IonPage>
  );
};

export default Home;
