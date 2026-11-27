import { createRoot } from "react-dom/client";
// Self-hosted fonts (bundled at build time; no font CDN at runtime). Latin subset for Inter, Bengali subset for Noto.
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/noto-sans-bengali/bengali-400.css";
import "@fontsource/noto-sans-bengali/bengali-600.css";
import "@fontsource/noto-sans-bengali/bengali-700.css";
import App from "./App.jsx";
import "./styles.css";
import "./wardmap.css";
import "./round2.css";

createRoot(document.getElementById("root")).render(<App />);
