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
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Foreground audio service. ExoPlayer owns the URL and all transport state. */
public class MediaPlaybackService extends Service {

    public static final String ACTION_UPDATE = "me.streamvy.media.UPDATE";
    public static final String ACTION_STATE = "me.streamvy.media.STATE";
    public static final String ACTION_START = "me.streamvy.media.START_AUDIO";
    public static final String ACTION_CONTROL = "me.streamvy.media.CONTROL_AUDIO";
    public static final String ACTION_STOP = "me.streamvy.media.STOP";

    public static final String EXTRA_TITLE = "me.streamvy.media.TITLE";
    public static final String EXTRA_ARTIST = "me.streamvy.media.ARTIST";
    public static final String EXTRA_ALBUM = "me.streamvy.media.ALBUM";
    public static final String EXTRA_ARTWORK = "me.streamvy.media.ARTWORK";
    public static final String EXTRA_DURATION_SEC = "me.streamvy.media.DURATION_SEC";
    public static final String EXTRA_PLAYING = "me.streamvy.media.PLAYING";
    public static final String EXTRA_POSITION_SEC = "me.streamvy.media.POSITION_SEC";
    public static final String EXTRA_URL = "me.streamvy.media.URL";
    public static final String EXTRA_VOLUME = "me.streamvy.media.VOLUME";
    public static final String EXTRA_CONTROL = "me.streamvy.media.CONTROL";
    public static final String EXTRA_OPEN_LYRICS = "vybra_open_lyrics";
    public static final String EXTRA_LIKED = "me.streamvy.media.LIKED";

    private static final String CHANNEL_ID = "vybra_playback";
    private static final int NOTIF_ID = 0x7AB1;
    private static final String SESSION_TAG = "VybraMedia";
    private static final String LYRICS_ACTION = "me.streamvy.media.LYRICS";
    private static final String LIKE_ACTION = "me.streamvy.media.LIKE";
    private static final long UNKNOWN_DURATION_MS = C.TIME_UNSET;

    private static volatile boolean running = false;
    private static volatile boolean statePlaying = false;
    private static volatile double statePositionSec = 0d;
    private static volatile double stateDurationSec = 0d;

    static boolean isRunning() { return running; }
    static double[] getAudioState() {
        return new double[] { statePlaying ? 1d : 0d, statePositionSec, stateDurationSec };
    }

