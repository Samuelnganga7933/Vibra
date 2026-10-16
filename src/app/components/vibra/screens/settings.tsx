import { motion } from "motion/react";
import { Check } from "lucide-react";
import {
  ACCENT_DISPLAY,
  ACCENTS,
  useVibra,
  VIDEO_SCENES,
  type AccentName,
  type BackgroundKind,
  type ThemeMode,
} from "../store";
import { AmbientBackground, ScenePreview } from "../ambient";
import { Card, Row, ScreenHeader, Slider, Switch } from "../primitives";
import { EASE } from "../motion";

const THEMES: { id: ThemeMode; label: string; note: string }[] = [
  { id: "light", label: "Light", note: "Warm paper" },
  { id: "dark", label: "Dark", note: "Charcoal" },
  { id: "oled", label: "OLED Black", note: "True black" },
  { id: "system", label: "System", note: "Follows device" },
];

const ACCENT_LABELS: { id: AccentName; label: string }[] = (
  Object.keys(ACCENT_DISPLAY) as AccentName[]
).map((id) => ({ id, label: ACCENT_DISPLAY[id] }));

export function AppearanceScreen() {
  const { m, go, settings, set, accent } = useVibra();

  return (
    <div className="mx-auto max-w-2xl pb-10">
      <ScreenHeader kicker="Appearance" title="Make it yours" onBack={() => go("profile")} />

      <div className="mt-6 space-y-8 px-6">
        {/* Theme — crossfades, never flashes */}
        <motion.section {...m.riseIn(0)}>
          <Label>Theme</Label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {THEMES.map((t, i) => {
              const on = settings.theme === t.id;
              return (
                <motion.div key={t.id} {...m.stagger(i, 0.04)}>
                  <Card
                    soft
                    onClick={() => set("theme", t.id)}
                    label={`${t.label} theme`}
                    style={on ? { boxShadow: `0 0 0 1.5px ${accent}, 0 6px 18px var(--v-shade)` } : undefined}
                  >
                    <div className="px-4 py-4">
                      <div className="flex items-center justify-between">
                        <ThemeSwatch mode={t.id} />
                        {on && <Check size={14} color={accent} />}
                      </div>
                      <p className="mt-3 text-[14px]" style={{ color: "var(--v-text)" }}>
                        {t.label}
                      </p>
                      <p className="mt-0.5 text-[11px]" style={{ color: "var(--v-text-3)" }}>
                        {t.note}
                      </p>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </motion.section>

        {/* Accent */}
        <motion.section {...m.riseIn(0.08)}>
          <Label>Accent colour</Label>
          <div className="mt-3.5 flex items-center gap-3.5">
            {ACCENT_LABELS.map((a) => {
              const on = settings.accent === a.id;
              const color = a.id === "custom" ? settings.customAccent : ACCENTS[a.id];
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-label={`${a.label} accent`}
                  aria-pressed={on}
                  onClick={() => set("accent", a.id)}
                  className="flex flex-col items-center gap-2"
                >
                  <motion.span
                    className="grid place-items-center rounded-full"
                    style={{
                      width: 40,
                      height: 40,
                      background: color,
                      boxShadow: on ? `0 0 0 2px var(--v-bg), 0 0 0 3.5px ${color}` : "0 4px 12px var(--v-shade)",
                    }}
                    animate={{ scale: on ? 1 : 0.94 }}
                    transition={{ duration: 0.2, ease: EASE }}
                  >
                    {on && <Check size={15} color="#07070A" />}
                  </motion.span>
                  <span className="text-[11px]" style={{ color: on ? "var(--v-text)" : "var(--v-text-3)" }}>
                    {a.label}
                  </span>
                </button>
              );
            })}
          </div>
          {settings.accent === "custom" && (
            <motion.div {...m.riseIn(0, 6)} className="mt-4">
              <Card soft>
                <Row
                  title="Custom colour"
                  note={settings.customAccent.toUpperCase()}
                  last
                  right={
                    <input
                      type="color"
                      aria-label="Custom accent colour"
                      value={settings.customAccent}
                      onChange={(e) => set("customAccent", e.target.value)}
                      className="h-9 w-12 cursor-pointer bg-transparent"
                      style={{ border: "none" }}
                    />
                  }
                />
              </Card>
            </motion.div>
          )}
        </motion.section>

        {/* Materials */}
        <motion.section {...m.riseIn(0.14)}>
          <Label>Materials</Label>
          <Card className="mt-3.5 overflow-hidden">
            <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--v-border)" }}>
              <Slider
                label="Transparency"
                value={settings.transparency}
                onChange={(v) => set("transparency", v)}
              />
            </div>
            <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--v-border)" }}>
              <Slider
                label="Corner radius"
                value={settings.radius}
                min={6}
                max={30}
                step={1}
                suffix={`${settings.radius}px`}
                onChange={(v) => set("radius", v)}
              />
            </div>
            <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--v-border)" }}>
              <Slider
                label="Background motion"
                value={settings.motion}
                onChange={(v) => set("motion", v)}
              />
            </div>
            <Row
              title="Neumorphism"
              note="Soft elevation and inset controls"
              right={
                <Switch
                  checked={settings.neumorphism}
                  label="Neumorphism"
                  onChange={(v) => set("neumorphism", v)}
                />
              }
            />
            <Row
              title="Compact mode"
              note="Tighter rows and spacing"
              right={<Switch checked={settings.compact} label="Compact mode" onChange={(v) => set("compact", v)} />}
            />
            <Row
              title="OLED mode"
              note="True black surfaces"
              right={
                <Switch
                  checked={settings.theme === "oled"}
                  label="OLED mode"
                  onChange={(v) => set("theme", v ? "oled" : "dark")}
                />
              }
              last
            />
          </Card>
        </motion.section>

        {/* Accessibility */}
        <motion.section {...m.riseIn(0.2)}>
          <Label>Accessibility</Label>
          <Card className="mt-3.5 overflow-hidden">
            <Row
              title="Reduce motion"
              note="Replaces transitions with fades"
              right={
                <Switch
                  checked={settings.reducedMotion}
                  label="Reduce motion"
                  onChange={(v) => set("reducedMotion", v)}
                />
              }
            />
            <Row
              title="Large text"
              note="Increases body sizes across the app"
              right={<Switch checked={settings.largeText} label="Large text" onChange={(v) => set("largeText", v)} />}
            />
            <Row
              title="Battery saver"
              note="Pauses background motion and video"
              right={
                <Switch
                  checked={settings.batterySaver}
                  label="Battery saver"
                  onChange={(v) => set("batterySaver", v)}
                />
              }
              last
            />
          </Card>
        </motion.section>
      </div>
    </div>
  );
}

