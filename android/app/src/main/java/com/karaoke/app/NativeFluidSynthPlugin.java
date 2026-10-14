package com.karaoke.app;

import android.content.Intent;
import android.net.Uri;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;

@CapacitorPlugin(name = "NativeFluidSynth")
public class NativeFluidSynthPlugin extends Plugin {
    private final NativeFluidSynth synth = new NativeFluidSynth();

    @Override
    protected void handleOnDestroy() {
        synth.unload();
        super.handleOnDestroy();
    }

    @com.getcapacitor.PluginMethod
    public void loadSoundFont(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("Missing SoundFont path.");
            return;
        }
        if (!synth.loadSoundFont(path)) {
            call.reject("Hindi ma-load ang SoundFont sa native Android audio engine.");
            return;
        }
        call.resolve();
    }

    @com.getcapacitor.PluginMethod
    public void pickAndLoadSoundFont(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
            "application/octet-stream",
            "application/x-soundfont",
            "audio/*"
        });
        startActivityForResult(call, intent, "handleSoundFontResult");
    }

    @ActivityCallback
    private void handleSoundFontResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
            call.reject("Hindi pumili ng SoundFont.");
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) {
            call.reject("Walang napiling SoundFont file.");
            return;
        }
        getBridge().execute(() -> {
            File target = new File(getContext().getFilesDir(), "active-soundfont.sf2");
            try (InputStream input = getContext().getContentResolver().openInputStream(uri);
                 FileOutputStream output = new FileOutputStream(target)) {
                if (input == null) throw new java.io.IOException("Hindi mabuksan ang napiling file.");
                String displayName = getDisplayName(uri);
                if (displayName != null && !displayName.toLowerCase(java.util.Locale.ROOT).endsWith(".sf2")) {
                    throw new java.io.IOException("Pumili ng file na nagtatapos sa .sf2.");
                }
                byte[] buffer = new byte[1024 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                if (!synth.loadSoundFont(target.getAbsolutePath())) {
                    throw new java.io.IOException("Hindi ma-load ang SoundFont sa native audio engine.");
                }
                com.getcapacitor.JSObject response = new com.getcapacitor.JSObject();
                response.put("path", target.getAbsolutePath());
                response.put("fileName", displayName == null ? "SoundFont.sf2" : displayName);
                call.resolve(response);
            } catch (Exception exception) {
                if (target.exists()) target.delete();
                call.reject("Hindi ma-import ang SoundFont: " + exception.getMessage());
            }
        });
    }

    private String getDisplayName(Uri uri) {
        try (android.database.Cursor cursor = getContext().getContentResolver().query(
                uri,
                new String[] { OpenableColumns.DISPLAY_NAME },
                null,
                null,
                null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) return cursor.getString(index);
            }
        } catch (Exception ignored) {
            // Some document providers do not expose a display name.
        }
        return null;
    }

    @com.getcapacitor.PluginMethod
    public void unload(PluginCall call) {
        synth.unload();
        call.resolve();
    }

    @com.getcapacitor.PluginMethod
    public void noteOn(PluginCall call) {
        synth.noteOn(call.getInt("channel", 0), call.getInt("note", 0), call.getInt("velocity", 0));
        call.resolve();
    }

    @com.getcapacitor.PluginMethod
    public void noteOff(PluginCall call) {
        synth.noteOff(call.getInt("channel", 0), call.getInt("note", 0));
        call.resolve();
    }

    @com.getcapacitor.PluginMethod
    public void controlChange(PluginCall call) {
        synth.controlChange(call.getInt("channel", 0), call.getInt("controller", 0), call.getInt("value", 0));
        call.resolve();
    }

    @com.getcapacitor.PluginMethod
    public void programChange(PluginCall call) {
        synth.programChange(call.getInt("channel", 0), call.getInt("program", 0));
        call.resolve();
    }

    @com.getcapacitor.PluginMethod
    public void pitchBend(PluginCall call) {
        synth.pitchBend(call.getInt("channel", 0), call.getInt("value", 8192));
        call.resolve();
    }
}
