# Copyright (c) 2026 Taher AkbariSaeed
"""Speed Matrix engine.

Tests the upload/download/latency of every config across every DNS
resolver/transport scenario, then ranks them and exposes the best
settings (with the original config string ready for QR generation).

The orchestrator combines two existing real probes:

* `scanner.test_config` — boots Xray and proxies traffic through the config
  to measure real ping/jitter/download/upload.  Each unique config string is
  measured ONCE (it does not depend on the DNS resolver because the proxy
  connects to the server by IP directly).

* `dns_scanner_engine.e2e_test_resolver` — runs DNS+HTTP through each
  resolver/transport combination to validate that the resolver can reach
  the config's host and is not poisoned/blocked.

The combined score for one (config × resolver × transport) row is:

    score = dns_score(0..6) + speed_score(0..6)

so that 12 is a perfect run.  Results are sorted desc by score, then by
total latency.
"""

from __future__ import annotations

import asyncio
import base64
import threading
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

try:
    from scanner import parse_config, test_config  # type: ignore
except Exception:  # pragma: no cover
    parse_config = None  # type: ignore
    test_config = None  # type: ignore

try:
    import dns_scanner_engine  # type: ignore
except Exception:  # pragma: no cover
    dns_scanner_engine = None  # type: ignore


_TRANSPORTS = ("udp", "tcp", "tls", "https")

# DNS-tunnel throughput model: an MTU-sized packet per RTT.  Empirically a
# real SlipNet/dnstt session can sustain ~60% of the raw single-stream
# estimate for download and ~40% for upload (TXT replies are larger than the
# A/CNAME queries used to push uplink data).
_SLIPNET_DL_FACTOR = 0.60
_SLIPNET_UL_FACTOR = 0.40
_SLIPNET_MTU_BITS = 1232 * 8


def _b64pad(s: str) -> str:
    return s + "=" * (-len(s) % 4)


def _decode_slipnet(raw: str) -> Optional[Dict[str, Any]]:
    """Decode a slipnet:// URI into its pipe-delimited fields.

    Layout used by `dns_scanner_engine.generate_config` and the SlipNet app:
        [0] version ("18")
        [1] tunnel type (dnstt/sayedns/vaydns/ss)
        [2] profile name
        [3] domain
        [4] resolver  ->  "<ip>:<port>:0"
        [11] pubkey (optional)
    """
    if not raw:
        return None
    s = raw.strip()
    if not s.lower().startswith("slipnet://"):
        return None
    payload = s.split("://", 1)[1].split("#", 1)[0].split("?", 1)[0].strip()
    try:
        decoded = base64.b64decode(_b64pad(payload)).decode("utf-8", "ignore")
    except Exception:
        return None
    fields = decoded.split("|")
    info: Dict[str, Any] = {
        "fields": fields,
        "tunnel": fields[1] if len(fields) > 1 else "",
        "name": fields[2] if len(fields) > 2 else "",
        "domain": fields[3] if len(fields) > 3 else "",
        "resolver_ip": None,
        "resolver_port": 53,
        "pubkey": fields[11] if len(fields) > 11 else "",
    }
    if len(fields) > 4 and fields[4]:
        parts = fields[4].split(":")
        info["resolver_ip"] = parts[0] or None
        if len(parts) > 1 and parts[1].isdigit():
            info["resolver_port"] = int(parts[1])
    return info


def _encode_slipnet(info: Dict[str, Any], resolver_ip: str, resolver_port: int = 53) -> str:
    """Re-encode a decoded slipnet payload with an overridden resolver field."""
    fields = list(info.get("fields") or [])
    while len(fields) < 5:
        fields.append("")
    fields[4] = f"{resolver_ip}:{resolver_port}:0"
    while fields and fields[-1] == "":
        fields.pop()
    blob = base64.b64encode("|".join(fields).encode()).decode()
    return f"slipnet://{blob}"


def _is_slipnet(raw: str) -> bool:
    return bool(raw) and raw.strip().lower().startswith("slipnet://")