const BACKGROUNDS: { id: BackgroundKind; label: string; note: string }[] = [
  { id: "gradient", label: "Animated Gradient", note: "Accent-tinted, very slow" },
  { id: "video", label: "Video", note: "Cinematic loop" },
  { id: "album", label: "Album Art", note: "Blurred from what's playing" },
  { id: "static", label: "Static", note: "One fixed wash" },
  { id: "none", label: "None", note: "Flat background" },
];

export function BackgroundScreen() {
  const { m, go, settings, set, accent, bgActive } = useVibra();

  return (
    <div className="mx-auto max-w-2xl pb-10">
      <ScreenHeader kicker="Background" title="Set the room" onBack={() => go("profile")} />

      <div className="mt-6 space-y-8 px-6">
        <motion.section {...m.riseIn(0)}>
          <Label>Style</Label>
          <Card className="mt-3.5 overflow-hidden">
            {BACKGROUNDS.map((b, i) => (
              <Row
                key={b.id}
                title={b.label}
                note={b.note}
                onClick={() => set("background", b.id)}
                last={i === BACKGROUNDS.length - 1}
                right={
                  <span className="flex items-center gap-3">
                    <span
                      className="relative block overflow-hidden"
                      style={{ width: 54, height: 34, borderRadius: 10, border: "1px solid var(--v-border)" }}
                    >
                      <PreviewFor kind={b.id} />
                    </span>
                    <motion.span
                      className="grid place-items-center rounded-full"
                      style={{
                        width: 20,
                        height: 20,
                        border: `1px solid ${settings.background === b.id ? accent : "var(--v-border-strong)"}`,
                        background: settings.background === b.id ? accent : "transparent",
                      }}
                      animate={{ scale: settings.background === b.id ? 1 : 0.94 }}
                      transition={{ duration: 0.18, ease: EASE }}
                    >
                      {settings.background === b.id && <Check size={11} color="#0B1B0F" />}
                    </motion.span>
                  </span>
                }
              />
            ))}
          </Card>
        </motion.section>

        <motion.section {...m.riseIn(0.08)}>
          <Label>Scene</Label>
          <p className="mt-2 text-[12px]" style={{ color: "var(--v-text-3)", lineHeight: 1.6 }}>
            Scenes play at a fraction of normal speed and dim automatically behind
            text. They pause in battery saver.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {VIDEO_SCENES.map((s, i) => {
              const on = settings.scene === s.id && settings.background === "video";
              return (
                <motion.div key={s.id} {...m.stagger(i, 0.04)}>
                  <Card
                    soft
                    className="overflow-hidden"
                    label={`${s.label} scene`}
                    onClick={() => {
                      set("scene", s.id);
                      set("background", "video");
                    }}
                    style={on ? { boxShadow: `0 0 0 1.5px ${accent}, 0 6px 18px var(--v-shade)` } : undefined}
                  >
                    <div className="relative h-[86px] w-full overflow-hidden">
                      <ScenePreview scene={s.id} />
                      {on && (
                        <span
                          className="absolute right-2 top-2 grid place-items-center rounded-full"
                          style={{ width: 20, height: 20, background: accent }}
                        >
                          <Check size={11} color="#0B1B0F" />
                        </span>
                      )}
                    </div>
                    <div className="px-4 py-3">
                      <p className="text-[14px]" style={{ color: "var(--v-text)" }}>
                        {s.label}
                      </p>
                      <p className="mt-0.5 text-[11px]" style={{ color: "var(--v-text-3)" }}>
                        {s.note}
                      </p>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </motion.section>

        <motion.section {...m.riseIn(0.16)}>
          <Label>Behaviour</Label>
          <Card className="mt-3.5 overflow-hidden">
            <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--v-border)" }}>
              <Slider label="Motion intensity" value={settings.motion} onChange={(v) => set("motion", v)} />
            </div>
            <Row title="Dim while reading" note="Automatic" right={<Switch checked label="Dim while reading" onChange={() => {}} />} />
            <Row
              title="Pause in battery saver"
              note={bgActive ? "Currently playing" : "Currently paused"}
              right={
                <Switch
                  checked={settings.batterySaver}
                  label="Pause in battery saver"
                  onChange={(v) => set("batterySaver", v)}
                />
              }
              last
            />
          </Card>
        </motion.section>
      </div>
    </div>
  );
}

function PreviewFor({ kind }: { kind: BackgroundKind }) {
  const { settings, accent, track } = useVibra();
  if (kind === "video") return <ScenePreview scene={settings.scene} />;
  if (kind === "album")
    return (
      <span
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${track.art})`,
          backgroundSize: "cover",
          filter: "blur(7px)",
        }}
      />
    );
  if (kind === "none") return <span className="absolute inset-0" style={{ background: "var(--v-bg)" }} />;
  if (kind === "static")
    return (
      <span
        className="absolute inset-0"
        style={{ background: `linear-gradient(160deg, var(--v-bg-deep), ${accent}26)` }}
      />
    );
  return (
    <span className="absolute inset-0" style={{ background: "var(--v-bg)" }}>
      <AmbientBackground />
    </span>
  );
}

function Label({ children }: { children: string }) {
  return (
    <p className="text-[11px] uppercase" style={{ color: "var(--v-text-3)", letterSpacing: "0.14em" }}>
      {children}
    </p>
  );
}

function ThemeSwatch({ mode }: { mode: ThemeMode }) {
  const bgs: Record<ThemeMode, string[]> = {
    light: ["#F6F5F2", "#FFFFFF"],
    dark: ["#111111", "#202020"],
    oled: ["#000000", "#131313"],
    system: ["#111111", "#F6F5F2"],
  };
  const [a, b] = bgs[mode];
  return (
    <span
      className="block overflow-hidden"
      style={{ width: 42, height: 26, borderRadius: 8, border: "1px solid var(--v-border-strong)" }}
    >
      <span className="flex h-full w-full">
        <span className="h-full w-1/2" style={{ background: a }} />
        <span className="h-full w-1/2" style={{ background: b }} />
      </span>
    </span>
  );
}
