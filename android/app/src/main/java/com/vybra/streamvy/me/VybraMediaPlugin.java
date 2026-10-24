package com.vybra.streamvy.me;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

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
