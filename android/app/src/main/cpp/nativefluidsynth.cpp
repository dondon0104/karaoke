#include <jni.h>
#include <fluidsynth.h>
#include <algorithm>
#include <mutex>

static std::mutex synthMutex;
static fluid_settings_t *settings = nullptr;
static fluid_synth_t *synth = nullptr;

extern "C" JNIEXPORT jboolean JNICALL
Java_com_karaoke_app_NativeFluidSynth_nativeLoadSoundFont(JNIEnv *env, jobject, jstring path) {
    const char *soundFontPath = env->GetStringUTFChars(path, nullptr);
    std::lock_guard<std::mutex> lock(synthMutex);
    if (synth) {
        delete_fluid_synth(synth);
        synth = nullptr;
    }
    if (settings) {
        delete_fluid_settings(settings);
        settings = nullptr;
    }
    if (!settings) {
        settings = new_fluid_settings();
        if (!settings) {
            env->ReleaseStringUTFChars(path, soundFontPath);
            return JNI_FALSE;
        }
        fluid_settings_setnum(settings, "synth.sample-rate", 44100.0);
        fluid_settings_setnum(settings, "synth.gain", 0.12);
        fluid_settings_setint(settings, "synth.polyphony", 128);
        synth = new_fluid_synth(settings);
        if (!synth) {
            delete_fluid_settings(settings);
            settings = nullptr;
            env->ReleaseStringUTFChars(path, soundFontPath);
            return JNI_FALSE;
        }
    }
    const int soundFontId = fluid_synth_sfload(synth, soundFontPath, 1);
    env->ReleaseStringUTFChars(path, soundFontPath);
    return soundFontId >= 0 ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_com_karaoke_app_NativeFluidSynth_nativeUnload(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lock(synthMutex);
    if (synth) {
        delete_fluid_synth(synth);
        synth = nullptr;
    }
    if (settings) {
        delete_fluid_settings(settings);
        settings = nullptr;
    }
}

extern "C" JNIEXPORT void JNICALL
Java_com_karaoke_app_NativeFluidSynth_nativeNoteOn(JNIEnv *, jobject, jint channel, jint note, jint velocity) {
    std::lock_guard<std::mutex> lock(synthMutex);
    if (synth) fluid_synth_noteon(synth, channel, note, velocity);
}

extern "C" JNIEXPORT void JNICALL
Java_com_karaoke_app_NativeFluidSynth_nativeNoteOff(JNIEnv *, jobject, jint channel, jint note) {
    std::lock_guard<std::mutex> lock(synthMutex);
    if (synth) fluid_synth_noteoff(synth, channel, note);
}

extern "C" JNIEXPORT void JNICALL
Java_com_karaoke_app_NativeFluidSynth_nativeStopAll(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lock(synthMutex);
    if (!synth) return;
    for (int channel = 0; channel < 16; ++channel) {
        fluid_synth_cc(synth, channel, 123, 0);
        fluid_synth_cc(synth, channel, 120, 0);
    }
}

extern "C" JNIEXPORT void JNICALL
Java_com_karaoke_app_NativeFluidSynth_nativeControlChange(JNIEnv *, jobject, jint channel, jint controller, jint value) {
    std::lock_guard<std::mutex> lock(synthMutex);
    if (synth) fluid_synth_cc(synth, channel, controller, value);
}

extern "C" JNIEXPORT void JNICALL
Java_com_karaoke_app_NativeFluidSynth_nativeProgramChange(JNIEnv *, jobject, jint channel, jint program) {
    std::lock_guard<std::mutex> lock(synthMutex);
    if (synth) fluid_synth_program_change(synth, channel, program);
}

extern "C" JNIEXPORT void JNICALL
Java_com_karaoke_app_NativeFluidSynth_nativePitchBend(JNIEnv *, jobject, jint channel, jint value) {
    std::lock_guard<std::mutex> lock(synthMutex);
    if (synth) fluid_synth_pitch_bend(synth, channel, value);
}

extern "C" JNIEXPORT jint JNICALL
Java_com_karaoke_app_NativeFluidSynth_nativeRender(JNIEnv *env, jobject, jshortArray output, jint frames) {
    std::lock_guard<std::mutex> lock(synthMutex);
    if (!synth) return 0;
    const jsize available = env->GetArrayLength(output);
    const int boundedFrames = std::min(std::max(static_cast<int>(frames), 0), static_cast<int>(available) / 2);
    if (boundedFrames == 0) return 0;

    jshort *buffer = env->GetShortArrayElements(output, nullptr);
    if (!buffer) return 0;
    const int rendered = fluid_synth_write_s16(synth, boundedFrames, buffer, 0, 2, buffer, 1, 2);
    env->ReleaseShortArrayElements(output, buffer, 0);
    return rendered;
}
