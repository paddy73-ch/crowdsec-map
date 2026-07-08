import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, Crosshair, Globe2, RefreshCcw, ShieldAlert, Timer } from "lucide-react";
import { geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import world from "world-atlas/countries-110m.json";
import "./styles.css";

const countries = feature(world, world.objects.countries).features;
const HOME = { latitude: 47.3769, longitude: 8.5417 };
const SOURCE_OPTIONS = [
  ["auto", "Auto"],
  ["cscli", "cscli"],
  ["lapi-alerts", "LAPI alerts"],
  ["lapi-decisions", "LAPI decisions"],
  ["sample", "Sample"]
];
const MAX_MAP_POINTS = 180;
const MAX_SIGNAL_PATHS = 30;

function App() {
  const [source, setSource] = useState("auto");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/attacks?source=${encodeURIComponent(source)}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      setData(await response.json());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const interval = window.setInterval(loadData, (data?.refreshSeconds || 30) * 1000);
    return () => window.clearInterval(interval);
  }, [data?.refreshSeconds, loadData]);

  const attacks = data?.alerts || [];
  const totals = data?.totals || {};

  return (
    <main className="appShell">
      <Sidebar data={data} totals={totals} />
      <section className="mapStage">
        <Toolbar
          source={source}
          setSource={setSource}
          data={data}
          loading={loading}
          onRefresh={loadData}
        />
        <WorldMap attacks={attacks} />
        <Timeline attacks={attacks} error={error || data?.warning} />
      </section>
    </main>
  );
}

function Sidebar({ data, totals }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brandMark"><ShieldAlert size={22} /></span>
        <div>
          <h1>CrowdSec Map</h1>
          <p>Live attacks</p>
        </div>
      </div>

      <div className="metricGrid">
        <Metric icon={<Activity />} label="Alerts" value={totals.alerts || 0} />
        <Metric icon={<Globe2 />} label="Countries" value={totals.countries || 0} />
        <Metric icon={<Crosshair />} label="Scenarios" value={totals.scenarios || 0} />
        <Metric icon={<ShieldAlert />} label="Decisions" value={totals.bans || 0} />
      </div>

      <Panel title="Countries" items={data?.topCountries || []} />
      <Panel title="Scenarios" items={data?.topScenarios || []} wide />

    </aside>
  );
}