def _label_config(raw: str, idx: int) -> str:
    s = (raw or "").strip()
    if not s:
        return f"config-{idx + 1}"
    # Use the URL fragment (#name) when present, else host.
    try:
        if "#" in s:
            return s.split("#", 1)[1][:40]
        if "://" in s:
            u = urlparse(s)
            if u.hostname:
                return u.hostname
    except Exception:
        pass
    return f"config-{idx + 1}"


def _extract_host(raw: str) -> Optional[str]:
    """Best-effort host extraction from a proxy URL/config."""
    if not raw:
        return None
    s = raw.strip()
    try:
        if s.lower().startswith("vmess://"):
            import base64, json
            payload = s.split("://", 1)[1].split("#", 1)[0].split("?", 1)[0]
            pad = "=" * (-len(payload) % 4)
            data = json.loads(base64.b64decode(payload + pad).decode("utf-8", "ignore"))
            return data.get("add") or data.get("host")
        if "://" in s:
            u = urlparse(s)
            if u.hostname:
                return u.hostname
    except Exception:
        pass
    return None


def _speed_score(metrics: Dict[str, Any]) -> int:
    """Map measured throughput/latency to a 0..6 score."""
    if not metrics:
        return 0
    score = 1  # config booted
    ping = metrics.get("ping") or metrics.get("latency") or 9999
    jitter = metrics.get("jitter") or 0
    dl = metrics.get("download") or metrics.get("download_mbps") or 0
    ul = metrics.get("upload") or metrics.get("upload_mbps") or 0
    try:
        if ping and ping < 800:
            score += 1
        if ping and ping < 300:
            score += 1
        if jitter is not None and jitter < 200:
            score += 1
        if dl and dl > 1.0:
            score += 1
        if ul and ul > 0.5:
            score += 1
    except Exception:
        pass
    return min(score, 6)


def _build_qr_payload(
    raw_config: str,
    resolver: str,
    transport: str,
    slipnet_info: Optional[Dict[str, Any]] = None,
) -> str:
    """For slipnet:// configs, re-encode the URI with the recommended resolver
    so the QR is directly importable by the SlipNet app.  For other proxy URLs
    we just append a #dns hint for clients that understand it."""
    base = (raw_config or "").strip()
    if not base:
        return ""
    if slipnet_info:
        port = slipnet_info.get("resolver_port") or 53
        return _encode_slipnet(slipnet_info, resolver, port)
    hint = f"dns={resolver}|t={transport}"
    if "#" in base:
        return base + "%20" + hint.replace(" ", "%20")
    return base + "#" + hint.replace(" ", "%20")


class _MatrixState:
    def __init__(self, scan_id: str, total: int):
        self.lock = threading.Lock()
        self.scan_id = scan_id
        self.status = "running"
        self.total = max(total, 1)
        self.completed = 0
        self.cancelled = False
        self.label = ""
        self.results: List[Dict[str, Any]] = []
        self.config_metrics: Dict[str, Dict[str, Any]] = {}
        self.started_at = time.time()

    def add(self, row: Dict[str, Any]):
        with self.lock:
            self.results.append(row)
            self.completed += 1

    def to_dict(self) -> Dict[str, Any]:
        with self.lock:
            ranked = sorted(
                self.results,
                key=lambda r: (-(r.get("score") or 0), (r.get("total_latency_ms") or 99999)),
            )
            best = ranked[0] if ranked else None
            top = ranked[:10]
            elapsed = time.time() - self.started_at
            return {
                "scan_id": self.scan_id,
                "status": self.status,
                "total": self.total,
                "completed": self.completed,
                "progress": round(min(self.completed / self.total, 1.0) * 100, 1),
                "label": self.label,
                "elapsed_sec": round(elapsed, 1),
                "results": ranked,
                "top": top,
                "best": best,
                "config_metrics": self.config_metrics,
            }


_scans: Dict[str, _MatrixState] = {}


