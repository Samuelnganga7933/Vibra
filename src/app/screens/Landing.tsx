import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat2, Maximize2, Cast,
  Download, Heart, Smartphone, Tablet, Laptop, Monitor,
} from "lucide-react";
import { useApp, fromApiTrack, type Screen, type Track } from "../context";
import { searchTracks } from "../services/api";
import { sanitizeMusicItems } from "../services/smartQueue";
import { marketChartQuery, marketLabel } from "../services/locale";

const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

const TERMS_URL = "https://streamvy.me/tos";
const PRIVACY_URL = "https://streamvy.me/privacy-policy";
const CONTACT_EMAIL = "vy.legal@protonmail.com";

const WAVE = Array.from({ length: 46 }, (_, i) => {
  const h = 24 + Math.round(56 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.63)));
  return Math.min(96, Math.max(14, h));
});

const PLATFORMS = [
  { Icon: Smartphone, name: "Android", ext: ".apk" },
  { Icon: Tablet, name: "iPhone and iPad", ext: ".ipa" },
  { Icon: Laptop, name: "Mac", ext: ".dmg" },
  { Icon: Monitor, name: "Windows", ext: ".exe" },
];

const CSS = `
.vy-root{
  position:relative;height:var(--app-h,100dvh);overflow-y:auto;overflow-x:hidden;
  background:
    radial-gradient(60% 40% at 15% 0%, rgba(122,58,42,.34), transparent 70%),
    radial-gradient(50% 40% at 95% 12%, rgba(58,26,122,.34), transparent 70%),
    var(--bg);
  color:var(--text);scrollbar-width:none;
}
.vy-root::-webkit-scrollbar{display:none}
.vy-wrap{max-width:1200px;margin:0 auto;padding:0 24px}
.vy-root a{color:inherit;text-decoration:none}
.vy-root a:focus-visible,.vy-root button:focus-visible{outline:2px solid #fff;outline-offset:3px;border-radius:8px}

.vy-header{position:sticky;top:0;z-index:40;transition:background .25s,backdrop-filter .25s,border-color .25s;border-bottom:1px solid transparent}
.vy-header.vy-stuck{background:color-mix(in srgb,var(--bg) 84%,transparent);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom-color:color-mix(in srgb,var(--text) 8%,transparent)}
.vy-header-in{display:flex;align-items:center;justify-content:space-between;padding:18px 0}
.vy-logo{font-size:26px;font-weight:800;letter-spacing:-.5px;line-height:1}
.vy-logo i{color:var(--brand);font-style:normal}
.vy-nav{display:flex;align-items:center;gap:10px}
.vy-navlink{padding:10px 14px;font-weight:600;color:var(--muted);font-size:15px;transition:color .15s}
.vy-navlink:hover{color:var(--text)}

.vy-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;height:46px;padding:0 24px;border-radius:999px;font-weight:800;font-size:15px;border:1px solid transparent;cursor:pointer;font-family:inherit;transition:transform .15s,background .15s,box-shadow .15s}
.vy-btn:hover{transform:translateY(-1px)}
.vy-btn:active{transform:translateY(0) scale(.985)}
.vy-btn.vy-accent{background:var(--brand);color:#fff}
.vy-btn.vy-accent:hover{box-shadow:0 10px 30px color-mix(in srgb,var(--brand) 45%,transparent)}
.vy-btn.vy-light{background:var(--text);color:var(--panel)}
.vy-btn.vy-ghost{border-color:var(--google-border);color:var(--text);background:transparent}
.vy-btn.vy-ghost:hover{background:color-mix(in srgb,var(--text) 6%,transparent)}
.vy-btn.vy-big{height:54px;padding:0 30px;font-size:16px}

.vy-hero{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center;padding:32px 0;position:relative}
.vy-eyebrow{font-size:12px;letter-spacing:.14em;font-weight:800;color:color-mix(in srgb,var(--brand) 72%,#fff)}
.vy-h1{margin:14px 0 18px;font-size:clamp(40px,6.2vw,76px);line-height:1.02;font-weight:800;letter-spacing:-1.5px}
.vy-lead{font-size:18px;color:color-mix(in srgb,var(--text) 80%,var(--muted));max-width:520px;margin:0 0 28px;line-height:1.55}
.vy-cta{display:flex;flex-wrap:wrap;gap:12px}
.vy-fine{margin-top:16px;font-size:13px;color:var(--dim)}

.vy-orb{position:absolute;border-radius:50%;filter:blur(72px);opacity:.5;pointer-events:none;z-index:-1}
.vy-orb-a{width:440px;height:440px;left:-8%;top:-14%;background:radial-gradient(circle,#7a3a2a,transparent 70%);animation:vyDriftA 17s ease-in-out infinite}
.vy-orb-b{width:380px;height:380px;right:-6%;top:22%;background:radial-gradient(circle,#3a1a7a,transparent 70%);animation:vyDriftB 21s ease-in-out infinite}

.vy-deck{position:relative;justify-self:center;width:min(400px,100%);perspective:1100px}
.vy-glow{position:absolute;left:8%;right:8%;top:14%;bottom:-6%;border-radius:48px;filter:blur(54px);opacity:.55;background:conic-gradient(from 0deg,var(--brand),#7a4ae8,#4cc9f0,var(--brand));animation:vySpin 22s linear infinite}
.vy-player{position:relative;background:color-mix(in srgb,var(--panel) 84%,transparent);border:1px solid color-mix(in srgb,var(--text) 9%,transparent);border-radius:32px;padding:20px;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 30px 80px rgba(0,0,0,.62);transform-style:preserve-3d}
.vy-cover{aspect-ratio:1/1;border-radius:22px;background-size:cover;background-position:center;position:relative;overflow:hidden}
.vy-cover::after{content:"";position:absolute;inset:0;background:linear-gradient(160deg,rgba(255,255,255,.14),transparent 42%);mix-blend-mode:screen}
.vy-meta{display:flex;justify-content:space-between;align-items:center;margin:18px 4px 14px;gap:12px}
.vy-meta b{display:block;font-size:19px;color:var(--text);letter-spacing:-.3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vy-meta span{color:var(--muted);font-size:14px}
.vy-wave{display:flex;align-items:center;gap:3px;height:44px}
.vy-wave i{flex:1;height:var(--h);border-radius:2px;background:color-mix(in srgb,var(--text) 16%,transparent);transform-origin:center;animation:vyWave 1.6s ease-in-out infinite;animation-delay:var(--d)}
.vy-wave i.vy-on{background:var(--brand)}
.vy-times{display:flex;justify-content:space-between;font-size:12px;font-weight:600;color:var(--muted);margin-top:8px}
.vy-prog{position:relative;height:4px;border-radius:2px;background:var(--border);margin-top:10px}
.vy-prog i{position:absolute;left:0;top:0;bottom:0;width:33%;border-radius:2px;background:var(--brand)}
.vy-prog b{position:absolute;left:33%;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:var(--text);box-shadow:0 0 12px color-mix(in srgb,var(--brand) 80%,transparent);animation:vyPulse 1.6s ease-in-out infinite}
.vy-ctl{display:flex;justify-content:center;align-items:center;gap:24px;margin-top:16px;color:var(--muted)}
.vy-ctl .vy-play{width:56px;height:56px;border-radius:50%;background:var(--brand);color:#fff;display:grid;place-items:center;box-shadow:0 12px 34px color-mix(in srgb,var(--brand) 40%,transparent)}

.vy-sec{padding:40px 0}
.vy-h2{margin:0 0 18px;font-size:28px;font-weight:800;letter-spacing:-.5px}
.vy-marquee{overflow:hidden;position:relative;-webkit-mask-image:linear-gradient(to right,transparent,#000 4%,#000 96%,transparent);mask-image:linear-gradient(to right,transparent,#000 4%,#000 96%,transparent)}
.vy-track{display:flex;gap:16px;width:max-content;animation:vyMarquee 46s linear infinite}
.vy-marquee:hover .vy-track{animation-play-state:paused}
.vy-card{display:block;width:196px;flex:0 0 auto;transition:transform .18s ease}
.vy-card:hover{transform:translateY(-6px)}
.vy-art{display:block;aspect-ratio:1/1;border-radius:16px;background-size:cover;background-position:center;box-shadow:0 14px 34px rgba(0,0,0,.5);position:relative;overflow:hidden;transition:box-shadow .2s}
.vy-card:hover .vy-art{box-shadow:0 22px 48px rgba(0,0,0,.65)}
.vy-art::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 55%,rgba(0,0,0,.45));opacity:0;transition:opacity .2s}
.vy-card:hover .vy-art::after{opacity:1}
.vy-badge{position:absolute;left:50%;top:50%;z-index:2;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:var(--brand);color:#fff;display:grid;place-items:center;opacity:0;transform:scale(.6);transition:opacity .2s,transform .25s cubic-bezier(.16,1,.3,1)}
.vy-card:hover .vy-badge{opacity:1;transform:scale(1)}
.vy-card b{display:block;margin-top:11px;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vy-card small{color:var(--dim);font-size:13px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vy-skel{width:196px;flex:0 0 auto}
.vy-skel .vy-art{background:linear-gradient(90deg,#1b1a26,#272538,#1b1a26);background-size:200% 100%;animation:vyShimmer 1.4s ease-in-out infinite;box-shadow:none}
.vy-skel .vy-l1,.vy-skel .vy-l2{height:12px;border-radius:6px;background:linear-gradient(90deg,#1b1a26,#272538,#1b1a26);background-size:200% 100%;animation:vyShimmer 1.4s ease-in-out infinite;margin-top:11px}
.vy-skel .vy-l1{width:70%}
.vy-skel .vy-l2{width:45%;height:10px;margin-top:8px}

.vy-get{background:linear-gradient(160deg,#4a1e2a,#1a1424 70%);border-radius:28px;padding:40px;display:grid;grid-template-columns:.9fr 1.1fr;gap:32px;align-items:center}
.vy-get h2{font-size:34px;margin:0 0 8px;letter-spacing:-.5px}
.vy-get p{margin:0;color:color-mix(in srgb,var(--text) 78%,var(--muted))}
.vy-plats{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.vy-plat{min-width:0;display:flex;gap:14px;align-items:center;background:color-mix(in srgb,var(--bg) 62%,transparent);border:1px solid color-mix(in srgb,var(--text) 10%,transparent);border-radius:18px;padding:16px;transition:background .15s,transform .15s}
.vy-plat:hover{background:color-mix(in srgb,var(--bg) 85%,transparent);transform:translateY(-2px)}
.vy-pi{width:46px;height:46px;border-radius:12px;background:var(--raised);display:grid;place-items:center;flex-shrink:0}
.vy-plat b{display:block;font-size:16px}
.vy-plat small{color:var(--dim);font-size:12px}

.vy-footer{display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px;padding:32px 0 48px;color:var(--dim);font-size:14px;border-top:1px solid color-mix(in srgb,var(--text) 8%,transparent);margin-top:24px}
.vy-footer nav{display:flex;flex-wrap:wrap;gap:4px}
.vy-footer nav a{color:var(--muted);font-weight:600;font-size:14px;padding:6px 8px;transition:color .15s}
.vy-footer nav a:hover{color:var(--text)}
.vy-legal{display:flex;flex-wrap:wrap;gap:14px;align-items:center;font-size:13px}
.vy-legal a{color:var(--muted);text-decoration:underline;text-underline-offset:3px;text-decoration-color:color-mix(in srgb,var(--text) 22%,transparent)}
.vy-legal a:hover{color:var(--text)}

@keyframes vyWave{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.7)}}
@keyframes vyDriftA{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(6%,5%) scale(1.12)}}
@keyframes vyDriftB{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-5%,7%) scale(.9)}}
@keyframes vySpin{to{transform:rotate(360deg)}}
@keyframes vyPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.35);opacity:.75}}
@keyframes vyFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes vyMarquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@keyframes vyShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

@media (max-width:900px){
  .vy-hero{grid-template-columns:1fr;gap:40px;padding-top:24px}
  .vy-get{grid-template-columns:1fr}
  .vy-get{padding:28px}
  .vy-navlink{display:none}
}
@media (max-width:560px){
  .vy-plats{grid-template-columns:1fr}
  .vy-cta{flex-direction:column}
  .vy-cta .vy-btn{width:100%}
  .vy-card,.vy-skel{width:164px}
}
@media (prefers-reduced-motion:reduce){
  .vy-wave i,.vy-orb,.vy-glow,.vy-track,.vy-prog b,.vy-skel .vy-art,.vy-skel .vy-l1,.vy-skel .vy-l2{animation:none!important}
  .vy-btn,.vy-card,.vy-plat{transition:none}
  .vy-card:hover,.vy-plat:hover,.vy-btn:hover{transform:none}
}
`;

