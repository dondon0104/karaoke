package com.karaoke.app;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;

public final class NativeFluidSynth {
    static {
        System.loadLibrary("nativefluidsynth");
    }

    private AudioTrack audioTrack;
    private Thread audioThread;
    private volatile boolean rendering;

    public synchronized boolean loadSoundFont(String path) {
        stopAudio();
        if (!nativeLoadSoundFont(path)) return false;
        startAudio();
        return true;
    }

    public synchronized void unload() {
        stopAudio();
        nativeUnload();
    }

    private synchronized void stopAudio() {
        rendering = false;
        if (audioThread != null) {
            try {
                audioThread.join(1000);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
            }
            audioThread = null;
        }
        if (audioTrack != null) {
            audioTrack.stop();
            audioTrack.release();
            audioTrack = null;
        }
    }

    private void startAudio() {
        if (rendering) return;
        int minBuffer = AudioTrack.getMinBufferSize(44100, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT);
        if (minBuffer <= 0) minBuffer = 16384;
        audioTrack = new AudioTrack.Builder()
            .setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build())
            .setAudioFormat(new AudioFormat.Builder()
                .setSampleRate(44100)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                .build())
            .setBufferSizeInBytes(Math.max(minBuffer * 2, 32768))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build();
        if (audioTrack.getState() != AudioTrack.STATE_INITIALIZED) {
            audioTrack.release();
            audioTrack = null;
            throw new IllegalStateException("Hindi ma-initialize ang Android audio output.");
        }
        audioTrack.play();
        rendering = true;
        audioThread = new Thread(() -> {
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO);
            short[] buffer = new short[2048];
            while (rendering) {
                nativeRender(buffer, 1024);
                int offset = 0;
                while (rendering && offset < buffer.length) {
                    int written = audioTrack.write(
                        buffer,
                        offset,
                        buffer.length - offset,
                        AudioTrack.WRITE_BLOCKING
                    );
                    if (written <= 0) {
                        rendering = false;
                        break;
                    }
                    offset += written;
                }
            }
        }, "NativeFluidSynthAudio");
        audioThread.start();
    }

    public void noteOn(int channel, int note, int velocity) { nativeNoteOn(channel, note, velocity); }
    public void noteOff(int channel, int note) { nativeNoteOff(channel, note); }
    public void stopAll() { nativeStopAll(); }
    public void controlChange(int channel, int controller, int value) { nativeControlChange(channel, controller, value); }
    public void programChange(int channel, int program) { nativeProgramChange(channel, program); }
    public void pitchBend(int channel, int value) { nativePitchBend(channel, value); }

    private static native boolean nativeLoadSoundFont(String path);
    private static native void nativeUnload();
    private static native void nativeNoteOn(int channel, int note, int velocity);
    private static native void nativeNoteOff(int channel, int note);
    private static native void nativeStopAll();
    private static native void nativeControlChange(int channel, int controller, int value);
    private static native void nativeProgramChange(int channel, int program);
    private static native void nativePitchBend(int channel, int value);
    private static native int nativeRender(short[] output, int frames);
}