def _run_async(coro):
    """Run a coroutine on a fresh event loop (for the worker thread)."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _measure_config(raw_config: str) -> Dict[str, Any]:
    """Boot Xray and measure the config once. Returns metrics dict (may be empty)."""
    if not parse_config or not test_config:
        return {"ok": False, "message": "scanner module not available", "metrics": {}}
    try:
        parts = parse_config(raw_config)
    except Exception as e:
        return {"ok": False, "message": f"parse failed: {e}", "metrics": {}}
    try:
        ok, message, metrics = _run_async(test_config(parts))
        return {"ok": bool(ok), "message": message or "", "metrics": metrics or {}}
    except Exception as e:
        return {"ok": False, "message": f"test_config failed: {e}", "metrics": {}}


def _probe_slipnet_scenario(
    info: Dict[str, Any],
    resolver: str,
    transport: str,
    target_url: str,
    timeout_ms: int,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Run a SlipNet-style DNS probe.

    Because we cannot boot the SlipNet client locally we approximate the
    achievable speed using the well-known DNS-tunnel formula:

        throughput ≈ MTU / RTT

    plus an empirical efficiency factor.  We also run the standard
    `e2e_test_resolver` so the row keeps the same dns_ok/http_ok/poison
    signals other configs report.
    """
    domain = (info.get("domain") or "example.com").strip() or "example.com"
    metrics: Dict[str, Any] = {}
    e2e: Dict[str, Any] = {}
    if dns_scanner_engine is None:
        return metrics, e2e

    # Multi-round resolver test → latency, jitter, throughput estimate.
    try:
        probe = dns_scanner_engine._test_resolver(  # type: ignore[attr-defined]
            resolver, domain, timeout_ms=timeout_ms, rounds=5, protocol=transport,
        ) or {}
    except Exception as e:
        probe = {"error": str(e)}

    avg = probe.get("latency_ms")
    jit = probe.get("jitter")
    raw_tput = probe.get("throughput_est")  # Mbps
    if raw_tput is None and avg:
        try:
            raw_tput = round(min((_SLIPNET_MTU_BITS / (float(avg) / 1000.0)) / 1_000_000, 10.0), 2)
        except Exception:
            raw_tput = None
    if raw_tput:
        metrics["download"] = round(raw_tput * _SLIPNET_DL_FACTOR, 2)
        metrics["upload"] = round(raw_tput * _SLIPNET_UL_FACTOR, 2)
        metrics["throughput_raw_mbps"] = raw_tput
    if avg is not None:
        metrics["ping"] = avg
    if jit is not None:
        metrics["jitter"] = jit
    metrics["estimated"] = True

    # E2E reachability through the resolver (against a tunnel-relevant host).
    try:
        e2e = dns_scanner_engine.e2e_test_resolver(
            resolver, domain, target_url, timeout_ms, transport,
        ) or {}
    except Exception as e:
        e2e = {"error": str(e), "dns_ok": False, "http_ok": False}
    return metrics, e2e