function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="vy-logo" style={{ fontSize: size }}>
      vybra<i>.</i>
    </span>
  );
}

function useEnter(onEnter?: () => void) {
  const { navigate } = useApp();
  return (screen: Screen, path: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    onEnter?.();
    window.history.pushState({}, "", path);
    navigate(screen);
  };
}

function Reveal({ delay = 0, children, className }: { delay?: number; children: React.ReactNode; className?: string }) {
  const reduced = useReducedMotion() ?? false;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduced ? 0 : 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-70px" }}
      transition={{ duration: reduced ? 0.2 : 0.6, delay: reduced ? 0 : delay, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

function HeroDeck({ track, reduced }: { track: Track | null; reduced: boolean }) {
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 140, damping: 18, mass: 0.9 });
  const sy = useSpring(py, { stiffness: 140, damping: 18, mass: 0.9 });
  const rotateY = useTransform(sx, [-1, 1], [-11, 11]);
  const rotateX = useTransform(sy, [-1, 1], [7, -7]);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduced) return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set(((e.clientX - r.left) / r.width) * 2 - 1);
    py.set(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const onLeave = () => { px.set(0); py.set(0); };

  return (
    <motion.div
      className="vy-deck"
      aria-hidden="true"
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      initial={{ opacity: 0, y: reduced ? 0 : 34 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0.25 : 0.8, delay: reduced ? 0 : 0.25, ease: EASE_OUT }}
    >
      <div className="vy-glow" />
      <motion.div className="vy-player" style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}>
        <div
          className="vy-cover"
          style={track?.imageUrl
            ? { backgroundImage: `url(${track.imageUrl})` }
            : { background: "linear-gradient(160deg,#7a3a2a,#3a1a7a 55%,#1a1424)" }}
        />
        <div className="vy-meta">
          <span style={{ minWidth: 0 }}>
            <b>{track?.title ?? "Picking today’s hits…"}</b>
            <span>{track?.artist ?? "Vybra"}</span>
          </span>
          <Heart size={22} style={{ color: "var(--brand)", flexShrink: 0 }} fill="currentColor" />
        </div>
        <div className="vy-wave">
          {WAVE.map((h, i) => (
            <i
              key={i}
              className={i < 15 ? "vy-on" : undefined}
              style={{ "--h": `${h}%`, "--d": `${(i * 37) % 900}ms` } as React.CSSProperties}
            />
          ))}
        </div>
        <div className="vy-prog"><i /><b /></div>
        <div className="vy-times"><span>1:12</span><span>{track?.duration ?? "3:31"}</span></div>
        <div className="vy-ctl">
          <Shuffle size={19} />
          <SkipBack size={24} fill="currentColor" />
          <span className="vy-play"><Pause size={22} fill="currentColor" /></span>
          <SkipForward size={24} fill="currentColor" />
          <Repeat2 size={20} />
          <Maximize2 size={18} />
          <Cast size={19} />
        </div>
      </motion.div>
    </motion.div>
  );
}

