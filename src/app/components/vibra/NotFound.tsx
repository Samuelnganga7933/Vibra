import React from "react";
import { Compass } from "lucide-react";
import { EmptyStateCard } from "../ui/EmptyStateCard";
import { UiThemeContext, type UiColors } from "../ui/ui-theme";

const NOT_FOUND_GIF =
  "https://media.giphy.com/media/YRcXl6VfNhCorklI0R/giphy.gif";

interface NotFoundProps {
  /** Where "Return to Discover" leads — defaults to the discover screen. */
  onReturn?: () => void;
  colors?: UiColors;
}

/** 404 / unknown route frame: lost signal, with a way back to discovery. */
export function NotFound({ onReturn, colors }: NotFoundProps) {
  const C = React.useContext(UiThemeContext);
  const C_ = colors ?? C;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 0,
        overflowY: "auto",
        padding: "32px 28px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 440 }}>
        <EmptyStateCard
          colors={C_}
          visual={NOT_FOUND_GIF}
          title="Frequency Lost"
          subtitle="The track or collection you are looking for has drifted out of reach."
          action={
            <button
              type="button"
              onClick={() => (onReturn ? onReturn() : window.location.assign("/"))}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                height: 44,
                padding: "0 22px",
                borderRadius: 22,
                border: "none",
                background: C_.accent,
                color: C_.bg,
                fontSize: 14.5,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <Compass size={16} aria-hidden />
              Return to Discover
            </button>
          }
        />
      </div>
    </div>
  );
}
