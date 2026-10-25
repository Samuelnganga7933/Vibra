package com.vybra.streamvy.me;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.content.ContentValues;
import android.provider.MediaStore;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * VybraMedia — JS bridge for the playback media session.
 *
 * All real work happens in {@link MediaPlaybackService} (a foreground
 * service so music survives the app being backgrounded). The plugin just
 * forwards state into the service and relays user actions from the
 * system UI (notification / lock screen) back to the WebView as events.
 */
@CapacitorPlugin(
    name = "VybraMedia",
    permissions = {
        @Permission(strings = Manifest.permission.POST_NOTIFICATIONS, alias = "notifications"),
        // Two aliases because the media-read permission was renamed in
        // Android 13 and Capacitor 8's @Permission has no per-SDK gating:
        // we consult exactly one alias per device (see audioAlias()).
        @Permission(strings = Manifest.permission.READ_MEDIA_AUDIO, alias = "audioFiles"),
        @Permission(strings = Manifest.permission.READ_EXTERNAL_STORAGE, alias = "audioFilesLegacy")
    }
)
public class VybraMediaPlugin extends Plugin {

    /**
     * Strongest link from the service to JS. The service can outlive a
     * plugin instance (activity rotation), so it is refreshed on load and
     * on every resume.
     */
    private static volatile VybraMediaPlugin activePlugin;

    @Override
    public void load() {
        activePlugin = this;
        consumeOpenLyricsExtra();
    }

    @Override
    protected void handleOnResume() {
        activePlugin = this;
        consumeOpenLyricsExtra();
    }

