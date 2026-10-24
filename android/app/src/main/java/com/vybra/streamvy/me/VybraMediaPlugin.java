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
    permissions = { @Permission(strings = Manifest.permission.POST_NOTIFICATIONS, alias = "notifications") }
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
