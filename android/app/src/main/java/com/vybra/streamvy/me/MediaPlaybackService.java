package com.vybra.streamvy.me;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * MediaPlaybackService — foreground service owning the MediaSessionCompat
 * and the MediaStyle notification that back the lock screen / notification
 * shade media controls.
 *
 * The WebView keeps playing the actual audio; this service mirrors the
 * state (track, artwork, play/pause, position) into the system UI and
 * routes transport buttons — including the custom "Lyrics" action — back
 * to JS through {@link VybraMediaPlugin}.
 */
public class MediaPlaybackService extends Service {

    public static final String ACTION_UPDATE = "me.streamvy.media.UPDATE";
    public static final String ACTION_STATE  = "me.streamvy.media.STATE";
    public static final String ACTION_STOP   = "me.streamvy.media.STOP";

    public static final String EXTRA_TITLE       = "me.streamvy.media.TITLE";
    public static final String EXTRA_ARTIST      = "me.streamvy.media.ARTIST";
    public static final String EXTRA_ALBUM       = "me.streamvy.media.ALBUM";
    public static final String EXTRA_ARTWORK     = "me.streamvy.media.ARTWORK";
    public static final String EXTRA_DURATION_SEC = "me.streamvy.media.DURATION_SEC";
    public static final String EXTRA_PLAYING     = "me.streamvy.media.PLAYING";
    public static final String EXTRA_POSITION_SEC = "me.streamvy.media.POSITION_SEC";
    public static final String EXTRA_OPEN_LYRICS = "vybra_open_lyrics";
    public static final String EXTRA_LIKED       = "me.streamvy.media.LIKED";

    private static final String CHANNEL_ID  = "vybra_playback";
    private static final int NOTIF_ID       = 0x7AB1;
    private static final String SESSION_TAG = "VybraMedia";
    private static final String LYRICS_ACTION = "me.streamvy.media.LYRICS";
    private static final String LIKE_ACTION = "me.streamvy.media.LIKE";

    /**
     * Partial wake lock held while audio plays. Without it the CPU can sleep
     * the moment the screen turns off and the WebView's audio decoder freezes
     * mid-track — the classic "music stops when I lock the phone" bug.
     */
    private PowerManager.WakeLock wakeLock = null;

    /** Lets the plugin pick startForegroundService only when actually needed. */
    private static volatile boolean running = false;

    static boolean isRunning() { return running; }

    private MediaSessionCompat session;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService artExecutor = Executors.newSingleThreadExecutor();