def _scenarios(resolvers: List[str], transports: List[str]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    for r in resolvers:
        for t in transports:
            out.append({"resolver": r, "transport": t})
    return out


def start_matrix_scan(
    configs: List[str],
    resolvers: List[str],
    transports: Optional[List[str]] = None,
    target_url: str = "https://www.cloudflare.com/cdn-cgi/trace",
    timeout_ms: int = 6000,
) -> Dict[str, Any]:
    configs = [c.strip() for c in (configs or []) if c and c.strip()]
    resolvers = [r.strip() for r in (resolvers or []) if r and r.strip()]
    transports = [t.strip().lower() for t in (transports or _TRANSPORTS) if t]
    transports = [t for t in transports if t in _TRANSPORTS] or list(_TRANSPORTS)

    if not configs:
        return {"error": "No configs provided"}
    if not resolvers:
        return {"error": "No DNS resolvers selected"}

    total = len(configs) * len(resolvers) * len(transports)
    scan_id = uuid.uuid4().hex[:12]
    state = _MatrixState(scan_id, total)
    _scans[scan_id] = state

    def worker():
        try:
            for c_idx, raw in enumerate(configs):
                if state.cancelled:
                    break
                label = _label_config(raw, c_idx)
                slip_info = _decode_slipnet(raw)
                kind = "slipnet" if slip_info else "proxy"

                # For Xray-driven proxies we boot ONCE; for slipnet:// configs
                # there is no Xray boot — the speed depends entirely on the
                # chosen resolver, so we measure per-scenario.
                if slip_info:
                    state.label = f"Decoding slipnet config {c_idx + 1}/{len(configs)} ({label})"
                    cfg_meas = {
                        "ok": True,
                        "message": f"slipnet://{slip_info.get('tunnel') or 'dnstt'} (per-resolver speed)",
                        "metrics": {},
                        "kind": "slipnet",
                        "slipnet": slip_info,
                    }
                else:
                    state.label = f"Booting config {c_idx + 1}/{len(configs)} ({label})"
                    cfg_meas = _measure_config(raw)
                    cfg_meas["kind"] = "proxy"
                state.config_metrics[label] = cfg_meas
                base_metrics = cfg_meas.get("metrics") or {}
                base_speed_score = _speed_score(base_metrics) if not slip_info else 0
                host = _extract_host(raw) or (slip_info.get("domain") if slip_info else None) or "cloudflare.com"

                for sc in _scenarios(resolvers, transports):
                    if state.cancelled:
                        break
                    resolver = sc["resolver"]
                    transport = sc["transport"]
                    state.label = f"Testing {label} via {resolver}/{transport.upper()}"

                    if slip_info:
                        per_metrics, dns_row = _probe_slipnet_scenario(
                            slip_info, resolver, transport, target_url, timeout_ms,
                        )
                        cfg_metrics = per_metrics
                        speed_score = _speed_score(per_metrics)
                    else:
                        cfg_metrics = base_metrics
                        speed_score = base_speed_score
                        dns_row = {}
                        if dns_scanner_engine is not None:
                            try:
                                dns_row = dns_scanner_engine.e2e_test_resolver(
                                    resolver, host, target_url, timeout_ms, transport
                                ) or {}
                            except Exception as e:
                                dns_row = {"error": str(e), "dns_ok": False, "http_ok": False}

                    dns_score = 0
                    if dns_row.get("dns_ok"):
                        dns_score += 2
                    if dns_row.get("http_ok"):
                        dns_score += 2
                    if not dns_row.get("poisoned"):
                        dns_score += 1
                    lat = dns_row.get("total_latency_ms") or dns_row.get("dns_latency_ms")
                    if lat and lat < 600:
                        dns_score += 1
                    dns_score = min(dns_score, 6)

                    combined = dns_score + speed_score
                    state.add({
                        "config_label": label,
                        "config": raw,
                        "kind": kind,
                        "estimated": bool(cfg_metrics.get("estimated")),
                        "resolver": resolver,
                        "transport": transport,
                        "dns_score": dns_score,
                        "speed_score": speed_score,
                        "score": combined,
                        "config_ok": cfg_meas.get("ok", False),
                        "config_message": cfg_meas.get("message", ""),
                        "ping_ms": cfg_metrics.get("ping"),
                        "jitter_ms": cfg_metrics.get("jitter"),
                        "download_mbps": cfg_metrics.get("download") or cfg_metrics.get("download_mbps"),
                        "upload_mbps": cfg_metrics.get("upload") or cfg_metrics.get("upload_mbps"),
                        "throughput_raw_mbps": cfg_metrics.get("throughput_raw_mbps"),
                        "dns_ok": bool(dns_row.get("dns_ok")),
                        "http_ok": bool(dns_row.get("http_ok")),
                        "poisoned": bool(dns_row.get("poisoned")),
                        "dns_latency_ms": dns_row.get("dns_latency_ms"),
                        "http_latency_ms": dns_row.get("http_latency_ms"),
                        "total_latency_ms": dns_row.get("total_latency_ms"),
                        "resolved_ips": dns_row.get("resolved_ips") or [],
                        "error": dns_row.get("error"),
                        "qr_payload": _build_qr_payload(raw, resolver, transport, slip_info),
                    })
        finally:
            with state.lock:
                state.status = "cancelled" if state.cancelled else "completed"
                state.label = "Done"



    threading.Thread(target=worker, daemon=True).start()
    return {"scan_id": scan_id, "total": total}


def get_matrix_status(scan_id: str) -> Dict[str, Any]:
    state = _scans.get(scan_id)
    if not state:
        return {"error": "scan not found"}
    return state.to_dict()


def stop_matrix_scan(scan_id: str) -> Dict[str, Any]:
    state = _scans.get(scan_id)
    if not state:
        return {"error": "scan not found"}
    state.cancelled = True
    return {"ok": True, "scan_id": scan_id}
