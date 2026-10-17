import React, { useState } from "react";
import { AlertCircle, ArrowRight, Eye, EyeOff, Heart } from "lucide-react";
import { useApp } from "../context";

/**
 * Sign-in / sign-up — replaces the old onboarding wizard. Browsing stays open
 * to guests (navigating away works), but signing in is how music is kept.
 */
export function AuthScreen({ mode }: { mode: "login" | "signup" }) {
  const { C, login, register, navigate, clearError } = useApp();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === "signup";
  const canSubmit = email.trim().length > 3 && password.length >= 6 && (!isSignup || name.trim().length > 1);

  const switchMode = () => {
    setError(null);
    navigate({ id: "auth", mode: isSignup ? "login" : "signup" });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    const failure = isSignup
      ? await register(name.trim(), email.trim(), password)
      : await login(email.trim(), password);
    setBusy(false);
    if (failure) { setError(failure); return; }
    clearError();
    navigate({ id: "home" });
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", height: 46, borderRadius: 12, boxSizing: "border-box",
    padding: "0 14px", background: C.surf, border: `1px solid ${C.border}`,
    color: C.text, fontSize: 14.5, fontFamily: "inherit", outline: "none",
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 24px" }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 26 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 18, background: C.surf, border: `1px solid ${C.border}`,
            display: "grid", placeItems: "center",
          }}>
            <Heart size={24} color={C.accent} fill={C.accent} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.text, letterSpacing: -0.5, marginTop: 6 }}>
            {isSignup ? "Create your account" : "Welcome back"}
          </div>
          <div style={{ fontSize: 14, color: C.muted, textAlign: "center", lineHeight: 1.55 }}>
            {isSignup
              ? "Save your music, keep your queue, play on any device."
              : "Sign in to pick up your playlists and listening history."}
          </div>
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {isSignup && (
            <label style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: C.muted }}>Name</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name"
                autoComplete="name" style={inputStyle} />
            </label>
          )}

          <label style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: C.muted }}>Email</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"
              autoComplete="email" style={inputStyle} />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: C.muted }}>Password</span>
            <div style={{ position: "relative" }}>
              <input
                type={reveal ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={isSignup ? "At least 6 characters" : "Your password"}
                autoComplete={isSignup ? "new-password" : "current-password"}
                style={{ ...inputStyle, paddingRight: 46 }}
              />
              <button type="button" onClick={() => setReveal(r => !r)}
                aria-label={reveal ? "Hide password" : "Show password"}
                style={{
                  position: "absolute", right: 6, top: 5, width: 36, height: 36, borderRadius: 10,
                  background: "none", border: "none", cursor: "pointer", display: "grid",
                  placeItems: "center", color: C.muted,
                }}>
                {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {error && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.accent }}>
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              {error}
            </div>
          )}

          <button type="submit" disabled={!canSubmit || busy} style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
            height: 46, borderRadius: 999, border: "none", marginTop: 4,
            background: canSubmit ? C.accent : C.surf,
            color: canSubmit ? "#fff" : C.dim,
            fontWeight: 700, fontSize: 15, cursor: canSubmit && !busy ? "pointer" : "default",
            transition: "background .15s",
          }}>
            {busy ? (isSignup ? "Creating account…" : "Signing in…") : (isSignup ? "Create account" : "Sign in")}
            {!busy && <ArrowRight size={16} />}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 18, fontSize: 13.5, color: C.muted }}>
          {isSignup ? "Already have an account? " : "New to Vibra? "}
          <button onClick={switchMode} style={{
            background: "none", border: "none", padding: 0, cursor: "pointer",
            color: C.text, fontWeight: 700, fontSize: 13.5, fontFamily: "inherit",
          }}>
            {isSignup ? "Sign in" : "Create account"}
          </button>
        </div>

        <div style={{ textAlign: "center", marginTop: 14 }}>
          <button onClick={() => { clearError(); navigate({ id: "home" }); }} style={{
            background: "none", border: "none", cursor: "pointer", color: C.dim,
            fontSize: 13, fontFamily: "inherit",
          }}>
            Keep browsing without an account
          </button>
        </div>
      </div>
    </div>
  );
}
