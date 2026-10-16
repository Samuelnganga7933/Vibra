import { createContext, useContext } from "react";

/** Shared colour tokens for standalone UI pieces (cards, empty states, views). */
export interface UiColors {
  bg: string;
  pane: string;
  surf: string;
  accent: string;
  text: string;
  muted: string;
  border: string;
}

export const defaultUiColors: UiColors = {
  bg: "#0B0A12",
  pane: "#14121F",
  surf: "#1F1B30",
  accent: "#E8354D",
  text: "#F2F0FA",
  muted: "#A9A6BD",
  border: "#26223A",
};

export const UiThemeContext = createContext<UiColors>(defaultUiColors);

/** Reads the ambient theme, with an optional per-instance override. */
export function useUiTheme(override?: UiColors): UiColors {
  const ctx = useContext(UiThemeContext);
  return override ?? ctx;
}
