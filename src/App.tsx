import { useCallback, useEffect, useRef, useState } from "react";
import type { Aircraft } from "./lib/aircraft";
import {
  DEFAULT_CONFIG,
  hasSavedConfig,
  loadConfig,
  mergeConfig,
  saveConfig,
  type Config,
  type Theme,
} from "./lib/config";
import { geocode } from "./lib/geocode";
import { Poller, type SourceStatus } from "./lib/poller";
import { Renderer } from "./display/renderer";
import { SettingsPanel } from "./ui/SettingsPanel";
import { FlightPopover } from "./ui/FlightPopover";
import { SpeedInsights } from "@vercel/speed-insights/react";

const THEMES: Theme[] = ["ambient", "telemetry", "focus"];
/** Hide the floating chrome after this long without pointer activity. */
const CHROME_IDLE_MS = 3500;

export default function App() {
  const [config, setConfig] = useState<Config>(loadConfig);
  const configRef = useRef(config);
  configRef.current = config;

  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [welcome, setWelcome] = useState(() => !hasSavedConfig());
  const [chromeVisible, setChromeVisible] = useState(true);
  const [selected, setSelected] = useState<Aircraft | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const aircraftRef = useRef<Aircraft[]>([]);
  const popoverRef = useRef<HTMLDivElement>(null);

  const patch = useCallback((p: Partial<Config>) => {
    setConfig((c) => {
      const next = mergeConfig(c, p);
      saveConfig(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    // Keep the place; reset everything else.
    const c = configRef.current;
    patch({
      ...DEFAULT_CONFIG,
      centerLat: c.centerLat,
      centerLon: c.centerLon,
      locationName: c.locationName,
      locationProfiles: c.locationProfiles,
    });
  }, [patch]);

  const closePanel = useCallback(() => setPanelOpen(false), []);

  const closePopover = useCallback(() => {
    setSelected(null);
    rendererRef.current?.setSelected(null);
  }, []);

  // Renderer: create once.
  useEffect(() => {
    if (!canvasRef.current) return;
    const r = new Renderer(canvasRef.current, () => configRef.current);
    rendererRef.current = r;
    // Anchor the details popover to the selected plane every frame, bypassing
    // React — a transform write is cheap; a render per frame is not.
    r.onSelectedMove = (p) => {
      const el = popoverRef.current;
      if (!p) {
        // Plane went stale or left the radius — dismiss.
        setSelected(null);
        r.setSelected(null);
        return;
      }
      if (!el) return;
      const margin = 10;
      const pw = el.offsetWidth;
      const ph = el.offsetHeight;
      let x = p.x + 22;
      let y = p.y - ph / 2;
      if (x + pw > window.innerWidth - margin) x = p.x - pw - 22;
      x = Math.max(margin, Math.min(x, window.innerWidth - pw - margin));
      y = Math.max(margin, Math.min(y, window.innerHeight - ph - margin));
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };
    r.start();
    if (import.meta.env.DEV) (window as unknown as { __renderer?: Renderer }).__renderer = r;
    const onResize = () => r.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      r.stop();
      rendererRef.current = null;
    };
  }, []);

  // Poller: create once; it reads config through the ref every tick.
  useEffect(() => {
    const poller = new Poller({
      getConfig: () => configRef.current,
      onSnapshot: (_now, aircraft) => {
        aircraftRef.current = aircraft;
        rendererRef.current?.update(aircraft);
        // Keep the open popover's numbers live (1 Hz, only while open).
        setSelected((prev) =>
          prev ? (aircraft.find((a) => a.hex === prev.hex) ?? prev) : prev,
        );
      },
      onStatus: setStatus,
    });
    poller.start();
    return () => poller.stop();
  }, []);

  // Right-click a plane → details popover. Left-click on the sky dismisses it.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onContextMenu = (e: MouseEvent) => {
      const r = rendererRef.current;
      if (!r) return;
      e.preventDefault();
      const hex = r.hitTest(e.clientX, e.clientY);
      if (hex) {
        const ac = aircraftRef.current.find((a) => a.hex === hex);
        if (ac) {
          setSelected(ac);
          r.setSelected(hex);
          return;
        }
      }
      setSelected(null);
      r.setSelected(null);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 0) closePopover();
    };
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("pointerdown", onPointerDown);
    return () => {
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("pointerdown", onPointerDown);
    };
  }, [closePopover]);

  // Moving the center invalidates all local-meter history — drop it so trails
  // don't streak across the world.
  useEffect(() => {
    rendererRef.current?.clearTracks();
    closePopover();
  }, [config.centerLat, config.centerLon, closePopover]);

  // Keyboard shortcuts (same spirit as skylight's display).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const c = configRef.current;
      switch (e.key) {
        case "t": {
          const next = THEMES[(THEMES.indexOf(c.theme) + 1) % THEMES.length];
          patch({ theme: next });
          break;
        }
        case "[":
          patch({ radiusMiles: Math.max(1, c.radiusMiles - 1) });
          break;
        case "]":
          patch({ radiusMiles: Math.min(50, c.radiusMiles + 1) });
          break;
        case "h":
          patch({ showHud: !c.showHud });
          break;
        case "p":
          patch({ projectionMode: c.projectionMode === "map" ? "sky" : "map" });
          break;
        case "s":
          setPanelOpen((o) => !o);
          break;
        case "Escape":
          setPanelOpen(false);
          closePopover();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [patch, closePopover]);

  // Auto-hide the floating chrome when the pointer goes quiet (ambient mode).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poke = () => {
      setChromeVisible(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setChromeVisible(false), CHROME_IDLE_MS);
    };
    poke();
    window.addEventListener("pointermove", poke);
    window.addEventListener("pointerdown", poke);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("pointermove", poke);
      window.removeEventListener("pointerdown", poke);
    };
  }, []);

  // --- welcome card actions ---
  const [welcomeBusy, setWelcomeBusy] = useState(false);
  const [welcomeErr, setWelcomeErr] = useState<string | null>(null);

  const finishWelcome = (p: Partial<Config>) => {
    patch(p); // saveConfig marks setup as done
    setWelcome(false);
  };

  const welcomeUseLocation = () => {
    if (!navigator.geolocation) {
      setWelcomeErr("Geolocation not supported — search for a place instead");
      return;
    }
    setWelcomeBusy(true);
    setWelcomeErr(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setWelcomeBusy(false);
        finishWelcome({
          centerLat: pos.coords.latitude,
          centerLon: pos.coords.longitude,
          locationName: "My location",
        });
      },
      (err) => {
        setWelcomeBusy(false);
        setWelcomeErr(
          err.code === err.PERMISSION_DENIED
            ? "Permission denied — search for a place instead"
            : "Location unavailable — search for a place instead",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60_000 },
    );
  };

  const welcomeSearch = async (q: string) => {
    if (!q.trim()) return;
    setWelcomeBusy(true);
    setWelcomeErr(null);
    try {
      const hit = await geocode(q);
      if (!hit) {
        setWelcomeErr(`No match for “${q}”`);
        return;
      }
      finishWelcome({ centerLat: hit.lat, centerLon: hit.lon, locationName: hit.name });
    } catch {
      setWelcomeErr("Lookup failed — try again");
    } finally {
      setWelcomeBusy(false);
    }
  };

  const chromeClass = chromeVisible || panelOpen || welcome ? "chrome visible" : "chrome";

  return (
    <div className="app-root">
      <SpeedInsights />
      <canvas ref={canvasRef} className="display-canvas" />

      <div className={chromeClass}>
        <div className="status-line">
          <span className={`dot ${status?.ok ? "ok" : "bad"}`} />
          <span className="status-place">{config.locationName}</span>
          <span className="status-meta">
            {status ? `${status.count} aircraft` : "connecting…"} · {config.radiusMiles} mi
          </span>
        </div>
        <button
          className="gear-btn"
          aria-label="Open settings"
          onClick={() => setPanelOpen(true)}
        >
          ⚙
        </button>
      </div>

      {config.showHud && (
        <div className="hud">
          <div className={`hud-dot ${status?.ok ? "ok" : "bad"}`} />
          <span>
            {status?.ok ? "live" : (status?.message ?? "—")} · {status?.count ?? 0} ac · r{" "}
            {config.radiusMiles}mi · {config.projectionMode} · {config.theme}
          </span>
        </div>
      )}

      {selected && (
        <FlightPopover ref={popoverRef} ac={selected} cfg={config} onClose={closePopover} />
      )}

      {welcome && (
        <div className="welcome-backdrop">
          <div className="welcome-card">
            <h1>Skyview</h1>
            <p>
              The aircraft moving through the sky around you, live. Pick where to
              watch from — adjust the radius any time, and right-click any plane
              for its full details.
            </p>
            <button className="welcome-primary" disabled={welcomeBusy} onClick={welcomeUseLocation}>
              Use my location
            </button>
            <div className="welcome-divider">or</div>
            <input
              className="welcome-input"
              type="text"
              placeholder="city, airport, or lat,lon"
              spellCheck={false}
              disabled={welcomeBusy}
              onKeyDown={(e) => {
                if (e.key === "Enter") void welcomeSearch(e.currentTarget.value);
              }}
            />
            {welcomeErr && <div className="welcome-err">{welcomeErr}</div>}
            <button
              className="welcome-skip"
              onClick={() => finishWelcome({})}
            >
              Skip — watch San Francisco
            </button>
          </div>
        </div>
      )}

      <SettingsPanel
        cfg={config}
        status={panelOpen ? status : null}
        open={panelOpen}
        onClose={closePanel}
        set={patch}
        onReset={reset}
      />
    </div>
  );
}