function TrendingSection({ tracks, loading, onEnter }: { tracks: Track[]; loading: boolean; onEnter: (e: React.MouseEvent) => void }) {
  const reduced = useReducedMotion() ?? false;
  const market = useMemo(() => marketLabel(), []);
  const items = useMemo(() => (tracks.length > 0 ? [...tracks, ...tracks] : []), [tracks]);

  if (!loading && tracks.length === 0) return null;

  return (
    <section className="vy-sec">
      <Reveal>
        <h2 className="vy-h2">Trending in {market}</h2>
      </Reveal>
      {loading ? (
        <div className="vy-track" style={{ animation: "none" }}>
          {[...Array(6)].map((_, i) => (
            <div className="vy-skel" key={i}>
              <span className="vy-art" />
              <div className="vy-l1" />
              <div className="vy-l2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="vy-marquee">
          <div className="vy-track" style={reduced ? { animation: "none", width: "auto", flexWrap: "wrap" } : undefined}>
            {items.map((t, i) => (
              <a
                key={`${t.id}-${i}`}
                className="vy-card"
                href="/"
                onClick={onEnter}
                aria-hidden={i >= tracks.length || undefined}
                tabIndex={i >= tracks.length ? -1 : undefined}
              >
                <span
                  className="vy-art"
                  style={t.imageUrl
                    ? { backgroundImage: `url(${t.imageUrl})` }
                    : { background: `linear-gradient(160deg,${t.bg},#1a1424)` }}
                >
                  <span className="vy-badge"><Play size={18} fill="currentColor" /></span>
                </span>
                <b>{t.title}</b>
                <small>{t.artist}</small>
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function LandingScreen({ onEnter }: { onEnter?: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const enter = useEnter(onEnter);
  const [stuck, setStuck] = useState(false);
  const [loading, setLoading] = useState(true);
  const [trending, setTrending] = useState<Track[]>([]);

  useEffect(() => {
    const prevTitle = document.title;
    const meta = document.querySelector('meta[name="description"]');
    const prevDesc = meta?.getAttribute("content") ?? null;
    document.title = "Vybra: your music, wherever you play";
    meta?.setAttribute("content", "Search any song and press play. No account needed. Apps for Android, iPhone, Mac and Windows.");
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc !== null) meta.setAttribute("content", prevDesc);
    };
  }, []);

  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onScroll = () => setStuck(el.scrollTop > 8);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void searchTracks(marketChartQuery(), 14).then(res => {
      if (cancelled) return;
      setTrending(sanitizeMusicItems(res).slice(0, 10).map((t, i) => fromApiTrack(t, i)));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const goHome = enter({ id: "home" }, "/");
  const goApp = enter({ id: "download" }, "/get-app");
  const goLogin = enter({ id: "auth", mode: "login" }, "/login");
  const goSignup = enter({ id: "auth", mode: "signup" }, "/signup");

  const words = ["Your", "music,", "wherever", "you", "play."];

  return (
    <div className="vy-root" ref={rootRef}>
      <style>{CSS}</style>

      <header className={`vy-header${stuck ? " vy-stuck" : ""}`}>
        <div className="vy-wrap">
          <div className="vy-header-in">
            <a href="/" onClick={goHome} aria-label="Vybra home"><Wordmark /></a>
            <nav className="vy-nav">
              <a className="vy-navlink" href="/get-app" onClick={goApp}>Get the app</a>
              <a className="vy-btn vy-ghost" href="/login" onClick={goLogin}>Log in</a>
              <a className="vy-btn vy-accent" href="/signup" onClick={goSignup}>Sign up</a>
            </nav>
          </div>
        </div>
      </header>

      <main className="vy-wrap">
        <section className="vy-hero">
          <span className="vy-orb vy-orb-a" aria-hidden />
          <span className="vy-orb vy-orb-b" aria-hidden />
          <div>
            <motion.span
              className="vy-eyebrow"
              style={{ display: "block" }}
              initial={{ opacity: 0, y: reduced ? 0 : 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduced ? 0.2 : 0.5, ease: EASE_OUT }}
            >
              MUSIC, MADE SIMPLE
            </motion.span>

            <h1 className="vy-h1">
              {words.map((w, i) => (
                <motion.span
                  key={w}
                  style={{ display: "inline-block", marginRight: "0.26em" }}
                  initial={{ opacity: 0, y: reduced ? 0 : 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduced ? 0.25 : 0.75, delay: reduced ? 0 : 0.08 + i * 0.07, ease: EASE_OUT }}
                >
                  {w}
                </motion.span>
              ))}
            </h1>

            <motion.p
              className="vy-lead"
              initial={{ opacity: 0, y: reduced ? 0 : 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduced ? 0.2 : 0.6, delay: reduced ? 0 : 0.42, ease: EASE_OUT }}
            >
              Search any song and press play. No account needed. Sign up when you want to
              save playlists and likes.
            </motion.p>

            <motion.div
              className="vy-cta"
              initial={{ opacity: 0, y: reduced ? 0 : 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduced ? 0.2 : 0.6, delay: reduced ? 0 : 0.54, ease: EASE_OUT }}
            >
              <a className="vy-btn vy-light vy-big" href="/" onClick={goHome}>
                <Play size={18} fill="currentColor" /> Start listening
              </a>
              <a className="vy-btn vy-ghost vy-big" href="/get-app" onClick={goApp}>
                <Download size={18} /> Get the app
              </a>
            </motion.div>

            <motion.p
              className="vy-fine"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduced ? 0.2 : 0.6, delay: reduced ? 0 : 0.66 }}
            >
              Free to try. Android, iPhone, Mac and Windows.
            </motion.p>
          </div>

          <HeroDeck track={trending[0] ?? null} reduced={reduced} />
        </section>

        <TrendingSection tracks={trending} loading={loading} onEnter={goHome} />

        <section className="vy-sec" id="get">
          <Reveal>
            <div className="vy-get">
              <div>
                <h2>Take Vybra with you.</h2>
                <p>Android, iPhone, Mac and Windows.</p>
                <a className="vy-btn vy-accent" href="/get-app" onClick={goApp} style={{ marginTop: 20 }}>
                  <Download size={17} /> Get the app
                </a>
              </div>
              <div className="vy-plats">
                {PLATFORMS.map((p, i) => (
                  <motion.a
                    key={p.name}
                    className="vy-plat"
                    href="/get-app"
                    onClick={goApp}
                    initial={{ opacity: 0, y: reduced ? 0 : 18 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-60px" }}
                    transition={{ duration: reduced ? 0.2 : 0.5, delay: reduced ? 0 : i * 0.07, ease: EASE_OUT }}
                  >
                    <span className="vy-pi"><p.Icon size={22} /></span>
                    <span style={{ minWidth: 0 }}>
                      <b>{p.name}</b>
                      <small>{p.ext}</small>
                    </span>
                  </motion.a>
                ))}
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="vy-wrap vy-footer">
        <span>&copy; {new Date().getFullYear()} Vybra</span>
        <div className="vy-legal">
          <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">Privacy Policy</a>
          <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">Terms of Service</a>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </div>
        <nav>
          <a href="/login" onClick={goLogin}>Log in</a>
          <a href="/signup" onClick={goSignup}>Sign up</a>
          <a href="/get-app" onClick={goApp}>Get the app</a>
        </nav>
      </footer>
    </div>
  );
}

export default LandingScreen;
