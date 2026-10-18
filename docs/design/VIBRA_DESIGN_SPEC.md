# Vibra UI redesign spec

Target: existing React + Vite app (dev server on localhost:5173). Inspect the repo first and reuse its components, routing and state. Do not rewrite the app. Restyle and restructure the screens below. The mockups are visual references, so match the look and behaviour, not the markup.

## Cleaning duplicates (from the real Home)
In the Now playing panel remove the second transport row, the second pause button and the heart. Keep: square artwork (crop the video frame to fill, remove the grey circle overlay), title, artist, one NEXT UP row. The bar owns the controls. Recently played cards must be square covers with `object-fit: cover`, with "artist · duration" under the title.

## Hard rules
- No emoji or text glyphs as buttons. Use real SVG icons (use the icon library already in the repo, or lucide-react; stroke 2, rounded caps).
- The current track's controls exist in ONE place: the bottom player bar (title, artist, heart, shuffle/prev/play-pause/next/repeat, progress, lyrics, queue, output device chip, volume). The right panel and full-screen player must not repeat a second set of transport controls.
- First-run must never look empty. Every empty state has an icon/illustration, one line of copy and an action.
- Red (`--accent`) is used sparingly: progress fill, active states, primary CTA. Play/pause is white.
- Thumbnails are square: `aspect-ratio: 1/1; object-fit: cover` (YouTube frames are 16:9 and letterboxed, so crop them).

## Tokens
```
--bg #0b0a10   --panel #14131c   --raised #1f1e2b   --hover #1d1c29
--border #2c2a3e   --text #f4f3f8   --muted #a9a7bd   --dim #8886a0
--accent #e8334f   --accent2 #7a4ae8   --online #3ad07a
font: Plus Jakarta Sans 400/600/800
radius: panels 18, cards 14, thumbs 8-10, pills 999
```

## Contextual UI: show a control only when the user can use it
Every element must answer "what would the user do with this right now?" If nothing, it does not render. Derive it from one selector, e.g. `uiState = { hasPlayback, hasQueue, hasLyrics, deviceCount, hasHistory, onboarding }`, and render from that. Do not render disabled placeholders.
| Element | Appears when |
|---|---|
| Bottom player bar | After the first play (hidden before; grid collapses to one row) |
| Right column | Always present at 1200px and wider. Idle: start-here or sign-up content. Playing: Now playing / Queue / Lyrics tabs. Collapsible; below 1200px it becomes a drawer opened from the bar |
| Queue icon in the bar | The queue has 2+ tracks |
| Lyrics tab, mic button, lyrics toggle | The current track has lyrics. Otherwise the tab and buttons do not render |
| Output device chip (bar, player page) | While something is playing: shows the current output, e.g. AirPods Pro or This computer |
| Get started cards | Each hides when completed; section hides when all done |
| Jump back in / Recently played | The user has play history |
| Made for you / Because you played X | The backend returns those shelves |
| Library tabs (Albums, Artists, Downloaded) | The user has content of that kind. Liked songs always exists |
| Shuffle / repeat / next / prev | Queue has more than one track |
The mockups (7 boards) are the final screens: Home, Search with the Lyrics tab open, Player page, Player page with full-screen lyrics, Log in, Sign up, Error. There is ONE Home. Its other states are not drawn separately; build them from this table and the sections "Right column states", "Loading skeletons" and "Signed-out Home and auth screens".

## App shell
CSS grid: columns `240px 1fr 320px`, rows `56px 1fr 88px` (top bar, content, player bar; the player-bar row is absent until the first play), gap 12, outer padding 12. Sidebar, main and right panel are panels (`--panel`, radius 18). Player bar spans all columns.

## Top bar and account (borrowed from Spotify's position and shape)
A 56px bar above the panels, no background of its own (sits on `--bg`). Left: the logo, aligned over the sidebar. Next to it: a global search pill (48px tall, fully rounded, `--raised` fill, search icon, "What do you want to play?"); typing and Enter go to the Search screen and the pill keeps the query with a clear (x); Esc clears. Far right: the **avatar**, a 44px circle in `--accent` with the user's initials, ringed by a 3px `--bg` gap and a 1px `--border` outline (this is the Spotify-style ring), never a row or pill. Click opens the account menu: View profile, Settings, Help, Log out. Hover/open state: ring turns white. Signed out: the avatar is replaced, in the same spot, by Log in (outline) and Sign up (accent) buttons.

## Sidebar
- Home and Discover with icons (Search lives in the top bar; the logo lives in the top bar too); active item has `--raised` background.
- YOUR LIBRARY header with a + button; list of playlists (Liked songs always present, with a heart tile). If the user has no playlists, show a dashed "Create your first playlist" button.
- No profile, Settings or Help rows here: they live in the account menu (top-right avatar). When signed out the library shows "Log in to save songs and playlists".

