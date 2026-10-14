import { registerPlugin } from '@capacitor/core';

export interface NativeFluidSynthPlugin {
  loadSoundFont(options: { path: string }): Promise<void>;
  pickAndLoadSoundFont(): Promise<{ path: string }>;
  unload(): Promise<void>;
  noteOn(options: { channel: number; note: number; velocity: number }): Promise<void>;
  noteOff(options: { channel: number; note: number }): Promise<void>;
  controlChange(options: { channel: number; controller: number; value: number }): Promise<void>;
  programChange(options: { channel: number; program: number }): Promise<void>;
  pitchBend(options: { channel: number; value: number }): Promise<void>;
}

export const NativeFluidSynth = registerPlugin<NativeFluidSynthPlugin>('NativeFluidSynth');
