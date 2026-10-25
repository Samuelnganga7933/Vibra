package com.vybra.streamvy.me;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import com.getcapacitor.CapacitorWebView;

/**
 * Chromium parks the WebView at `hidden` window visibility the moment the app
 * leaves the foreground — and with it suspends HTMLMediaElement playback.
 * The <audio> element is this app's whole playback engine, so we hold the
 * window visibility at VISIBLE: media keeps running while the foreground
 * service, wake lock and MediaSession (MediaPlaybackService) do the rest.
 *
 * Registered by shadowing the library resource
 * res/layout/capacitor_bridge_layout_main.xml (app resources win over the
 * library at merge time), pointing its single view at this class.
 */
public class VibraWebView extends CapacitorWebView {

    public VibraWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        super.onWindowVisibilityChanged(View.VISIBLE);
    }

    @Override
    public void dispatchWindowVisibilityChanged(int visibility) {
        // Children (and this view) only ever observe VISIBLE — a background
        // window never reaches Chromium as a hidden WebView.
        super.dispatchWindowVisibilityChanged(View.VISIBLE);
    }
}