    @Override
    public void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent != null && intent.getBooleanExtra(MediaPlaybackService.EXTRA_OPEN_LYRICS, false)) {
            intent.removeExtra(MediaPlaybackService.EXTRA_OPEN_LYRICS);
            emitEvent("onOpenLyrics");
        }
    }

    /** Cold start straight into the Lyrics action (process was dead). */
    private void consumeOpenLyricsExtra() {
        Activity activity = getActivity();
        if (activity == null) return;
        Intent intent = activity.getIntent();
        if (intent != null && intent.getBooleanExtra(MediaPlaybackService.EXTRA_OPEN_LYRICS, false)) {
            intent.removeExtra(MediaPlaybackService.EXTRA_OPEN_LYRICS);
            emitEvent("onOpenLyrics");
        }
    }

    static void emitEvent(String event) {
        VybraMediaPlugin plugin = activePlugin;
        if (plugin != null) {
            try { plugin.notifyListeners(event, new JSObject()); } catch (Exception ignored) {}
        }
    }

    static void emitSeek(double positionSec) {
        VybraMediaPlugin plugin = activePlugin;
        if (plugin != null) {
            try {
                JSObject data = new JSObject();
                data.put("positionSec", positionSec);
                plugin.notifyListeners("onSeek", data);
            } catch (Exception ignored) {}
        }
    }

    @PluginMethod
    public void updateNowPlaying(PluginCall call) {
        JSObject opts = call.getData();
        Intent intent = serviceIntent(MediaPlaybackService.ACTION_UPDATE);
        intent.putExtra(MediaPlaybackService.EXTRA_TITLE, opts.getString("title", ""));
        intent.putExtra(MediaPlaybackService.EXTRA_ARTIST, opts.getString("artist", ""));
        intent.putExtra(MediaPlaybackService.EXTRA_ALBUM, opts.getString("album", ""));
        intent.putExtra(MediaPlaybackService.EXTRA_ARTWORK, opts.getString("artworkUrl", ""));
        intent.putExtra(MediaPlaybackService.EXTRA_LIKED, opts.getBoolean("liked", false));
        intent.putExtra(MediaPlaybackService.EXTRA_DURATION_SEC, opts.optDouble("durationSec", 0d));
        startServiceSafely(intent);
        call.resolve();
    }

    @PluginMethod
    public void setPlaybackState(PluginCall call) {
        JSObject opts = call.getData();
        Intent intent = serviceIntent(MediaPlaybackService.ACTION_STATE);
        intent.putExtra(MediaPlaybackService.EXTRA_PLAYING, opts.getBoolean("playing", false));
        intent.putExtra(MediaPlaybackService.EXTRA_POSITION_SEC, opts.optDouble("positionSec", 0d));
        intent.putExtra(MediaPlaybackService.EXTRA_DURATION_SEC, opts.optDouble("durationSec", 0d));
        startServiceSafely(intent);
        call.resolve();
    }

    @PluginMethod
    public void release(PluginCall call) {
        startServiceSafely(serviceIntent(MediaPlaybackService.ACTION_STOP));
        call.resolve();
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve();
            return;
        }
        requestPermissionForAlias("notifications", call, "handleNotificationPermissionResult");
    }

    // ── Local music (the phone's own files, YT-Music style) ────────────────────
    // MediaStore lists every audio file the user already owns; playback reads
    // them straight from disk, so "On this phone" works with no network.

    @PluginMethod
    public void requestAudioPermission(PluginCall call) {
        if (getPermissionState(audioAlias()) == PermissionState.GRANTED) {
            call.resolve();
            return;
        }
        requestPermissionForAlias(audioAlias(), call, "handleAudioPermissionResult");
    }

    /** Android 13+ reads media through READ_MEDIA_AUDIO; older builds use
     *  READ_EXTERNAL_STORAGE. Only ONE alias is ever consulted per device. */
    private static String audioAlias() {
        return Build.VERSION.SDK_INT >= 33 ? "audioFiles" : "audioFilesLegacy";
    }

    /** Permanent deny ("Don't ask again") — the system will never show the
     *  dialog again, so the only way in is the app's settings page. */
    @PluginMethod
    public void openAudioSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void listLocalMusic(PluginCall call) {
        if (getPermissionState(audioAlias()) != PermissionState.GRANTED) {
            call.reject("audio-permission", "E_AUDIO_PERMISSION");
            return;
        }
        JSArray songs = new JSArray();
        try {
            String[] projection = {
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM,
                MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.SIZE,
                MediaStore.Audio.Media.DATE_ADDED,
                MediaStore.Audio.Media.DATA
            };
            // Every audio file the user owns — sideloaded downloads rarely
            // carry IS_MUSIC=1, so match on MIME too or the list looks empty
            // right after the permission is granted. Title-sorted like a library.
            try (Cursor cursor = getContext().getContentResolver().query(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                    projection,
                    MediaStore.Audio.Media.IS_MUSIC + " != 0 OR "
                        + MediaStore.Audio.Media.MIME_TYPE + " LIKE 'audio/%'",
                    null,
                    MediaStore.Audio.Media.TITLE + " ASC")) {
                if (cursor != null) {
                    int iId = cursor.getColumnIndex(MediaStore.Audio.Media._ID);
                    int iTitle = cursor.getColumnIndex(MediaStore.Audio.Media.TITLE);
                    int iArtist = cursor.getColumnIndex(MediaStore.Audio.Media.ARTIST);
                    int iAlbum = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM);
                    int iDuration = cursor.getColumnIndex(MediaStore.Audio.Media.DURATION);
                    int iSize = cursor.getColumnIndex(MediaStore.Audio.Media.SIZE);
                    int iAdded = cursor.getColumnIndex(MediaStore.Audio.Media.DATE_ADDED);
                    int iPath = cursor.getColumnIndex(MediaStore.Audio.Media.DATA);
                    while (cursor.moveToNext()) {
                        String path = iPath >= 0 ? cursor.getString(iPath) : null;
                        if (path == null || path.isEmpty()) continue; // unplayable without a path
                        JSObject song = new JSObject();
                        song.put("id", iId >= 0 ? cursor.getString(iId) : null);
                        song.put("title", iTitle >= 0 ? cursor.getString(iTitle) : null);
                        song.put("artist", iArtist >= 0 ? safeArtist(cursor.getString(iArtist)) : null);
                        song.put("album", iAlbum >= 0 ? cursor.getString(iAlbum) : null);
                        song.put("durationMs", iDuration >= 0 ? cursor.getLong(iDuration) : 0L);
                        song.put("sizeBytes", iSize >= 0 ? cursor.getLong(iSize) : 0L);
                        song.put("dateAdded", iAdded >= 0 ? cursor.getLong(iAdded) : 0L);
                        song.put("path", path);
                        songs.put(song);
                    }
                }
            }
            JSObject ret = new JSObject();
            ret.put("songs", songs);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("audio-permission", "E_AUDIO_PERMISSION");
        } catch (Exception e) {
            call.reject("MediaStore query failed: " + e.getMessage());
        }
    }

    /** MediaStore's null artist shows up as null or the literal "<unknown>". */
    private static String safeArtist(String artist) {
        if (artist == null) return null;
        String trimmed = artist.trim();
        if (trimmed.isEmpty() || "<unknown>".equalsIgnoreCase(trimmed)) return null;
        return trimmed;
    }

    // ── Downloads folder (public Download/Vybra) ────────────────────────────────
    // The Filesystem plugin can't write the shared Downloads collection; this
    // moves a finished temp file there via MediaStore (10+) or the legacy
    // public dir (≤9) so tracks land where the user actually looks for them.

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String source = call.getString("source");
        String fileName = call.getString("fileName");
        if (source == null || fileName == null || fileName.isEmpty()) {
            call.reject("source and fileName are required");
            return;
        }
        File src = new File(source);
        if (!src.exists()) { call.reject("temp file missing"); return; }
        try {
            String outPath;
            long size = src.length();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                values.put(MediaStore.Downloads.MIME_TYPE, "audio/mp4");
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Vybra");
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                ContentResolver resolver = getContext().getContentResolver();
                Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) { call.reject("MediaStore insert failed"); return; }
                try (InputStream in = new FileInputStream(src);
                     OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) throw new java.io.IOException("openOutputStream returned null");
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(uri, values, null, null);
                outPath = queryDataPath(resolver, uri);
                if (outPath == null) {
                    // Own-file reads may deny DATA on exotic OEMs — fall back
                    // to the conventional absolute location.
                    outPath = new File(
                        Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                        "Vybra/" + fileName
                    ).getAbsolutePath();
                }
            } else {
                File dir = new File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Vybra");
                if (!dir.exists() && !dir.mkdirs()) { call.reject("couldn't create Downloads/Vybra"); return; }
                File dst = new File(dir, fileName);
                try (InputStream in = new FileInputStream(src);
                     OutputStream out = new java.io.FileOutputStream(dst)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                outPath = dst.getAbsolutePath();
            }
            JSObject ret = new JSObject();
            ret.put("path", outPath);
            ret.put("size", size);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("save to Downloads failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void fileExists(PluginCall call) {
        String path = call.getString("path");
        if (path == null) { call.reject("path required"); return; }
        File f = new File(path);
        JSObject ret = new JSObject();
        ret.put("exists", f.exists());
        ret.put("size", f.exists() ? f.length() : 0);
        call.resolve(ret);
    }

    @PluginMethod
    public void deleteDownloadFile(PluginCall call) {
        String path = call.getString("path");
        if (path == null) { call.reject("path required"); return; }
        try { new File(path).delete(); } catch (Exception ignored) { /* already gone */ }
        call.resolve();
    }

    /** Absolute path of a MediaStore row we just created (own file → readable). */
    private String queryDataPath(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[]{ MediaStore.MediaColumns.DATA }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(MediaStore.MediaColumns.DATA);
                if (idx >= 0) return cursor.getString(idx);
            }
        } catch (Exception ignored) { /* fall back to the conventional path */ }
        return null;
    }

    @PermissionCallback
    private void handleNotificationPermissionResult(PluginCall call) {
        call.resolve();
    }

    @PermissionCallback
    private void handleAudioPermissionResult(PluginCall call) {
        call.resolve();
    }

    private Intent serviceIntent(String action) {
        Intent intent = new Intent(getContext(), MediaPlaybackService.class);
        intent.setAction(action);
        return intent;
    }

    /** Android 12+ blocks background FGS starts — degrade quietly rather than crash. */
    private void startServiceSafely(Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                // Already-running services take plain startService even from
                // the background; only a cold start needs the FGS variant.
                if (MediaPlaybackService.isRunning()) {
                    getContext().startService(intent);
                } else {
                    getContext().startForegroundService(intent);
                }
            } else {
                getContext().startService(intent);
            }
        } catch (Exception ignored) {}
    }
}