## Home (first run and normal)
- Greeting with the user's name, date, filter chips (All / Music / Made for you / New).
- First-run (the backend returns trending shelves): "Get started" (2 cards: search a song, make a playlist; each disappears when done, the section disappears when both are), "Popular in Kenya" (backend shelf, no genre picker), "Trending now" (5 square cards, from the Discover data).
- After the user has history: replace Get started with "Jump back in" (resume card) and add "Recently played" (square cards with title and artist). Keep Trending.

## Home is server-driven (the UI never talks about learning)
No UI copy about "learning", "your taste" or progress meters, and never ask the user to pick genres or moods. Home is a list of shelves returned by the backend; the frontend renders whatever comes back, in order.
```
GET /api/home -> { shelves: [ { id, type, title, subtitle?, items: [...] } ] }
types: jump_back_in | mix_row | shelf | recent
```
- Cold start (no history): the backend returns region/trending shelves ("Popular in Kenya", "Trending now", "New releases"). Same components, no special first-run UI beyond the Get started cards.
- With history: it returns "Jump back in", "Made for you" (Your Mix 1, Your Mix 2, Late-night mix), "Because you played <artist>", "Recently played". Shelf titles come from the backend, so new shelf kinds need no frontend release.
- Frontend sends events, silently: `POST /api/events { type: play|skip|complete|replay|like|unlike|add_to_playlist|search|not_interested, track_id, position_ms, source_shelf_id, device: { type: headphones|computer|phone|speaker, name }, ts }`. Include `source_shelf_id` so the backend learns which shelves work.
- Feedback affordances on every card/row (hover menu): Like, Add to playlist, Not interested, Hide this artist. These POST events and remove the item immediately (optimistic).
- Settings > Privacy has "Reset recommendations" and "Pause history". No other learning UI.
- Backend start point: log events, score artists/tracks from play, completion and skip signals plus recency, build mixes from top artists plus similar artists, fall back to trending. YouTube provides no genre tags, so use artist/channel and title metadata.

