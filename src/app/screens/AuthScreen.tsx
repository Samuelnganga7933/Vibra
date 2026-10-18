import React, { useState } from "react";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../context";
import { signInWithGoogle } from "../services/neonAuth";

/**
 * Log in / Sign up — the full-screen split layout from the design boards
 * (docs/design/boards/Login.html and Signup.html): form on the left, gradient
 * cover-card panel on the right. Covers the shell completely while open; the
 * logo sends you back to browsing.
 */
export function AuthScreen({ mode }: { mode: "login" | "signup" }) {
  const { C, login, register, navigate, clearError } = useApp();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === "signup";
  const canSubmit = email.trim().length > 3 && password.length >= 8;

  const switchMode = () => {
    setError(null);
    navigate({ id: "auth", mode: isSignup ? "login" : "signup" });
  };

  const goHome = () => {
    clearError();
    navigate({ id: "home" });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!canSubmit) {
      setError("Enter a valid email and a password of at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    // The board has no name field — the display name comes from the email
    // local part (changeable later in Settings).
    const derived = (email.split("@")[0] || "").trim().slice(0, 60) || "Vibra listener";
    const failure = isSignup
      ? await register(derived, email.trim(), password)
      : await login(email.trim(), password);
    setBusy(false);
    if (failure) { setError(failure); return; }
    clearError();
    navigate({ id: "home" });
  };

  const google = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    // Redirects the browser to Google → Neon Auth → back to the app; the
    // App bootstrap exchanges the Better Auth session for a Vibra session.
    const failure = await signInWithGoogle();
    if (failure) {
      setBusy(false);
      setError(failure);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", height: 52, borderRadius: "var(--radius-input)", boxSizing: "border-box",
    padding: "0 16px", background: C.surf, border: `1px solid ${C.border}`,
    color: C.text, fontSize: 15, fontFamily: "inherit", outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    display: "flex", flexDirection: "column", gap: 8,
    fontSize: 13, fontWeight: 600, color: C.muted,
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 80, overflowY: "auto", background: C.bg,
      display: "grid", gridTemplateColumns: "1fr 1fr", minWidth: 1100, minHeight: "100%",
      color: C.text, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    }}>
      {/* ── Form side ─────────────────────────────────────────────────────── */}
      <section style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "0 48px" }}>
        <button onClick={goHome} aria-label="Back to Home"
          style={{
            position: "absolute", top: 36, left: 48, fontSize: 28, fontWeight: 800,
            color: C.text, background: "none", border: "none", padding: 0, cursor: "pointer",
            fontFamily: "inherit", lineHeight: 1,
          }}>
          vibra<span style={{ color: "var(--brand)" }}>.</span>
        </button>

        <div style={{ width: "min(400px, 100%)", display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 34, fontWeight: 800, lineHeight: 1.2, color: C.text }}>
              {isSignup ? "Create your account" : "Welcome back"}
            </h1>
            <p style={{ margin: "8px 0 0", fontSize: 15, color: C.muted }}>
              {isSignup
                ? "Save playlists, likes and history, and play anywhere."
                : "Log in to pick up where you left off."}
            </p>
          </div>

          <button type="button" onClick={google} disabled={busy}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              border: "1px solid var(--google-border)", background: "none", color: C.text,
              borderRadius: 999, height: 52, fontWeight: 600, fontSize: 15, fontFamily: "inherit",
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, transition: "opacity .15s",
            }}>
            Continue with Google
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 14, color: "var(--faint)", fontSize: 12 }}>
            <span style={{ flex: 1, height: 1, background: "var(--hairline)" }} />
            or
            <span style={{ flex: 1, height: 1, background: "var(--hairline)" }} />
          </div>

          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <label style={labelStyle}>
              Email
              <input className="auth-field" type="email" value={email}
                onChange={e => setEmail(e.target.value)} placeholder="you@example.com"
                autoComplete="email" style={inputStyle} />
            </label>

            <label style={labelStyle}>
              Password
              <span style={{ position: "relative", display: "block" }}>
                <input className="auth-field"
                  type={reveal ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={isSignup ? "At least 8 characters" : "••••••••"}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  style={{ ...inputStyle, paddingRight: 46 }}
                />
                <button type="button" onClick={() => setReveal(r => !r)}
                  aria-label={reveal ? "Hide password" : "Show password"}
                  style={{
                    position: "absolute", right: 6, top: 8, width: 36, height: 36, borderRadius: 10,
                    background: "none", border: "none", cursor: "pointer", display: "grid",
                    placeItems: "center", color: C.muted,
                  }}>
                  {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>

            {!isSignup && (
              <div style={{ textAlign: "right", marginTop: -6 }}>
                <button type="button"
                  onClick={() => toast.info("Password reset isn't set up yet — create a new account if you've lost access.")}
                  style={{
                    background: "none", border: "none", padding: 0, cursor: "pointer",
                    color: C.muted, fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                  }}>
                  Forgot password?
                </button>
              </div>
            )}

            {error && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--brand)" }}>
                <AlertCircle size={15} style={{ flexShrink: 0 }} />
                {error}
              </div>
            )}

            <button type="submit" disabled={busy} style={{
              border: 0, background: "var(--brand)", color: "#fff", borderRadius: 999,
              height: 54, fontWeight: 800, fontSize: 16, marginTop: 4,
              fontFamily: "inherit", cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.7 : 1, transition: "opacity .15s",
            }}>
              {busy ? (isSignup ? "Creating account…" : "Signing in…") : (isSignup ? "Sign up" : "Log in")}
            </button>

            {isSignup && (
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: C.dim, textAlign: "center" }}>
                By signing up you agree to the Terms and the Privacy Policy.
              </p>
            )}
          </form>

          <div style={{ textAlign: "center", fontSize: 14, color: C.muted }}>
            {isSignup ? "Already have an account? " : "New to Vibra? "}
            <button type="button" onClick={switchMode} style={{
              background: "none", border: "none", padding: 0, cursor: "pointer",
              color: C.text, fontWeight: 700, fontSize: 14, fontFamily: "inherit",
            }}>
              {isSignup ? "Log in" : "Sign up"}
            </button>
          </div>
        </div>
      </section>

      {/* ── Art side — gradient panel with tilted cover cards ─────────────── */}
      <section aria-hidden style={{
        position: "relative", overflow: "hidden",
        background: "linear-gradient(160deg,#4a1e2a,#1a1220 70%)",
        display: "flex", alignItems: "flex-end", padding: 56,
      }}>
        <span style={{ position: "absolute", width: 260, height: 260, borderRadius: 24, background: "linear-gradient(135deg,#c2784a,#5a1a2a)", left: 150, top: 150, transform: "rotate(-8deg)", boxShadow: "0 30px 60px #0007" }} />
        <span style={{ position: "absolute", width: 220, height: 220, borderRadius: 24, background: "linear-gradient(135deg,#3a2a8a,#7a4ae8)", left: 330, top: 330, transform: "rotate(7deg)", boxShadow: "0 30px 60px #0007" }} />
        <span style={{ position: "absolute", width: 190, height: 190, borderRadius: 24, background: "linear-gradient(135deg,#1d4a3a,#4ac2a0)", left: 90, top: 430, transform: "rotate(-4deg)", boxShadow: "0 30px 60px #0007" }} />
        <div style={{ position: "relative", fontSize: 30, fontWeight: 800, lineHeight: 1.2, maxWidth: 380 }}>
          Your music, wherever you play.
        </div>
      </section>
    </div>
  );
}