    private String title = "";
    private String artist = "";
    private String album = "";
    private String artworkUrl = "";
    private String artKey = null;
    private Bitmap artBitmap = null;
    private double durationSec = 0;
    private double positionSec = 0;
    private boolean playing = false;
    private boolean liked = false;
    private boolean foreground = false;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        session = new MediaSessionCompat(this, SESSION_TAG);
        session.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { VybraMediaPlugin.emitEvent("onPlay"); }
            @Override public void onPause() { VybraMediaPlugin.emitEvent("onPause"); }
            @Override public void onStop() { VybraMediaPlugin.emitEvent("onPause"); }
            @Override public void onSkipToNext() { VybraMediaPlugin.emitEvent("onNext"); }
            @Override public void onSkipToPrevious() { VybraMediaPlugin.emitEvent("onPrev"); }
            @Override public void onSeekTo(long posMs) { VybraMediaPlugin.emitSeek(posMs / 1000.0); }
            @Override public void onCustomAction(String action, Bundle extras) {
                if (LYRICS_ACTION.equals(action)) openLyrics();
                else if (LIKE_ACTION.equals(action)) VybraMediaPlugin.emitEvent("onLike");
            }
        });
        session.setActive(true);
        running = true;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_STOP.equals(action)) {
            teardown();
            return START_NOT_STICKY;
        }
        // Transport buttons arrive as intents against this service. publish()
        // first: startForegroundService promises a foreground within 5s.
        if ("me.streamvy.media PLAY".equals(action)) { publish(); dispatchPlay(); return START_NOT_STICKY; }
        if ("me.streamvy.media PAUSE".equals(action)) { publish(); dispatchPause(); return START_NOT_STICKY; }
        if ("me.streamvy.media NEXT".equals(action)) { publish(); session.getController().getTransportControls().skipToNext(); return START_NOT_STICKY; }
        if ("me.streamvy.media PREV".equals(action)) { publish(); session.getController().getTransportControls().skipToPrevious(); return START_NOT_STICKY; }
        if (LYRICS_ACTION.equals(action)) { publish(); openLyrics(); return START_NOT_STICKY; }
        if (LIKE_ACTION.equals(action)) { publish(); VybraMediaPlugin.emitEvent("onLike"); return START_NOT_STICKY; }

        if (intent != null) {
            if (ACTION_UPDATE.equals(action)) {
                String t = intent.getStringExtra(EXTRA_TITLE);
                String ar = intent.getStringExtra(EXTRA_ARTIST);
                String al = intent.getStringExtra(EXTRA_ALBUM);
                String aw = intent.getStringExtra(EXTRA_ARTWORK);
                if (t != null) title = t;
                if (ar != null) artist = ar;
                if (al != null) album = al;
                if (aw != null) artworkUrl = aw;
                liked = intent.getBooleanExtra(EXTRA_LIKED, liked);
                durationSec = intent.getDoubleExtra(EXTRA_DURATION_SEC, durationSec);
                loadArtwork(artworkUrl);
                pushMetadata();
            } else if (ACTION_STATE.equals(action)) {
                playing = intent.getBooleanExtra(EXTRA_PLAYING, playing);
                positionSec = intent.getDoubleExtra(EXTRA_POSITION_SEC, positionSec);
                durationSec = intent.getDoubleExtra(EXTRA_DURATION_SEC, durationSec);
                updateWakeLock(playing);
                pushPlaybackState();
            }
        }

        publish();
        return START_STICKY;
    }

    private void dispatchPlay() { session.getController().getTransportControls().play(); }
    private void dispatchPause() { session.getController().getTransportControls().pause(); }

    /** Hold a partial wake lock while playing so screen-off can't freeze audio. */
    private void updateWakeLock(boolean acquire) {
        try {
            if (acquire) {
                if (wakeLock == null) {
                    PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                    if (pm == null) return;
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Vybra:playback");
                    wakeLock.setReferenceCounted(false);
                }
                if (!wakeLock.isHeld()) wakeLock.acquire();
            } else if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception ignored) { /* wakelock denied — playback still works while the device is awake */ }
    }

    /** Bring the app up on the Now Playing sheet's lyrics tab. */
    private void openLyrics() {
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            intent.putExtra(EXTRA_OPEN_LYRICS, true);
            startActivity(intent);
        } catch (Exception ignored) {}
        VybraMediaPlugin.emitEvent("onOpenLyrics");
    }

    // ── Session state ───────────────────────────────────────────────────────

    private void pushMetadata() {
        if (session == null) return;
        MediaMetadataCompat.Builder b = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album);
        if (durationSec > 0) {
            b.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, (long) (durationSec * 1000));
        }
        if (artBitmap != null) {
            b.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artBitmap);
        }
        session.setMetadata(b.build());
    }

    private void pushPlaybackState() {
        if (session == null) return;
        session.setPlaybackState(
            new PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY
                        | PlaybackStateCompat.ACTION_PAUSE
                        | PlaybackStateCompat.ACTION_PLAY_PAUSE
                        | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                        | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                        | PlaybackStateCompat.ACTION_SEEK_TO
                        | PlaybackStateCompat.ACTION_STOP
                )
                .setState(
                    playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                    (long) (positionSec * 1000),
                    playing ? 1f : 0f
                )
                .build()
        );
    }

    // ── Notification ────────────────────────────────────────────────────────

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW
        );
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

    private PendingIntent servicePending(String action, int requestCode) {
        Intent intent = new Intent(this, MediaPlaybackService.class).setAction(action);
        return PendingIntent.getService(
            this, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private Notification buildNotification() {
        boolean showPause = playing;
        Intent content = new Intent(this, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 0, content, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_music)
            .setContentTitle(title.isEmpty() ? getString(R.string.app_name) : title)
            .setContentText(artist)
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setOngoing(playing)
            .addAction(new NotificationCompat.Action(
                R.drawable.ic_media_prev, "Previous",
                servicePending("me.streamvy.media PREV", 3)))
            .addAction(new NotificationCompat.Action(
                showPause ? R.drawable.ic_media_pause : R.drawable.ic_media_play,
                showPause ? "Pause" : "Play",
                servicePending(showPause ? "me.streamvy.media PAUSE" : "me.streamvy.media PLAY", 1)))
            .addAction(new NotificationCompat.Action(
                R.drawable.ic_media_next, "Next",
                servicePending("me.streamvy.media NEXT", 2)))
            .addAction(new NotificationCompat.Action(
                R.drawable.ic_media_like, liked ? "Unlike" : "Like",
                servicePending(LIKE_ACTION, 5)))
            .addAction(new NotificationCompat.Action(
                R.drawable.ic_media_lyrics, "Lyrics",
                servicePending(LYRICS_ACTION, 4)))
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2));

        if (artBitmap != null) b.setLargeIcon(artBitmap);
        return b.build();
    }

    /** Post (or promote to foreground) the notification with current state. */
    private void publish() {
        Notification notification = buildNotification();
        if (!foreground) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(
                        NOTIF_ID, notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                    );
                } else {
                    startForeground(NOTIF_ID, notification);
                }
                foreground = true;
            } catch (Exception ignored) {}
        } else {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, notification);
        }
    }

    // ── Artwork ─────────────────────────────────────────────────────────────

    private void loadArtwork(String url) {
        if (url == null || url.equals(artKey)) return;
        artKey = url;
        artExecutor.execute(() -> {
            Bitmap bmp = fetchBitmap(url);
            main.post(() -> {
                if (!url.equals(artKey)) return; // a newer track won the race
                artBitmap = bmp;
                pushMetadata();
                publish();
            });
        });
    }

    private Bitmap fetchBitmap(String url) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setInstanceFollowRedirects(true);
            InputStream in = connection.getInputStream();
            Bitmap raw = BitmapFactory.decodeStream(in);
            if (raw == null) return null;
            // Square-crop to 512px — what lock screens expect for largeIcon.
            int size = 512;
            int w = raw.getWidth(), h = raw.getHeight();
            int crop = Math.min(w, h);
            Bitmap square = Bitmap.createBitmap(raw, (w - crop) / 2, (h - crop) / 2, crop, crop);
            return Bitmap.createScaledBitmap(square, size, size, true);
        } catch (Exception e) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────

    private void teardown() {
        updateWakeLock(false);
        try { if (session != null) session.setActive(false); } catch (Exception ignored) {}
        if (foreground) {
            stopForeground(true);
            foreground = false;
        }
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        updateWakeLock(false);
        artExecutor.shutdownNow();
        try { if (session != null) session.release(); } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
