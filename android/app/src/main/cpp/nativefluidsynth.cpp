#include <jni.h>
#include <fluidsynth.h>
#include <mutex>
#include <vector>

static std::mutex synthMutex;
static fluid_settings_t *settings = nullptr;
static fluid_synth_t *synth = nullptr;

extern "C" JNIEXPORT jboolean JNICALL
Java_com_karaoke_app_NativeFluidSynth_nativeLoadSoundFont(JNIEnv *env, jobject, jstring path) {
    const char *soundFontPath = env->GetStringUTFChars(path, nullptr);
    std::lock_guard<std::mutex> lock(synthMutex);
    if (!settings) {
        settings = new_fluid_settings();
        fluid_settings_setnum(settings, "synth.sample-rate", 44100.0);
        fluid_settings_setint(settings, "synth.polyphony", 256);
        synth = new_fluid_synth(settings);
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
    jsize available = env->GetArrayLength(output);
    const int samples = std::min(static_cast<int>(available), frames * 2);
    std::vector<jshort> buffer(samples);
    const int rendered = fluid_synth_write_s16(synth, frames, buffer.data(), 0, 2, buffer.data(), 1, 2);
    env->SetShortArrayRegion(output, 0, samples, buffer.data());
    return rendered;
}
