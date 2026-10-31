const PLAYER_SCREENSAVER_KEY = "vibra.player.screensaver";

export function getPlayerScreensaverEnabled(): boolean {
  try {
    return window.localStorage.getItem(PLAYER_SCREENSAVER_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPlayerScreensaverEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(PLAYER_SCREENSAVER_KEY, enabled ? "1" : "0");
  } catch {
    /* storage can be unavailable in private WebViews */
  }
  window.dispatchEvent(new CustomEvent("vibra:player-screensaver", { detail: enabled }));
}
