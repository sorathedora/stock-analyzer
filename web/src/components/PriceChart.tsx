import { AreaSeries, ColorType, createChart, HistogramSeries, LineSeries, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CompanyFile } from "../data/company";
import { useTheme } from "../data/theme";

export const RANGES = { "1M": 31, "6M": 183, "1Y": 366, "3Y": 1096, "5Y": 1827, Max: 1e9 } as const;
export type Range = keyof typeof RANGES;

function css(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Simple moving average over the full series, so early points of a range are correct. */
function sma(values: number[], n: number) {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function PriceChart({ file, range, height = 300, showDma = true, showVolume = true }: {
  file: CompanyFile; range: Range; height?: number; showDma?: boolean; showVolume?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const [hover, setHover] = useState<{ date: string; close: number } | null>(null);
  const theme = useTheme();

  const series = useMemo(() => {
    const t = file.d.map((d) => (d * 86400) as UTCTimestamp);
    const start = file.d[file.d.length - 1] - RANGES[range];
    const from = Math.max(0, file.d.findIndex((d) => d >= start));
    const d50 = sma(file.c, 50), d200 = sma(file.c, 200);
    const pick = <T,>(arr: T[]) => arr.slice(from);
    return {
      close: pick(t.map((time, i) => ({ time, value: file.c[i] }))),
      vol: pick(t.map((time, i) => ({ time, value: file.v[i], color: i > 0 && file.c[i] < file.c[i - 1] ? "down" : "up" }))),
      d50: pick(t.map((time, i) => ({ time, value: d50[i] }))).filter((p) => p.value !== null) as { time: UTCTimestamp; value: number }[],
      d200: pick(t.map((time, i) => ({ time, value: d200[i] }))).filter((p) => p.value !== null) as { time: UTCTimestamp; value: number }[],
    };
  }, [file, range]);

  const change = series.close.length > 1 ? series.close[series.close.length - 1].value / series.close[0].value - 1 : 0;

  useEffect(() => {
    if (!box.current) return;
    const ink3 = css("--ink-3"), line = css("--line"), up = css("--up"), down = css("--down");
    const color = change >= 0 ? up : down;
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: ink3, fontFamily: "Inter, sans-serif", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: line } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { horzLine: { visible: false, labelVisible: false }, vertLine: { color: ink3, style: 3, labelBackgroundColor: css("--ink") } },
      handleScroll: false, handleScale: false,
    });
    const area = c.addSeries(AreaSeries, {
      lineColor: color, lineWidth: 2, topColor: `${color}33`, bottomColor: `${color}00`,
      priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 4,
    });
    area.setData(series.close);
    if (showDma) {
      const s50 = c.addSeries(LineSeries, { color: ink3, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, lineStyle: 2 });
      s50.setData(series.d50);
      const s200 = c.addSeries(LineSeries, { color: css("--ink-2"), lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s200.setData(series.d200);
    }
    if (showVolume) {
      const vol = c.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(series.vol.map((p) => ({ ...p, color: `${p.color === "up" ? up : down}55` })));
    }
    area.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: showVolume ? 0.22 : 0.05 } });
    c.timeScale().fitContent();
    c.subscribeCrosshairMove((p) => {
      const v = p.seriesData.get(area) as { value: number } | undefined;
      if (!p.time || !v) { setHover(null); return; }
      setHover({ date: new Date((p.time as number) * 1000).toISOString().slice(0, 10), close: v.value });
    });
    chart.current = c;
    return () => { c.remove(); chart.current = null; };
  }, [series, height, showDma, showVolume, change, theme]);

  return (
    <div style={{ position: "relative" }}>
      <div className="muted num" style={{ fontSize: 12, height: 18 }}>
        {hover
          ? <>{hover.date} · ₹{hover.close.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</>
          : <><span className={change >= 0 ? "up" : "down"}>{change >= 0 ? "+" : "−"}{Math.abs(change * 100).toFixed(1)}%</span> over {range === "Max" ? "all data" : range}{showDma ? " · dashed 50-day, solid 200-day average" : ""}</>}
      </div>
      <div ref={box} style={{ height, width: "100%", minWidth: 0 }} />
    </div>
  );
}
