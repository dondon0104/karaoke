package com.karaoke.app;

import android.content.Intent;
import android.net.Uri;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import android.provider.OpenableColumns;
import android.app.ActivityManager;
import android.os.StatFs;
import android.widget.Toast;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

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
            "application/zip",
            "audio/*"
        });
        startActivityForResult(call, intent, "handleSoundFontResult");
    }

    @ActivityCallback
    public void handleSoundFontResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
            call.reject("Hindi pumili ng SoundFont.");
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) {
            call.reject("Walang napiling SoundFont file.");
            return;
        }
        showStatus("Binabasa ang napiling SoundFont...");
        getBridge().execute(() -> {
            File target = null;
            try {
                String displayName = getDisplayName(uri);
                String responseFileName = displayName == null ? "SoundFont.sf2" : displayName;
                if (displayName == null) displayName = "";
                String lowerName = displayName.toLowerCase(java.util.Locale.ROOT);
                String mimeType = getContext().getContentResolver().getType(uri);
                boolean isZip = lowerName.endsWith(".zip")
                    || "application/zip".equalsIgnoreCase(mimeType)
                    || "application/x-zip-compressed".equalsIgnoreCase(mimeType)
                    || isZipContent(uri);
                String safeBaseName = displayName.replaceAll("[^A-Za-z0-9._-]", "_");
                if (safeBaseName.isEmpty()) safeBaseName = "soundfont";
                if (safeBaseName.toLowerCase(java.util.Locale.ROOT).endsWith(".zip")) {
                    safeBaseName = safeBaseName.substring(0, safeBaseName.length() - 4);
                }
                if (!safeBaseName.toLowerCase(java.util.Locale.ROOT).endsWith(".sf2")) safeBaseName += ".sf2";
                target = new File(getContext().getFilesDir(), "soundfont-" + System.currentTimeMillis() + "-" + safeBaseName);
                String loadedFileName;
                try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                    if (input == null) throw new java.io.IOException("Hindi mabuksan ang napiling file.");
                    if (isZip) {
                        loadedFileName = extractSoundFontFromZip(input, target);
                    } else if (lowerName.endsWith(".sf2")) {
                        copyToFile(input, target);
                        loadedFileName = displayName;
                    } else {
                        throw new java.io.IOException("Pumili ng .sf2 file o ZIP na may laman na .sf2.");
                    }
                }
                validateNativeLoadResources(target);
                if (!synth.loadSoundFont(target.getAbsolutePath())) {
                    throw new java.io.IOException("Hindi ma-load ang SoundFont sa native audio engine.");
                }
                com.getcapacitor.JSObject response = new com.getcapacitor.JSObject();
                response.put("path", target.getAbsolutePath());
                response.put("fileName", loadedFileName == null ? responseFileName : loadedFileName);
                call.resolve(response);
                showStatus("SoundFont handa na.");
            } catch (Exception exception) {
                if (target != null && target.exists()) target.delete();
                String message = exception.getMessage();
                String errorMessage = message == null ? "Hindi mabasa ang napiling file." : message;
                call.reject("Hindi ma-import ang SoundFont: " + errorMessage);
                showStatus("Hindi ma-import: " + errorMessage);
            } catch (UnsatisfiedLinkError error) {
                if (target != null && target.exists()) target.delete();
                call.reject("Hindi available ang native audio engine sa APK na ito. Mag-download ng bagong APK.");
                showStatus("Walang native audio engine sa APK.");
            }
        });
    }

    private void showStatus(String message) {
        getBridge().executeOnMainThread(() ->
            Toast.makeText(getContext(), message, Toast.LENGTH_LONG).show()
        );
    }

    private void validateNativeLoadResources(File target) throws java.io.IOException {
        long requiredBytes = target.length();
        StatFs storage = new StatFs(getContext().getFilesDir().getAbsolutePath());
        long availableStorage = storage.getAvailableBytes();
        if (availableStorage < requiredBytes + 256L * 1024L * 1024L) {
            throw new java.io.IOException("Kulang ang phone storage para sa SoundFont. Kailangan pa ng humigit-kumulang "
                + ((requiredBytes + 256L * 1024L * 1024L) / (1024L * 1024L * 1024L)) + " GB na bakanteng storage.");
        }
        ActivityManager.MemoryInfo memoryInfo = new ActivityManager.MemoryInfo();
        ActivityManager activityManager = (ActivityManager) getContext().getSystemService(android.content.Context.ACTIVITY_SERVICE);
        if (activityManager != null) activityManager.getMemoryInfo(memoryInfo);
        // FluidSynth loads the SoundFont natively. Keep a safety margin, but
        // do not reject large fonts based on Android's conservative availMem
        // estimate before the native loader gets a chance to load them.
        long minimumMemory = requiredBytes + 256L * 1024L * 1024L;
        if (memoryInfo != null && memoryInfo.availMem < minimumMemory) {
            throw new java.io.IOException("Kulang ang available RAM ng phone para i-load ang "
                + (requiredBytes / (1024L * 1024L * 1024L)) + " GB SoundFont. Isara muna ang ibang apps o gumamit ng mas maliit na SoundFont.");
        }
    }

    private void copyToFile(InputStream input, File target) throws java.io.IOException {
        try (FileOutputStream output = new FileOutputStream(target)) {
            byte[] buffer = new byte[1024 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
        }
    }

    private String extractSoundFontFromZip(InputStream input, File target) throws java.io.IOException {
        try (ZipInputStream zipInput = new ZipInputStream(input)) {
            ZipEntry entry;
            while ((entry = zipInput.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                String entryName = entry.getName();
                if (!entryName.toLowerCase(java.util.Locale.ROOT).endsWith(".sf2")) continue;
                copyToFile(zipInput, target);
                return entryName.substring(entryName.lastIndexOf('/') + 1);
            }
        }
        throw new java.io.IOException("Walang .sf2 SoundFont sa loob ng ZIP.");
    }

    private boolean isZipContent(Uri uri) {
        try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
            if (input == null) return false;
            return input.read() == 'P' && input.read() == 'K' && input.read() == 3 && input.read() == 4;
        } catch (java.io.IOException exception) {
            return false;
        }
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
    public void stopAll(PluginCall call) {
        synth.stopAll();
        call.resolve();
    }

    @com.getcapacitor.PluginMethod
    public void scheduleEvents(PluginCall call) {
        JSONArray events = call.getData().optJSONArray("events");
        if (events == null) {
            call.reject("Missing MIDI events.");
            return;
        }

        try {
            for (int index = 0; index < events.length(); index++) {
                JSONObject event = events.getJSONObject(index);
                String type = event.getString("type");
                int channel = event.getInt("channel");
                int data1 = event.getInt("data1");
                int data2 = event.getInt("data2");
                int delayMs = event.getInt("delayMs");
                boolean supportedType = "noteOn".equals(type)
                    || "noteOff".equals(type)
                    || "controller".equals(type)
                    || "programChange".equals(type)
                    || "pitchBend".equals(type);
                if (!supportedType || channel < 0 || channel > 15 || delayMs < 0 || delayMs > 1000) {
                    throw new JSONException("Invalid MIDI event timing or channel.");
                }
                synth.scheduleEvent(type, channel, data1, data2, delayMs);
            }
            call.resolve();
        } catch (JSONException exception) {
            call.reject("Invalid MIDI event data: " + exception.getMessage());
        }
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
