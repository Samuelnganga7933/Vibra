import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, Check, Mail } from "lucide-react";
import { useVibra } from "../store";
import { ONBOARDING_TASTES, ARTISTS } from "../data";
import { Art } from "../primitives";
import { DUR, EASE } from "../motion";

// ─── Vibra mark ───────────────────────────────────────────────────────────────

export function VibraMark({ size = 56 }: { size?: number }) {
  const { accent } = useVibra();
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" aria-hidden>
      <circle cx="28" cy="28" r="26" stroke="var(--v-border-strong)" strokeWidth="1" />
      <path d="M28 14v28" stroke={accent} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M19 20v16M37 20v16" stroke="var(--v-text-2)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M10.5 25v6M45.5 25v6" stroke="var(--v-text-3)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Splash ───────────────────────────────────────────────────────────────────

export function SplashScreen() {
  const { go, m } = useVibra();

  useEffect(() => {
    const id = window.setTimeout(() => go("login"), m.reduced ? 600 : 1400);
    return () => window.clearTimeout(id);
  }, [go, m.reduced]);

  return (
    <div className="flex h-full w-full items-center justify-center">
      <motion.div
        className="flex flex-col items-center gap-5"
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: m.reduced ? 0.2 : 0.65, ease: EASE }}
      >
        <VibraMark size={64} />
        <div className="text-center">
          <p
            className="text-[28px] font-semibold tracking-tight"
            style={{
              color: "var(--v-text)",
              fontFamily: "Bricolage Grotesque, sans-serif",
              letterSpacing: "-0.04em",
            }}
          >
            vibra
          </p>
          <p className="mt-1.5 text-[13px]" style={{ color: "var(--v-text-3)" }}>
            AI-native music discovery
          </p>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────

export function LoginScreen() {
  const { go, m, accent } = useVibra();
  const [emailStep, setEmailStep] = useState(false);
  const [email, setEmail] = useState("");
  const [focused, setFocused] = useState(false);

  return (
    <div className="flex h-full w-full">
      {/* Left panel — branding */}
      <div
        className="relative hidden flex-col justify-between overflow-hidden p-14 lg:flex"
        style={{
          width: "52%",
          background: "rgba(255,255,255,0.022)",
          borderRight: "1px solid var(--v-border)",
        }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(ellipse at 20% 65%, ${accent}1C 0%, transparent 55%)`,
          }}
        />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <VibraMark size={34} />
          <span
            className="text-[19px] font-semibold"
            style={{
              color: "var(--v-text)",
              fontFamily: "Bricolage Grotesque, sans-serif",
              letterSpacing: "-0.04em",
            }}
          >
            vibra
          </span>
        </div>

        {/* Headline */}
        <div className="relative">
          <h1
            className="text-[50px] font-semibold leading-[1.07]"
            style={{
              color: "var(--v-text)",
              fontFamily: "Bricolage Grotesque, sans-serif",
              letterSpacing: "-0.04em",
            }}
          >
            Music discovery
            <br />
            <span style={{ color: accent }}>that knows you.</span>
          </h1>
          <p
            className="mt-6 max-w-sm text-[15px] leading-relaxed"
            style={{ color: "var(--v-text-2)" }}
          >
            Playback stays familiar. Discovery is the product — natural-language
            search, Moments, and a single daily pick that actually earns your time.
          </p>
        </div>

        {/* Feature bullets */}
        <div className="relative space-y-3.5">
          {[
            "Natural-language search — describe, don't keyword-hunt",
            "AI-chosen Today's Pick from 9,120 tracks",
            "Moments that read the room without asking",
          ].map((f) => (
            <div key={f} className="flex items-start gap-3">
              <span
                className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full"
                style={{ background: `${accent}1E`, border: `1px solid ${accent}40` }}
              >
                <Check size={11} color={accent} />
              </span>
              <p className="text-[13px]" style={{ color: "var(--v-text-2)", lineHeight: 1.5 }}>
                {f}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-1 flex-col items-center justify-center px-10 lg:px-16">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="mb-10 flex items-center gap-2.5 lg:hidden">
            <VibraMark size={28} />
            <span
              className="text-[17px] font-semibold"
              style={{
                color: "var(--v-text)",
                fontFamily: "Bricolage Grotesque, sans-serif",
                letterSpacing: "-0.04em",
              }}
            >
              vibra
            </span>
          </div>

          <h2
            className="text-[28px] font-semibold"
            style={{
              color: "var(--v-text)",
              fontFamily: "Bricolage Grotesque, sans-serif",
              letterSpacing: "-0.035em",
            }}
          >
            Welcome back.
          </h2>
          <p className="mt-2 text-[14px]" style={{ color: "var(--v-text-3)" }}>
            Sign in or create a free account.
          </p>

          <AnimatePresence mode="wait">
            {!emailStep ? (
              <motion.div
                key="choose"
                className="mt-8 space-y-3"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: EASE }}
              >
                <OAuthButton
                  icon="apple"
                  label="Continue with Apple"
                  onClick={() => go("onboarding")}
                />
                <OAuthButton
                  icon="google"
                  label="Continue with Google"
                  onClick={() => go("onboarding")}
                />

                <div className="flex items-center gap-3 py-1">
                  <div className="h-px flex-1" style={{ background: "var(--v-border)" }} />
                  <span className="text-[12px]" style={{ color: "var(--v-text-3)" }}>
                    or
                  </span>
                  <div className="h-px flex-1" style={{ background: "var(--v-border)" }} />
                </div>

                <button
                  type="button"
                  onClick={() => setEmailStep(true)}
                  className="flex w-full items-center gap-3 rounded-xl px-4"
                  style={{
                    height: 50,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid var(--v-border)",
                    color: "var(--v-text-2)",
                    fontSize: 14,
                  }}
                >
                  <Mail size={16} />
                  Continue with email
                </button>

                <p
                  className="pt-1 text-center text-[11px] leading-relaxed"
                  style={{ color: "var(--v-text-3)" }}
                >
                  By continuing you agree to our{" "}
                  <span style={{ color: "var(--v-text-2)" }}>Terms</span> and{" "}
                  <span style={{ color: "var(--v-text-2)" }}>Privacy Policy</span>.
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="email"
                className="mt-8 space-y-3"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: EASE }}
              >
                <div>
                  <label
                    className="mb-2 block text-[11px] uppercase"
                    style={{ color: "var(--v-text-3)", letterSpacing: "0.1em" }}
                    htmlFor="email-input"
                  >
                    Email address
                  </label>
                  <input
                    id="email-input"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    className="w-full rounded-xl px-4 text-[14px] outline-none"
                    style={{
                      height: 52,
                      background: "rgba(255,255,255,0.05)",
                      border: `1px solid ${focused ? `${accent}66` : "var(--v-border)"}`,
                      color: "var(--v-text)",
                      transition: "border-color 0.2s",
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && email.trim()) go("onboarding");
                    }}
                    autoFocus
                  />
                </div>
                <motion.button
                  type="button"
                  onClick={() => go("onboarding")}
                  className="flex w-full items-center justify-center gap-2 rounded-xl text-[14px] font-medium"
                  style={{
                    height: 52,
                    background: accent,
                    color: "#07070A",
                    boxShadow: `0 8px 24px ${accent}38`,
                  }}
                  whileHover={m.reduced ? undefined : { scale: 1.02 }}
                  whileTap={m.reduced ? undefined : { scale: 0.98 }}
                  transition={{ duration: DUR.button, ease: EASE }}
                >
                  Continue <ArrowRight size={15} />
                </motion.button>
                <button
                  type="button"
                  onClick={() => setEmailStep(false)}
                  className="w-full py-2 text-center text-[13px]"
                  style={{ color: "var(--v-text-3)" }}
                >
                  ← Other options
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function OAuthButton({
  icon,
  label,
  onClick,
}: {
  icon: "apple" | "google";
  label: string;
  onClick: () => void;
}) {
  const { m } = useVibra();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-4 text-[14px]"
      style={{
        height: 50,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid var(--v-border)",
        color: "var(--v-text)",
      }}
      whileHover={m.reduced ? undefined : { background: "rgba(255,255,255,0.1)" }}
      whileTap={m.reduced ? undefined : { scale: 0.99 }}
      transition={{ duration: 0.15, ease: EASE }}
    >
      {icon === "apple" ? <AppleIcon /> : <GoogleIcon />}
      {label}
    </motion.button>
  );
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

const STEPS = ["What moves you?", "Who do you love?", "Ready to listen."];

export function OnboardingScreen() {
  const { go, m, accent } = useVibra();
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const advance = () => (step < 2 ? setStep(step + 1) : go("home"));

  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-6 py-12">
      {/* Progress dots */}
      <div className="mb-10 flex gap-2">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className="rounded-full"
            style={{
              width: i === step ? 24 : 7,
              height: 7,
              background: i === step ? accent : "var(--v-border-strong)",
              transition: "all 0.28s ease",
            }}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          className="flex w-full max-w-2xl flex-col items-center text-center"
          initial={{ opacity: 0, x: m.reduced ? 0 : 28 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: m.reduced ? 0 : -28 }}
          transition={{ duration: m.reduced ? 0.18 : 0.32, ease: EASE }}
        >
          <h1
            className="text-[38px] font-semibold"
            style={{
              color: "var(--v-text)",
              fontFamily: "Bricolage Grotesque, sans-serif",
              letterSpacing: "-0.04em",
            }}
          >
            {STEPS[step]}
          </h1>

          {step === 0 && (
            <>
              <p className="mt-3 text-[15px]" style={{ color: "var(--v-text-2)" }}>
                Pick the textures that resonate. Vibra reads patterns, not genre labels.
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-3">
                {ONBOARDING_TASTES.map((taste, i) => {
                  const on = selected.has(taste);
                  return (
                    <motion.button
                      key={taste}
                      type="button"
                      onClick={() => toggle(taste)}
                      className="rounded-full px-5 py-2.5 text-[14px]"
                      style={{
                        background: on ? accent : "rgba(255,255,255,0.06)",
                        color: on ? "#07070A" : "var(--v-text-2)",
                        border: `1px solid ${on ? accent : "var(--v-border)"}`,
                        fontWeight: on ? 500 : 400,
                        boxShadow: on ? `0 4px 16px ${accent}40` : "none",
                        transition: "all 0.18s ease",
                      }}
                      {...m.stagger(i, 0.03, 0)}
                    >
                      {taste}
                    </motion.button>
                  );
                })}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <p className="mt-3 text-[15px]" style={{ color: "var(--v-text-2)" }}>
                Choose a few artists you know well. We&apos;ll find who you haven&apos;t heard yet.
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-3">
                {ARTISTS.slice(0, 12).map((a, i) => {
                  const on = selected.has(a.id);
                  return (
                    <motion.button
                      key={a.id}
                      type="button"
                      onClick={() => toggle(a.id)}
                      className="flex items-center gap-2.5 overflow-hidden rounded-full"
                      style={{
                        height: 44,
                        paddingLeft: 4,
                        paddingRight: 16,
                        background: on ? `${accent}1E` : "rgba(255,255,255,0.05)",
                        border: `1px solid ${on ? accent + "55" : "var(--v-border)"}`,
                        transition: "all 0.18s ease",
                      }}
                      {...m.stagger(i, 0.03, 0)}
                    >
                      <div
                        className="h-9 w-9 shrink-0 overflow-hidden rounded-full"
                        style={{ border: `1px solid ${on ? accent : "var(--v-border)"}` }}
                      >
                        <Art src={a.art} alt={a.name} className="h-full w-full" />
                      </div>
                      <span
                        className="text-[13px]"
                        style={{ color: on ? "var(--v-text)" : "var(--v-text-2)", fontWeight: on ? 500 : 400 }}
                      >
                        {a.name}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </>
          )}

          {step === 2 && (
            <div className="mt-8 flex flex-col items-center gap-5">
              <div
                className="flex h-20 w-20 items-center justify-center rounded-full"
                style={{ background: `${accent}18`, border: `2px solid ${accent}44` }}
              >
                <Check size={36} color={accent} />
              </div>
              <p
                className="max-w-sm text-[15px] leading-relaxed"
                style={{ color: "var(--v-text-2)" }}
              >
                Vibra has everything it needs. Your first discovery is waiting.
              </p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={advance}
        className="mt-12 flex items-center gap-2 rounded-full px-8 text-[15px] font-medium"
        style={{
          height: 52,
          background: selected.size > 0 || step === 2 ? accent : "rgba(255,255,255,0.08)",
          color: selected.size > 0 || step === 2 ? "#07070A" : "var(--v-text-3)",
          boxShadow: selected.size > 0 || step === 2 ? `0 8px 24px ${accent}40` : "none",
          transition: "all 0.22s ease",
        }}
        whileHover={m.reduced ? undefined : { scale: 1.03 }}
        whileTap={m.reduced ? undefined : { scale: 0.97 }}
        transition={{ duration: DUR.button, ease: EASE }}
      >
        {step < 2 ? "Continue" : "Start listening"}
        <ArrowRight size={16} />
      </motion.button>
    </div>
  );
}

// ─── OAuth icon SVGs ──────────────────────────────────────────────────────────

function AppleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.39-1.32 2.76-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}
