# Vibra — Backend API Reference

All requests use `Content-Type: application/json` and require a session cookie or `Authorization: Bearer <token>` header (your choice of auth strategy). Set `VITE_API_BASE_URL` in `.env` to point the frontend at your server.

```
VITE_API_BASE_URL=https://api.yourdomain.com
```

---

## Authentication

### `POST /auth/register`
Create a new account. Called at the end of the onboarding wizard.

**Body**
```json
{
  "name": "string",
  "email": "string",
  "password": "string",
  "genres": ["hiphop", "rnb"],
  "artistIds": ["weeknd", "sza"],
  "likedTrackIds": ["track-id-1", "track-id-2"]
}
```

**Response** → `User`

---

### `POST /auth/login`
**Body** `{ email, password }`  
**Response** → `User` + sets session cookie (or returns `{ token }`)

---

### `POST /auth/logout`
Clears the session.  
**Response** `204 No Content`

---

### `GET /auth/me`
Returns the currently authenticated user.  
**Response** → `User`

---

## User object

```ts
interface User {
  id: string;
  name: string;
  email: string;
  username: string;
  initials: string;       // e.g. "SN"
  avatarUrl?: string;
  subscription: "free" | "premium";
  stats?: {
    following: number;
    followers: number;
    playlists: number;
    weeklyHours: string;  // e.g. "24h"
    tracksLiked: number;
    topArtists: number;
  };
}
```

---

## Library

### `GET /library/playlists`
Returns the current user's playlists (without tracks array — lazy-load per playlist).  
**Response** → `PlaylistItem[]`

### `GET /library/playlists/:id`
Full playlist with all tracks.  
**Response** → `PlaylistItem` (includes `tracks: Track[]`)

### `POST /library/playlists`
Create a new playlist.  
**Body** `{ name: string, description?: string }`  
**Response** → `PlaylistItem`

### `PUT /library/playlists/:id`
Update name/description/cover.  
**Body** `{ name?, description?, coverColor?, coverUrl? }`  
**Response** → `PlaylistItem`

### `DELETE /library/playlists/:id`
**Response** `204`

### `POST /library/playlists/:id/tracks`
Add a track to a playlist.  
**Body** `{ trackId: string }`  
**Response** `{ trackCount: number }`

### `DELETE /library/playlists/:id/tracks/:trackId`
**Response** `204`

---

### `GET /library/liked`
**Response** `{ ids: string[] }` — array of liked track IDs.

### `POST /library/liked/:trackId`
Toggle like on a track.  
**Body** `{ liked: boolean }`  
**Response** `{ liked: boolean }`

---

### `GET /library/recent`
Last 20 played tracks.  
**Response** → `Track[]`

### `POST /library/recent`
Record a play event (call this when a track starts playing).  
**Body** `{ trackId: string, artistId?: string, durationMs: number }`  
**Response** `204`

---

### `GET /library/artists`
Artists the user follows.  
**Response** → `ArtistItem[]`

### `GET /library/albums`
Albums saved to library.  
**Response** → `AlbumItem[]`

### `GET /library/downloaded`
Tracks available offline.  
**Response** → `Track[]`

### `POST /library/downloads/:trackId`
Queue a track for download.  
**Response** `{ status: "queued" | "available" }`

---

## Social

### `GET /users/:id`
Public user profile.  
**Response** → `User` (no private fields)

### `GET /users/me/following`
Who the current user follows.  
**Response** `{ ids: string[] }`

### `GET /users/:id/followers`
List of follower user objects.  
**Response** → `User[]`

### `GET /users/:id/following`
List of accounts a user follows.  
**Response** → `User[]`

### `POST /users/:id/follow`
Follow or unfollow.  
**Body** `{ follow: boolean }`  
**Response** `{ following: boolean, followerCount: number }`

---

## Discovery

### `GET /discover/featured`
Editorial picks for the current day.  
**Response** `{ playlists: PlaylistItem[] }`

### `GET /discover/trending`
Trending tracks globally.  
**Response** → `Track[]`

### `GET /discover/new-releases`
Albums / singles released in the last 30 days.  
**Response** → `AlbumItem[]`

### `GET /discover/recommendations`
Personalised recommendations based on listening history, liked tracks, and onboarding data.  
**Query params** `limit=20` (default)  
**Response** → `Track[]`

---

## Search

### `GET /search`
**Query params** `q=string`, `type=tracks|playlists|artists|all` (default `all`), `limit=20`  
**Response**
```json
{
  "tracks": Track[],
  "playlists": PlaylistItem[],
  "artists": ArtistItem[]
}
```

---

## Settings

### `PUT /settings`
Persist user preferences.  
**Body**
```json
{
  "theme": "dark" | "oled" | "light",
  "accent": "#E8354D",
  "audioQuality": "low" | "normal" | "high" | "lossless",
  "normalizeVolume": true,
  "autoplay": true,
  "crossfade": false,
  "notifNewReleases": true,
  "notifRecommendations": true,
  "notifFollowers": false,
  "shareListening": true,
  "shareData": false
}
```
**Response** `204`

---

## Shared data shapes

```ts
interface Track {
  id: string;
  title: string;
  artist: string;           // or artistName
  album?: string;           // or albumTitle
  duration?: string;        // "3:42"
  durationMs?: number;      // 222000
  coverColor: string;       // hex fallback e.g. "#2C4A5E"
  coverUrl?: string;        // artwork image URL
  previewUrl?: string;      // 30-second clip URL (no auth needed)
  streamUrl?: string;       // full stream URL (requires auth)
}

interface PlaylistItem {
  id: string;
  name: string;
  description?: string;
  coverColor: string;
  coverUrl?: string;
  trackCount: number;
  creator?: { id: string; name: string };
  tracks?: Track[];         // omitted in list views
}

interface AlbumItem {
  id: string;
  title: string;
  artist: string;
  year: number;
  coverColor: string;
  coverUrl?: string;
  trackCount: number;
}

interface ArtistItem {
  id: string;
  name: string;
  genre: string;
  coverColor: string;
  imageUrl?: string;
  followers?: number;
}
```

---

## Recommendation algorithm hints

The frontend sends the following signals you can use to train recommendations:

| Signal | When | Endpoint |
|---|---|---|
| Onboarding genres | Signup | `/auth/register` body `.genres` |
| Onboarding artists | Signup | `/auth/register` body `.artistIds` |
| Onboarding liked tracks | Signup | `/auth/register` body `.likedTrackIds` |
| Track play started | Each play | `POST /library/recent` |
| Track liked / unliked | Heart tap | `POST /library/liked/:id` |
| Artist followed | Follow tap | `POST /users/:id/follow` |
| Search query | On search | Log server-side from `GET /search` |
| Playlist created | User action | `POST /library/playlists` |

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `VITE_API_BASE_URL` | Yes | Base URL of your backend e.g. `https://api.vibra.app` |
| `VITE_BFF_BASE_URL` | Yes | Base URL for authenticated library, profile, and feed requests |
| `DATABASE_URL` | Yes in production | PostgreSQL connection string for user data and feed events |
| `CORS_ORIGINS` | Yes in production | Comma-separated allowed app origins |

Keep catalogue and database credentials on the server. Never expose them in the frontend build.
