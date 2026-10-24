// DevicesView (add-desktop-fleet-runner ③): the desktop seat management panel
// — list this identity's paired seats with live board presence, mint a
// pairing code for a new seat, revoke a seat (its uplink token dies on the
// very next ingest). The seat itself redeems the code in the desktop app's
// Wanxing Fleet preferences; this side never sees the token.
import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../../auth.js";

function seatState(board) {
  if (!board) return { label: "未见上报", tone: "text-slate-400" };
  const ageMin = Math.max(0, Math.round((Date.now() - board.seen_at) / 60_000));
  if (ageMin <= 2) return { label: `在线（${ageMin} 分钟前）`, tone: "text-emerald-600 dark:text-emerald-400" };
  return { label: `离线（${ageMin} 分钟前在线）`, tone: "text-slate-400" };
}

export function DevicesView() {
  const [devices, setDevices] = useState(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState(null); // { code, expiresInSec, mintedAt }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await authFetch("/api/wanxing/v1/console/devices");
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      setDevices((await r.json()).devices ?? []);
      setError("");
    } catch (e) {
      setError(String(e?.message || e));
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const mint = async () => {
    setBusy(true);
    try {
      const r = await authFetch("/api/wanxing/v1/console/devices/code", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setCode({ ...d, mintedAt: Date.now() });
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (runnerId) => {
    if (!window.confirm(`吊销机位 ${runnerId}？其上行凭据立即失效，机位条目保持等待（不会被重派）。`)) return;
    setBusy(true);
    try {
      const r = await authFetch(`/api/wanxing/v1/console/devices/${encodeURIComponent(runnerId)}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const codeAgeSec = code ? Math.round((Date.now() - code.mintedAt) / 1000) : 0;
  const codeLive = code && codeAgeSec <= code.expiresInSec;

  return (
    <div className="space-y-4" data-testid="devices-panel">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold">桌面机位</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            配对後的桌面可承接部署（部署目标选机位）、上报舰队遥测；吊销即时断链。
          </p>
        </div>
        <button
          onClick={() => void mint()}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded-full bg-accent text-white"
          data-testid="devices-mint"
        >
          生成配对码
        </button>
      </div>

      {codeLive && (
        <div className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-3 flex items-center gap-4" data-testid="devices-code">
          <span className="font-mono text-2xl tracking-[0.3em]" data-testid="devices-code-value">{code.code}</span>
          <span className="text-xs text-slate-500">剩 {Math.max(0, code.expiresInSec - codeAgeSec)} 秒 · 单次有效</span>
          <span className="text-xs text-slate-400 ml-auto">在桌面 app 偏好设置 → Wanxing Fleet 输入此码</span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {devices === null ? (
        <div className="text-sm text-slate-400 py-8 text-center">读取中…</div>
      ) : devices.length === 0 ? (
        <div className="text-sm text-slate-400 py-8 text-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700" data-testid="devices-empty">
          尚无配对的桌面机位——生成配对码，在桌面 app 的萬星舰队设置里输入即可连接。
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800" data-testid="devices-list">
          {devices.map((d) => {
            const st = seatState(d.board);
            return (
              <div key={d.runnerId} className="flex items-center gap-3 px-4 py-3" data-testid="device-row">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{d.name || d.runnerId}</span>
                    <span className="text-[11px] font-mono text-slate-400 truncate">{d.runnerId}</span>
                    {d.board?.desktop ? (
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300">桌面</span>
                    ) : null}
                  </div>
                  <div className={`text-xs mt-0.5 ${st.tone}`} data-testid="device-state">
                    {st.label}
                    {d.board?.agents != null ? ` · ${d.board.agents} agents` : ""}
                  </div>
                </div>
                <button
                  onClick={() => void revoke(d.runnerId)}
                  disabled={busy}
                  className="text-xs px-2.5 py-1 rounded-full border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                  data-testid="device-revoke"
                >
                  吊销
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
