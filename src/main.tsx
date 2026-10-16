import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import { installRuntimeGuards } from "./app/components/ErrorBoundary";
import "./styles/index.css";

installRuntimeGuards();

createRoot(document.getElementById("root")!).render(<App />);
