import { createContext, useContext } from "react";

/** Shared colour tokens for standalone UI pieces (cards, empty states, views). */
export interface UiColors {
  bg: string;
  pane: string;
  surf: string;
  accent: string;
  text: string;
  muted: string;
  dim?: string;
  border: string;
}

export const defaultUiColors: UiColors = {
  bg: "#0b0a10",
  pane: "#14131c",
  surf: "#1f1e2b",
  accent: "#e8334f",
  text: "#f4f3f8",
  muted: "#a9a7bd",
  dim: "#8886a0",
  border: "#2c2a3e",
};

export const UiThemeContext = createContext<UiColors>(defaultUiColors);

/** Reads the ambient theme, with an optional per-instance override. */
export function useUiTheme(override?: UiColors): UiColors {
  const ctx = useContext(UiThemeContext);
  return override ?? ctx;
}