    private ExoPlayer player;
    private MediaSessionCompat session;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService artExecutor = Executors.newSingleThreadExecutor();
    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if (player == null || !foreground) return;
            reportState();
            main.postDelayed(this, 1000L);
        }
    };

    private String title = "";
    private String artist = "";
    private String album = "";
    private String artworkUrl = "";
    private String artKey = null;
    private Bitmap artBitmap;
    private double declaredDurationSec = 0d;
    private boolean legacyPlaying = false;
    private double legacyPositionSec = 0d;
    private boolean liked = false;
    private boolean foreground = false;

    @Override public void onCreate() {
        super.onCreate();
        createChannel();
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build();
        player = new ExoPlayer.Builder(this).build();
        player.setAudioAttributes(audioAttributes, true); // ExoPlayer requests/releases audio focus.
        player.setHandleAudioBecomingNoisy(true);
        player.setWakeMode(C.WAKE_MODE_LOCAL); // ExoPlayer owns/releases its CPU wake lock.
        player.addListener(new Player.Listener() {
            @Override public void onIsPlayingChanged(boolean isPlaying) {
                updateSessionAndNotification();
                reportState();
                if (isPlaying) startTicker();
            }
            @Override public void onPlaybackStateChanged(int playbackState) {
                updateSessionAndNotification();
                reportState();
                if (playbackState == Player.STATE_ENDED) VybraMediaPlugin.emitAudioEnded();
            }
            @Override public void onPlayerError(PlaybackException error) {
                reportState();
                VybraMediaPlugin.emitAudioError(error.getMessage() == null ? "Audio playback failed" : error.getMessage());
                updateSessionAndNotification();
            }
        });

        session = new MediaSessionCompat(this, SESSION_TAG);
        session.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() {
                if (player != null) player.play();
                VybraMediaPlugin.emitEvent("onPlay");
            }
            @Override public void onPause() {
                if (player != null) player.pause();
                VybraMediaPlugin.emitEvent("onPause");
            }
            @Override public void onStop() { stopPlayback(); }
            @Override public void onSkipToNext() { VybraMediaPlugin.emitEvent("onNext"); }
            @Override public void onSkipToPrevious() { VybraMediaPlugin.emitEvent("onPrev"); }
            @Override public void onSeekTo(long posMs) {
                seekTo(posMs / 1000d);
                VybraMediaPlugin.emitSeek(posMs / 1000d);
            }
            @Override public void onCustomAction(String action, Bundle extras) {
                if (LYRICS_ACTION.equals(action)) openLyrics();
                else if (LIKE_ACTION.equals(action)) VybraMediaPlugin.emitEvent("onLike");
            }
        });
        session.setActive(true);
        running = true;
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopPlayback();
            teardown();
            return START_NOT_STICKY;
        }

        // A cold foreground-service start must publish a notification immediately.
        if (ACTION_START.equals(action) || ACTION_CONTROL.equals(action) || isTransportAction(action)
                || LYRICS_ACTION.equals(action) || LIKE_ACTION.equals(action)) publish();

        if ("me.streamvy.media PLAY".equals(action)) { play(); return START_NOT_STICKY; }
        if ("me.streamvy.media PAUSE".equals(action)) { pause(); return START_NOT_STICKY; }
        if ("me.streamvy.media NEXT".equals(action)) { VybraMediaPlugin.emitEvent("onNext"); return START_NOT_STICKY; }
        if ("me.streamvy.media PREV".equals(action)) { VybraMediaPlugin.emitEvent("onPrev"); return START_NOT_STICKY; }
        if (LYRICS_ACTION.equals(action)) { openLyrics(); return START_NOT_STICKY; }
        if (LIKE_ACTION.equals(action)) { VybraMediaPlugin.emitEvent("onLike"); return START_NOT_STICKY; }

        if (intent != null && ACTION_START.equals(action)) startAudio(intent);
        else if (intent != null && ACTION_CONTROL.equals(action)) applyControl(intent);
        else if (intent != null && ACTION_UPDATE.equals(action)) updateMetadata(intent);
        else if (intent != null && ACTION_STATE.equals(action)) {
            // Compatibility for pre-native clients; this never drives ExoPlayer.
            legacyPlaying = intent.getBooleanExtra(EXTRA_PLAYING, legacyPlaying);
            legacyPositionSec = intent.getDoubleExtra(EXTRA_POSITION_SEC, legacyPositionSec);
            double duration = intent.getDoubleExtra(EXTRA_DURATION_SEC, declaredDurationSec);
            if (duration > 0d) declaredDurationSec = duration;
            updateSessionAndNotification();
            reportState();
        }
        if (player != null && player.getMediaItemCount() > 0) startTicker();
        return START_STICKY;
    }

    private static boolean isTransportAction(String action) {
        return "me.streamvy.media PLAY".equals(action) || "me.streamvy.media PAUSE".equals(action)
            || "me.streamvy.media NEXT".equals(action) || "me.streamvy.media PREV".equals(action);
    }

    private void startAudio(Intent intent) {
        String url = intent.getStringExtra(EXTRA_URL);
        if (url == null || url.trim().isEmpty()) {
            VybraMediaPlugin.emitAudioError("Audio URL is required");
            return;
        }
        title = valueOrEmpty(intent.getStringExtra(EXTRA_TITLE));
        artist = valueOrEmpty(intent.getStringExtra(EXTRA_ARTIST));
        album = valueOrEmpty(intent.getStringExtra(EXTRA_ALBUM));
        artworkUrl = valueOrEmpty(intent.getStringExtra(EXTRA_ARTWORK));
        declaredDurationSec = Math.max(0d, intent.getDoubleExtra(EXTRA_DURATION_SEC, 0d));
        double initialPosition = Math.max(0d, intent.getDoubleExtra(EXTRA_POSITION_SEC, 0d));
        artBitmap = null;
        artKey = null;
        loadArtwork(artworkUrl);
        try {
            player.setMediaItem(MediaItem.fromUri(Uri.parse(url)));
            player.prepare();
            if (initialPosition > 0d) player.seekTo((long) (initialPosition * 1000d));
            player.setVolume(clampVolume(intent.getFloatExtra(EXTRA_VOLUME, 1f)));
            player.play();
            legacyPlaying = true;
            legacyPositionSec = initialPosition;
            pushMetadata();
            startTicker();
            updateSessionAndNotification();
            reportState();
        } catch (Exception e) {
            VybraMediaPlugin.emitAudioError(e.getMessage() == null ? "Unable to start audio" : e.getMessage());
        }
    }

    private void applyControl(Intent intent) {
        String control = intent.getStringExtra(EXTRA_CONTROL);
        if ("play".equals(control)) play();
        else if ("pause".equals(control)) pause();
        else if ("seek".equals(control)) {
            double position = Math.max(0d, intent.getDoubleExtra(EXTRA_POSITION_SEC, 0d));
            seekTo(position);
            VybraMediaPlugin.emitSeek(position);
        } else if ("volume".equals(control)) {
            if (player != null) player.setVolume(clampVolume(intent.getFloatExtra(EXTRA_VOLUME, 1f)));
        } else if ("stop".equals(control)) {
            stopPlayback();
            teardown();
            return;
        }
        updateSessionAndNotification();
        reportState();
    }

    private static float clampVolume(float volume) { return Math.max(0f, Math.min(1f, volume)); }
    private static String valueOrEmpty(String value) { return value == null ? "" : value; }

    private void play() {
        if (player != null && player.getMediaItemCount() > 0) player.play();
        legacyPlaying = true;
        startTicker();
        reportState();
    }
    private void pause() {
        if (player != null) player.pause();
        legacyPlaying = false;
        updateSessionAndNotification();
        reportState();
    }
    private void seekTo(double positionSec) {
        if (player != null && player.getMediaItemCount() > 0) player.seekTo((long) (Math.max(0d, positionSec) * 1000d));
        else legacyPositionSec = Math.max(0d, positionSec);
        reportState();
    }
    private void stopPlayback() {
        main.removeCallbacks(ticker);
        if (player != null) {
            player.stop();
            player.clearMediaItems();
        }
        legacyPlaying = false;
        legacyPositionSec = 0d;
        reportState();
    }

    private void startTicker() {
        main.removeCallbacks(ticker);
        if (player != null && player.getMediaItemCount() > 0 && foreground) main.postDelayed(ticker, 1000L);
    }

    private boolean hasNativeItem() { return player != null && player.getMediaItemCount() > 0; }
    private double getPositionSec() {
        if (hasNativeItem()) return Math.max(0d, player.getCurrentPosition() / 1000d);
        return Math.max(0d, legacyPositionSec);
    }
    private double getDurationSec() {
        if (hasNativeItem()) {
            long duration = player.getDuration();
            if (duration != UNKNOWN_DURATION_MS && duration >= 0L) return duration / 1000d;
        }
        return Math.max(0d, declaredDurationSec);
    }
    private boolean isPlaying() { return hasNativeItem() ? player.isPlaying() : legacyPlaying; }

    private void reportState() {
        boolean nowPlaying = isPlaying();
        double position = getPositionSec();
        double duration = getDurationSec();
        statePlaying = nowPlaying;
        statePositionSec = position;
        stateDurationSec = duration;
        VybraMediaPlugin.emitAudioState(nowPlaying, position, duration);
    }

    private void updateMetadata(Intent intent) {
        String t = intent.getStringExtra(EXTRA_TITLE);
        String ar = intent.getStringExtra(EXTRA_ARTIST);
        String al = intent.getStringExtra(EXTRA_ALBUM);
        String aw = intent.getStringExtra(EXTRA_ARTWORK);
        if (t != null) title = t;
        if (ar != null) artist = ar;
        if (al != null) album = al;
        if (aw != null) artworkUrl = aw;
        liked = intent.getBooleanExtra(EXTRA_LIKED, liked);
        double duration = intent.getDoubleExtra(EXTRA_DURATION_SEC, declaredDurationSec);
        if (duration > 0d) declaredDurationSec = duration;
        if (!artworkUrl.equals(artKey)) {
            artBitmap = null;
            loadArtwork(artworkUrl);
        }
        pushMetadata();
        updateSessionAndNotification();
    }

    private void pushMetadata() {
        if (session == null) return;
        MediaMetadataCompat.Builder b = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album);
        if (getDurationSec() > 0d) b.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, (long) (getDurationSec() * 1000d));
        if (artBitmap != null) b.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artBitmap);
        session.setMetadata(b.build());
    }

    private void pushPlaybackState() {
        if (session == null) return;
        boolean playing = isPlaying();
        session.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS | PlaybackStateCompat.ACTION_SEEK_TO
                | PlaybackStateCompat.ACTION_STOP)
            .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                (long) (getPositionSec() * 1000d), playing ? 1f : 0f)
            .build());
    }

    private void updateSessionAndNotification() {
        pushMetadata();
        pushPlaybackState();
        if (foreground) publish();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

    private PendingIntent servicePending(String action, int requestCode) {
        Intent intent = new Intent(this, MediaPlaybackService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification buildNotification() {
        boolean showPause = isPlaying();
        Intent content = new Intent(this, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, content,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_music)
            .setContentTitle(title.isEmpty() ? getString(R.string.app_name) : title)
            .setContentText(artist)
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setOngoing(showPause)
            .addAction(new NotificationCompat.Action(R.drawable.ic_media_prev, "Previous", servicePending("me.streamvy.media PREV", 3)))
            .addAction(new NotificationCompat.Action(showPause ? R.drawable.ic_media_pause : R.drawable.ic_media_play,
                showPause ? "Pause" : "Play", servicePending(showPause ? "me.streamvy.media PAUSE" : "me.streamvy.media PLAY", 1)))
            .addAction(new NotificationCompat.Action(R.drawable.ic_media_next, "Next", servicePending("me.streamvy.media NEXT", 2)))
            .addAction(new NotificationCompat.Action(R.drawable.ic_media_like, liked ? "Unlike" : "Like", servicePending(LIKE_ACTION, 5)))
            .addAction(new NotificationCompat.Action(R.drawable.ic_media_lyrics, "Lyrics", servicePending(LYRICS_ACTION, 4)))
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        if (artBitmap != null) b.setLargeIcon(artBitmap);
        return b.build();
    }

    private void publish() {
        Notification notification = buildNotification();
        if (!foreground) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } else startForeground(NOTIF_ID, notification);
                foreground = true;
                startTicker();
            } catch (Exception e) {
                VybraMediaPlugin.emitAudioError(e.getMessage() == null ? "Unable to show playback notification" : e.getMessage());
            }
        } else {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, notification);
        }
    }

    private void loadArtwork(String url) {
        if (url == null || url.isEmpty()) { artKey = url; return; }
        if (url.equals(artKey)) return;
        artKey = url;
        artExecutor.execute(() -> {
            Bitmap bmp = fetchBitmap(url);
            main.post(() -> {
                if (!url.equals(artKey)) return;
                artBitmap = bmp;
                pushMetadata();
                if (foreground) publish();
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
            try (InputStream in = connection.getInputStream()) {
                Bitmap raw = BitmapFactory.decodeStream(in);
                if (raw == null) return null;
                int crop = Math.min(raw.getWidth(), raw.getHeight());
                Bitmap square = Bitmap.createBitmap(raw, (raw.getWidth() - crop) / 2,
                    (raw.getHeight() - crop) / 2, crop, crop);
                return Bitmap.createScaledBitmap(square, 512, 512, true);
            }
        } catch (Exception e) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void openLyrics() {
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            intent.putExtra(EXTRA_OPEN_LYRICS, true);
            startActivity(intent);
        } catch (Exception ignored) { }
        VybraMediaPlugin.emitEvent("onOpenLyrics");
    }

    private void teardown() {
        main.removeCallbacks(ticker);
        if (foreground) {
            stopForeground(true);
            foreground = false;
        }
        stopSelf();
    }

    @Override public void onDestroy() {
        running = false;
        main.removeCallbacks(ticker);
        try { if (player != null) player.release(); } catch (Exception ignored) { }
        player = null;
        artExecutor.shutdownNow();
        try { if (session != null) { session.setActive(false); session.release(); } } catch (Exception ignored) { }
        statePlaying = false;
        statePositionSec = 0d;
        stateDurationSec = 0d;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
