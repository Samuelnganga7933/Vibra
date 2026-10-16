import { motion } from "motion/react";
import { ChevronRight, Palette, Wallpaper } from "lucide-react";
import { useVibra } from "../store";
import { PLAYLISTS } from "../data";
import { Art, Card, Row, SectionTitle, Switch } from "../primitives";
import { ImageWithFallback } from "../../figma/ImageWithFallback";

export function ProfileScreen() {
  const { m, go, settings, set, accent } = useVibra();

  return (
    <div className="mx-auto max-w-3xl space-y-9 pb-10">
      <motion.div className="px-8 pt-10" {...m.riseIn(0)}>
        <div className="flex items-center gap-4">
          <div
            className="overflow-hidden rounded-full"
            style={{ width: 68, height: 68, boxShadow: "0 8px 20px var(--v-shade)" }}
          >
            <ImageWithFallback
              src="https://images.unsplash.com/photo-1628345868536-de082a3babf5?w=200&h=200&fit=crop&auto=format&q=80"
              alt="Your profile photo"
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <h1
              className="text-[28px] font-semibold"
              style={{ color: "var(--v-text)", lineHeight: 1.15, fontFamily: "Bricolage Grotesque, sans-serif", letterSpacing: "-0.03em" }}
            >
              Amara Bello
            </h1>
            <p className="mt-0.5 text-[13px]" style={{ color: "var(--v-text-3)" }}>
              @amarab · Vibra since 2024
            </p>
          </div>
        </div>
      </motion.div>

      <motion.section {...m.riseIn(0.08)}>
        <SectionTitle title="Your playlists" kicker={`${PLAYLISTS.length} lists`} />
        <div className="v-scroll mt-4 flex gap-3.5 overflow-x-auto px-6 pb-1">
          {PLAYLISTS.map((p) => (
            <Card key={p.id} soft className="shrink-0 p-2.5" label={p.name} onClick={() => go("library")}>
              <Art src={p.art} alt={`${p.name} cover`} className="h-[118px] w-[118px]" radius={14} />
              <div className="px-1 pb-1 pt-3" style={{ width: 118 }}>
                <p className="truncate text-[13px]" style={{ color: "var(--v-text)" }}>
                  {p.name}
                </p>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--v-text-3)" }}>
                  {p.count} tracks
                </p>
              </div>
            </Card>
          ))}
        </div>
      </motion.section>

      <motion.section {...m.riseIn(0.14)} className="px-6">
        <SectionTitle title="Settings" kicker="Account & app" />
        <Card className="mt-4 overflow-hidden">
          <Row
            title="Appearance"
            note={`${labelFor(settings.theme)} · ${capitalise(settings.accent)} accent`}
            onClick={() => go("appearance")}
            right={
              <span className="flex items-center gap-2.5">
                <span
                  className="block rounded-full"
                  style={{ width: 15, height: 15, background: accent, transition: "background 900ms" }}
                />
                <ChevronRight size={16} color="var(--v-text-3)" />
              </span>
            }
          />
          <Row
            title="Background"
            note={capitalise(settings.background === "video" ? settings.scene : settings.background)}
            onClick={() => go("backgrounds")}
            right={<ChevronRight size={16} color="var(--v-text-3)" />}
          />
          <Row
            title="Downloads over Wi-Fi only"
            right={<Switch checked label="Downloads over Wi-Fi only" onChange={() => {}} />}
          />
          <Row
            title="Battery saver"
            note="Pauses background motion"
            right={
              <Switch
                checked={settings.batterySaver}
                label="Battery saver"
                onChange={(v) => set("batterySaver", v)}
              />
            }
          />
          <Row title="Playback & audio quality" right={<ChevronRight size={16} color="var(--v-text-3)" />} />
          <Row title="Privacy" right={<ChevronRight size={16} color="var(--v-text-3)" />} last />
        </Card>

        <div className="mt-4 flex gap-3">
          <Card soft onClick={() => go("appearance")} label="Appearance settings" className="flex-1">
            <div className="flex items-center gap-3 px-4 py-4">
              <Palette size={16} color="var(--v-text-2)" />
              <span className="text-[13px]" style={{ color: "var(--v-text)" }}>
                Appearance
              </span>
            </div>
          </Card>
          <Card soft onClick={() => go("backgrounds")} label="Background settings" className="flex-1">
            <div className="flex items-center gap-3 px-4 py-4">
              <Wallpaper size={16} color="var(--v-text-2)" />
              <span className="text-[13px]" style={{ color: "var(--v-text)" }}>
                Backgrounds
              </span>
            </div>
          </Card>
        </div>

        <button
          type="button"
          onClick={() => go("login")}
          className="mt-6 w-full py-4 text-center text-[14px]"
          style={{ color: "var(--v-text-3)" }}
        >
          Sign out
        </button>
      </motion.section>
    </div>
  );
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const labelFor = (t: string) => (t === "oled" ? "OLED Black" : capitalise(t));