function Metric({ icon, label, value }) {
  return (
    <div className="metric">
      {React.cloneElement(icon, { size: 18 })}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Panel({ title, items, wide = false }) {
  const max = Math.max(...items.map((item) => item.count), 1);
  return (
    <section className={wide ? "panel panelWide" : "panel"}>
      <h2>{title}</h2>
      <div className="rankList">
        {items.length === 0 && <p className="empty">No data yet</p>}
        {items.map((item) => (
          <div className="rankRow" key={item.label}>
            <span title={item.label}>{item.label}</span>
            <div className="bar"><i style={{ width: `${Math.max(8, (item.count / max) * 100)}%` }} /></div>
            <strong>{item.count}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function Toolbar({ source, setSource, data, loading, onRefresh }) {
  return (
    <header className="toolbar">
      <div>
        <h2>Live attacks</h2>
        <p>Last update {formatTime(data?.generatedAt)}</p>
      </div>
      <div className="toolbarControls">
        <div className="toolbarStatus">
          <span>Source <strong>{data?.source || "..."}</strong></span>
          <span><Timer size={13} /> {data?.refreshSeconds || 30}s</span>
        </div>
        <label>
          <span>Source</span>
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            {SOURCE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={onRefresh} disabled={loading} title="Refresh" aria-label="Refresh">
          <RefreshCcw size={17} className={loading ? "spin" : ""} />
        </button>
      </div>
    </header>
  );
}

function WorldMap({ attacks }) {
  const projection = useMemo(() => geoEqualEarth().fitSize([1120, 590], { type: "Sphere" }), []);
  const path = useMemo(() => geoPath(projection), [projection]);
  const homePoint = projection([HOME.longitude, HOME.latitude]);
  const mapAttacks = useMemo(() => compactMapAttacks(attacks), [attacks]);
  const plotted = mapAttacks.slice(0, MAX_MAP_POINTS)
    .map((attack) => {
      const point = projection([attack.longitude, attack.latitude]);
      return point && homePoint ? { ...attack, x: point[0], y: point[1], hx: homePoint[0], hy: homePoint[1] } : null;
    })
    .filter(Boolean);
  const activePaths = plotted.slice(0, MAX_SIGNAL_PATHS).map((attack) => ({
    ...attack,
    arcPath: createArcPath(attack)
  }));

  return (
    <div className="mapWrap">
      <svg viewBox="0 0 1120 590" role="img" aria-label="World map of CrowdSec alerts">
        <defs>
          <radialGradient id="pulse" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffcf6e" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#ff4d6d" stopOpacity="0.05" />
          </radialGradient>
        </defs>
        <path className="sphere" d={path({ type: "Sphere" })} />
        {countries.map((country) => (
          <path key={country.id} className="country" d={path(country)} />
        ))}
        {activePaths.map((attack) => (
          <path
            className={`arc ${getAgeClass(attack.createdAt)}`}
            key={`${attack.id}-arc`}
            d={attack.arcPath}
          />
        ))}
        {activePaths.map((attack, index) => (
          <circle className={`signalRunner ${getAgeClass(attack.createdAt)}`} r={Math.min(4.5, 2.4 + attack.count / 7)} key={`${attack.id}-runner`}>
            <animateMotion
              dur={`${getSignalDuration(attack.count, index)}s`}
              begin={`${(index % 7) * -0.55}s`}
              repeatCount="indefinite"
              path={attack.arcPath}
            />
          </circle>
        ))}
        <circle className="homeRing" cx={homePoint[0]} cy={homePoint[1]} r="11" />
        <circle className="homeDot" cx={homePoint[0]} cy={homePoint[1]} r="4" />
        {plotted.map((attack) => (
          <g className={`attackPoint ${getAgeClass(attack.createdAt)}`} key={attack.id}>
            <circle cx={attack.x} cy={attack.y} r={Math.min(22, 7 + attack.count)} fill="url(#pulse)" />
            <circle cx={attack.x} cy={attack.y} r={Math.min(9, 3 + attack.count / 2)} />
            <title>{`${attack.country} ${attack.sourceCount} source${attack.sourceCount === 1 ? "" : "s"} ${attack.scenario}`}</title>
          </g>
        ))}
      </svg>
    </div>
  );
}

function getAgeClass(createdAt) {
  const ageMinutes = (Date.now() - new Date(createdAt).getTime()) / 60000;

  if (!Number.isFinite(ageMinutes) || ageMinutes <= 15) {
    return "ageHot";
  }
  if (ageMinutes <= 60) {
    return "ageWarm";
  }
  return "ageOld";
}

function getSignalDuration(count, index) {
  const weightedCount = Math.max(1, Number(count || 1));
  const baseDuration = 8.2 - Math.min(4.2, Math.log2(weightedCount + 1) * 0.9);
  return Math.max(3.2, baseDuration + (index % 4) * 0.25).toFixed(2);
}

function compactMapAttacks(attacks) {
  const groups = new Map();

  for (const attack of attacks) {
    const latitude = Number(attack.latitude);
    const longitude = Number(attack.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      continue;
    }

    const key = [
      attack.country || "??",
      latitude.toFixed(1),
      longitude.toFixed(1),
      attack.scenario || "unknown"
    ].join("|");
    const existing = groups.get(key);

    if (existing) {
      existing.count += Number(attack.count || 1);
      existing.sourceCount += 1;
      if (new Date(attack.createdAt) > new Date(existing.createdAt)) {
        existing.createdAt = attack.createdAt;
      }
      continue;
    }

    groups.set(key, {
      ...attack,
      id: `map-${key}`,
      latitude,
      longitude,
      count: Number(attack.count || 1),
      sourceCount: 1
    });
  }

  return [...groups.values()].sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

function createArcPath(attack) {
  const lift = Math.max(48, Math.min(128, Math.abs(attack.x - attack.hx) * 0.12));
  return `M${attack.x},${attack.y} Q${(attack.x + attack.hx) / 2},${Math.min(attack.y, attack.hy) - lift} ${attack.hx},${attack.hy}`;
}

function Timeline({ attacks, error }) {
  const recent = [...attacks]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 9);

  return (
    <footer className="timeline">
      {error && <div className="warning">{error}</div>}
      {recent.map((attack) => (
        <article key={`${attack.id}-timeline`}>
          <span>{formatTime(attack.createdAt)}</span>
          <strong>{attack.country}</strong>
          <p>{attack.scenario}</p>
        </article>
      ))}
    </footer>
  );
}

function formatTime(value) {
  if (!value) {
    return "...";
  }
  return new Intl.DateTimeFormat("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

createRoot(document.getElementById("root")).render(<App />);