## Right column (panel)
Always present at 1200px and wider so the layout never jumps (see Right column states for idle content). Once something plays it becomes a panel with tabs, in this order: Now playing / Queue / Lyrics. The bar's song details, mic and queue icon switch its tab; clicking the active control again collapses it. It stays open while the user searches or browses, so nothing in the main area is replaced.
- Now playing (borrowed from Spotify's Now Playing view, kept to one screen with no scrolling): a small "Playing from <source>" line with a "..." menu; a square video frame with the title and artist overlaid on its bottom gradient, a "Video" badge and a share icon; a **Lyrics** preview card (accent-tinted, two lines, click opens the Lyrics tab); a **Next in queue** card (one row, "Open queue" opens the Queue tab). No transport controls and no heart: the bar owns those.
- The video is an aesthetic video of the song, not necessarily the official one. Source order, decided by the backend per track: a lyric/visualizer/aesthetic video found for the track, then the official video, then the cover art. A setting under Settings > Playback chooses Aesthetic / Official / Off (Off = cover art, saves data). Honest caveats: the audio stream and a separate visual video will drift unless the visual is muted and looped (do that), a second video doubles bandwidth, and the backend needs a ranking rule for picking the visual.
- Queue: "Playing from <search/playlist>" label, current track highlighted (accent title, animated equaliser icon), then UP NEXT. Doubles as the playlist view when playing from a playlist.
- Lyrics: plain synced lyrics, no card, filling the panel (about 24px, weight 800), current line white, others dimmed, top/bottom fade, auto-scroll.

## Player bar
Left: cover, title, artist, heart. Centre: controls plus progress. Right: lyrics (mic), queue, output device chip, volume slider, expand. Clicking the cover or title opens the Now playing panel (a small chevron on the cover hints at it); the mic opens it on Lyrics, the queue icon opens it on Queue; clicking the active control again closes it. The expand icon opens the full-screen player. The bar does not render before the first play (no idle or disabled state).

## Player page (opened from the bar's expand icon)
Borrowed from Spotify's full-screen view, kept uncluttered. Slides up from the bar in ~300ms and the bar cover grows into the large cover. Gradient backdrop from the cover's dominant colour into `--bg`.
- **Closing:** no X button. A grabber pill sits at the top centre and the page is pull-down-to-dismiss (it follows the pointer 1:1, closes past ~120px or a fast flick, otherwise springs back). A chevron-down at the bottom right also closes it; Esc works too.
- Top: only the Song | Video switch (Video = real video in a 16:9 frame, no black bars) and a "..." menu.
- Centre column: cover, title/artist/heart, progress, controls. Nothing else.
- Bottom row: mic (lyrics), queue, output device chip, volume, chevron-down. Sleep timer, speed, Add to playlist, Add to queue, Go to artist and Share live in the "..." menu, not on the page.
- **Lyrics are optional.** The default way to read lyrics is the right panel while browsing or searching. On the player page the mic switches to a full-screen lyrics layout: lyrics fill the page (46px, weight 800, current line white, others dimmed, fade mask) and the page keeps a compact bottom bar (cover, title, controls, progress, mic highlighted). Tap the mic again to return to the cover layout. Only render the mic when lyrics exist; use synced lyrics (highlight from playback time, auto-scroll, click a line to seek).
- Queue icon opens a slide-in list from the right, not a permanent column.

## Output device (Playing on)
This is not a Spotify Connect picker. It shows where audio is coming out: a chip with an icon and name (e.g. headphones icon + "AirPods Pro", or "This computer") in the bar and on the player page, visible while something is playing. Source: `navigator.mediaDevices.enumerateDevices()` filtered to `audiooutput` (needs a one-time mic permission for labels) and `setSinkId` to switch. Classify into `headphones | computer | phone | speaker` from the label. Later, to regulate where and when playback is allowed, the backend will need this: send `device: { type, name }` with every event and keep a per-device log. No handoff UI for now.

## Other screens to bring in line
- Search results: clean titles (strip "(Official Video)" and similar suffixes), larger square thumbnails, show heart and menu on hover, keep duration.
- Discover: replace the "Featured content will appear here" placeholder with a real featured card.
- Library: Liked songs card always present, plus Playlists/Liked/Albums/Artists/Downloaded tabs with proper empty states.

## Placeholder content in the mocks
Cover gradients, genre names, device names, queue starter picks and lyric lines are placeholders. Replace them with real data and sources.

## Error page
Used for route/data failures (network timeout, 500, 404). The shell stays (sidebar remains usable); main area is centred: alert icon in a tinted circle, "Something went wrong", one line of plain copy ("We couldn't load this page. Check your connection and try again. Your playlists and likes are safe."), primary **Try again** (refetches the failed request, no full reload) and secondary **Go to Home**. Small muted footer: error code, Copy details (code + request id + timestamp to clipboard), Report a problem. Variants: 404 "We can't find that page" (no Try again), offline "You're offline" (auto-retry when the connection returns). If music is playing it keeps playing and the bar stays. Playback errors (video unavailable, region blocked) are NOT a page: show a toast "Can't play this track" with the skipped-to-next behaviour, and mark the row unavailable.

## Signed-out Home and auth screens
Signed out: Home has Log in (outline) and Sign up (accent) buttons in the top bar where the avatar sits when signed in, and the right column holds the sign-up card. No history, so shelves are Trending now and Popular in Kenya. Playing still works; saving requires an account, so Like / Add to playlist open the Sign up screen.
- **Log in / Sign up screens:** split layout. Left: logo, heading ("Welcome back" / "Create your account"), Continue with Google, "or", Email, Password (show/hide eye), Forgot password (login only), primary button, terms line (sign up only), switch link. Right: gradient panel with tilted cover cards and "Your music, wherever you play." Validate inline under the field, disable the button while submitting, show errors as a small red line above the button, not an alert.
- After sign in return the user to where they were; after sign up go to Home.

## Right column states (never an empty hole)
- Idle, signed in: "Start here": a search field that focuses Search, an action card built from the user's data (e.g. "chilling is empty. Find songs"), and Liked songs with a hint. Replace cards as they are completed.
- Idle, signed out: sign-up card ("Save your music, play it anywhere", 3 benefits, Sign up, Log in). Two prompts only (the top-bar buttons and this card), never a third in the sidebar.
- Playing: Now playing / Queue / Lyrics tabs, no duplicate controls.

## Loading skeletons
- Mirror the loaded layout exactly: same shelf title height, same card size (square cover, two text lines at 13px and 10px), same grid, so nothing shifts when data arrives. The greeting and sidebar render immediately (name and library are local).
- Soft shimmer: `linear-gradient(90deg,#1b1a26,#272538,#1b1a26)`, 200% size, 1.4s ease-in-out, stagger cards by 120ms. Disable under `prefers-reduced-motion`. No flat grey blocks, no high contrast.
- Load shelves independently: each shelf swaps its own skeleton for content as it arrives. Show a skeleton only if the request takes more than ~200ms; once shown keep it for at least 300ms to avoid flashing. After ~10s show the Error page with Try again.

## Click targets
- Player bar: the whole left block (cover + title + artist) is ONE button: click selects the Now playing tab and expands the column if collapsed; click again on Now playing collapses it. Pointer cursor, cover shows the chevron, title underlines on hover, tooltip "Open Now playing", visible focus ring, `aria-label="Open Now playing"`. The heart is a separate button and must stop propagation. The mic and queue icons select their tabs the same way.
- Avatar (top right): one button opening the account menu (View profile, Settings, Help, Log out). There is no profile row or gear in the sidebar.

## Data fix: "Popular in Kenya"
The shelf currently returns non-music videos ("Top 50 Biggest Cities", "Highest Paid Journalists"). Fetch with `videos.list` using `chart=mostPopular`, `regionCode=KE`, `videoCategoryId=10` (Music), or filter out results whose category is not Music. Also request a 1:1-croppable thumbnail (`maxresdefault`/`hq720`, `object-fit: cover`) to remove the black bars.
