# Vibra: redesign instructions for the coding agent

You are restyling and restructuring an EXISTING React + Vite app (dev server on localhost:5173). Do not rewrite it, do not change the backend in this pass. Inspect the repo first and reuse its components, routing and state.

## Read these first, in this order
1. `docs/design/VIBRA_DESIGN_SPEC.md`: the full spec. It wins over anything else here.
2. `docs/design/tokens.css`: design tokens. Import it at the app root and use the CSS variables. Never hard-code colours, radii or fonts in components.
3. `docs/design/boards/*.html`: the 7 final screens as plain HTML with inline styles (Home, Search, Player, PlayerLyrics, Login, Signup, Error). They are the visual source of truth for sizes, spacing, radii and layout. Read them as code; open them in a browser if you can. Do NOT paste them into the app: rebuild each screen with the app's own components and the tokens.
4. `docs/design/screens/*.png`: renders of the same 7 boards (use them if you can read images).

## How the boards map to the app
- The shell is a CSS grid: columns `240px 1fr 320px`, rows `56px 1fr 88px`, gap 12px, padding 12px. Top bar spans all columns; the player bar spans all columns and is absent until the first play.
- Text, gradients and covers in the boards are placeholders (gradient squares, fake lyric lines, "AirPods Pro", names). Replace them with real data.
- Icons are inline SVG line icons (stroke 2, round caps). Use the app's icon set with the same look. Never use emoji or text characters as buttons.

## Hard rules
- The player bar owns all transport controls. No second pause button, heart or controls anywhere else.
- Show a control only when the user can use it (see the contextual table in the spec). No disabled placeholders.
- Never ask the user to pick genres or moods. Home is rendered from backend shelves.
- Keep it clean: no extra panels, banners or tooltips that are not in the spec.

## Work in this order, one commit each, and run the app after each step
1. tokens + app shell grid
2. top bar: logo, global search pill, avatar (account menu)
3. sidebar (Home, Discover, library)
4. Home screen + loading skeleton
5. player bar (click targets: song details open the Now playing tab; mic = Lyrics; queue icon = Queue; output device chip; expand)
6. right column: idle content, then the Now playing / Queue / Lyrics tabs
7. full-screen Player page (pull-down to close) and the optional full-screen lyrics layout
8. Log in and Sign up screens, signed-out Home
9. Error page
10. Data fix: "Popular in Kenya" must return music only (see the spec)

Before step 1, reply with a short plan: which existing files you will change, which you will add, and what needs backend work (synced lyrics, output device list, aesthetic video source). Wait for approval, then start.
