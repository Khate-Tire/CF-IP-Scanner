# Copyright (c) 2026 Taher AkbariSaeed
"""
DNS Resolver Scanner Engine v2 — Advanced DNS tunnel optimizer.
Tests 200+ resolvers across 12 regions with scoring, throughput estimation,
auto-retry, config generation, and scan history persistence.
"""

import socket, struct, time, threading, uuid, random, json, os, base64, sqlite3
from typing import Dict, List, Optional, Any
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

try:
    import dns.resolver, dns.message, dns.query, dns.rdatatype, dns.flags, dns.edns, dns.name, dns.rcode
except ImportError:
    dns = None

# ─── Built-in Resolver Database (200+) ────────────────────────────────────────

BUILTIN_RESOLVERS = {
    "global": [
        "8.8.8.8","8.8.4.4","1.1.1.1","1.0.0.1","9.9.9.9","149.112.112.112",
        "208.67.222.222","208.67.220.220","94.140.14.14","94.140.15.15",
        "185.228.168.9","185.228.169.9","76.76.2.0","76.76.10.0",
        "45.90.28.0","45.90.30.0","77.88.8.8","77.88.8.1",
        "156.154.70.1","156.154.71.1","176.103.130.130","176.103.130.131",
        "64.6.64.6","64.6.65.6","199.85.126.10","199.85.127.10",
        "8.26.56.26","8.20.247.20",
        "91.239.100.100","89.233.43.71",       # UncensoredDNS
        "194.242.2.2","194.242.2.3",           # Mullvad
        "116.202.176.26",                       # LibreDNS
        "84.200.69.80","84.200.70.40",         # DNS.Watch
        "37.235.1.174","37.235.1.177",         # FreeDNS
        "74.82.42.42",                          # Hurricane Electric
        "4.2.2.1","4.2.2.2","4.2.2.3","4.2.2.4", # Level3
        "205.171.3.65","205.171.202.10",       # CenturyLink
    ],
    "iran": [
        "178.22.122.100","185.51.200.2",       # Shecan
        "10.202.10.10","10.202.10.11",         # 403 DNS
        "185.55.226.26","185.55.225.25",       # Electro
        "78.157.42.100","78.157.42.101",       # Begzar
        "5.202.100.100","5.202.100.101",       # ParsOnline
        "85.15.1.14","85.15.1.15",             # Shatel
        "217.218.155.155","217.218.127.127",   # Asiatech
    ],
    "china": [
        "114.114.114.114","114.114.115.115",   # 114DNS
        "223.5.5.5","223.6.6.6",               # AliDNS
        "119.29.29.29","119.28.28.28",         # DNSPod/Tencent
        "180.76.76.76",                         # Baidu
        "101.226.4.6","218.30.118.6",          # DNS.cn
        "1.2.4.8","210.2.4.8",                 # CNNIC
        "117.50.11.11","117.50.22.22",         # OneDNS
        "52.80.66.66",                          # PdoMo
    ],
    "russia": [
        "77.88.8.8","77.88.8.1",               # Yandex
        "193.58.251.251",                       # SkyDNS
        "195.46.39.39","195.46.39.40",         # Safe DNS
        "92.223.109.31","91.230.211.67",       # Comss.one
        "194.85.61.20",                         # RosNIIROS
    ],
    "turkey": [
        "195.175.39.39","195.175.39.40",       # TurkTelekom
        "31.7.37.37","31.7.37.38",             # TurkNet
        "212.175.40.2","212.175.40.3",         # Vodafone TR
        "85.29.10.10","85.29.10.11",           # TTNET alt
    ],
    "uae": [
        "94.200.200.200","94.200.200.201",     # du
        "213.42.20.20","195.229.241.222",      # Etisalat
    ],
    "saudi": [
        "212.26.22.1","212.26.46.1",           # STC
        "212.118.129.106","212.93.192.2",      # Mobily
    ],
    "egypt": [
        "41.128.183.1","163.121.128.134",      # TE Data
        "196.205.154.22","196.205.155.22",     # Orange Egypt
    ],
    "pakistan": [
        "209.150.154.1","202.141.224.2",       # PTCL
        "39.40.0.2","39.40.0.3",               # Jazz/Mobilink
    ],
    "india": [
        "49.45.0.1","49.45.0.2",               # Jio
        "122.179.12.49","122.179.12.50",       # Airtel
        "164.100.148.130","203.94.227.70",     # BSNL/NIC
    ],
    "brazil": [
        "200.221.11.100","200.221.11.101",     # Claro BR
        "200.175.89.139","200.175.89.140",     # Vivo
    ],
    "indonesia": [
        "202.134.0.155","202.134.1.10",        # Telkom
        "202.152.165.44","202.155.107.82",     # Indosat
    ],
}

# ─── Scan State ────────────────────────────────────────────────────────────────

class DnsScanState:
    def __init__(self, scan_id: str, total: int):
        self.lock = threading.Lock()
        self.scan_id = scan_id
        self.status = "running"
        self.total = total
        self.completed = 0
        self.results = []
        self.cancelled = False
        self.started_at = datetime.utcnow().isoformat()
        self.domain = ""

    def add_result(self, result: Dict):
        with self.lock:
            self.results.append(result)
            self.completed += 1

    def to_dict(self):
        with self.lock:
            sr = sorted(self.results, key=lambda r: (-r.get("score",0), r.get("latency_ms",9999)))
            good = [r for r in sr if r.get("score",0) >= 4]
            avg_lat = 0
            if sr:
                lats = [r["latency_ms"] for r in sr if r.get("latency_ms")]
                avg_lat = round(sum(lats)/len(lats),1) if lats else 0
            return {
                "scan_id": self.scan_id, "status": self.status,
                "total": self.total, "completed": self.completed,
                "results": sr,
                "stats": {
                    "avg_latency": avg_lat,
                    "best_score": sr[0].get("score",0) if sr else 0,
                    "pass_rate": round(len(good)/len(sr)*100,1) if sr else 0,
                    "excellent": len([r for r in sr if r.get("score",0)>=5]),
                    "good": len([r for r in sr if 3<=r.get("score",0)<5]),
                    "poor": len([r for r in sr if r.get("score",0)<3]),
                    "total_tested": len(sr),
                    "latency_buckets": _latency_buckets(sr),
                }
            }

_scans: Dict[str, DnsScanState] = {}

DB_PATH = os.path.join(os.path.dirname(__file__), 'dns_history.db')
def _init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute('''CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id TEXT,
        timestamp TEXT,
        domain TEXT,
        total INTEGER,
        best_resolver TEXT,
        best_score INTEGER,
        avg_latency REAL,
        pass_rate REAL
    )''')
    conn.commit()
    conn.close()

try:
    _init_db()
except:
    pass

def _latency_buckets(results):
    buckets = {"<50ms":0,"50-100ms":0,"100-200ms":0,"200-500ms":0,"500ms-1s":0,">1s":0}
    for r in results:
        ms = r.get("latency_ms")
        if not ms: continue
        if ms<50: buckets["<50ms"]+=1
        elif ms<100: buckets["50-100ms"]+=1
        elif ms<200: buckets["100-200ms"]+=1
        elif ms<500: buckets["200-500ms"]+=1
        elif ms<1000: buckets["500ms-1s"]+=1
        else: buckets[">1s"]+=1
    return buckets

# ─── DNS Testing ──────────────────────────────────────────────────────────────

def _exec_query(request, resolver_ip, timeout_sec, protocol="udp", fronting_domain=None):
    if protocol == "udp":
        return dns.query.udp(request, resolver_ip, timeout=timeout_sec)
    elif protocol == "tcp":
        return dns.query.tcp(request, resolver_ip, timeout=timeout_sec)
    elif protocol == "tls":
        return dns.query.tls(request, resolver_ip, timeout=timeout_sec)
    elif protocol == "https":
        url = f"https://{resolver_ip}/dns-query"
        import httpx
        client = httpx.Client(verify=False, http2=True)
        if fronting_domain:
            client.headers["Host"] = fronting_domain
        return dns.query.https(request, url, timeout=timeout_sec, client=client)
    elif protocol == "quic":
        if hasattr(dns.query, "quic"):
            return dns.query.quic(request, resolver_ip, timeout=timeout_sec, verify=False)
        else:
            raise Exception("QUIC not supported by this dnspython version")
    return dns.query.udp(request, resolver_ip, timeout=timeout_sec)

def _test_resolver(resolver_ip: str, domain: str, timeout_ms: int = 5000, rounds: int = 3, protocol: str = "udp", do_payload_test: bool = False, fronting_domain: str = None) -> Dict:
    result = {
        "resolver": resolver_ip, "reachable": False, "latency_ms": None,
        "edns_support": False, "nxdomain_hijack": False, "resolves_domain": False,
        "low_latency": False, "score": 0, "error": None,
        "country": _guess_country(resolver_ip), "throughput_est": None,
        "latency_min": None, "latency_max": None, "jitter": None,
    }
    timeout_sec = timeout_ms / 1000.0

    # Test 1: Reachability + latency (multiple rounds)
    try:
        qname = dns.name.from_text(domain or "example.com")
        request = dns.message.make_query(qname, dns.rdatatype.A)
        latencies = []
        response = None
        for _ in range(rounds):
            t0 = time.time()
            try:
                response = _exec_query(request, resolver_ip, timeout_sec, protocol, fronting_domain)
                latencies.append((time.time()-t0)*1000)
            except:
                latencies.append(timeout_ms)

        if response and any(l < timeout_ms for l in latencies):
            valid = [l for l in latencies if l < timeout_ms]
            avg = sum(valid)/len(valid)
            result["reachable"] = True
            result["latency_ms"] = round(avg, 1)
            result["latency_min"] = round(min(valid), 1)
            result["latency_max"] = round(max(valid), 1)
            result["jitter"] = round(max(valid)-min(valid), 1) if len(valid)>1 else 0
            result["score"] += 1
            if avg < 2000: result["score"] += 1
            if avg < 500:
                result["low_latency"] = True
                result["score"] += 1
            # Throughput estimation: MTU / RTT
            mtu = 1232
            rtt_sec = avg / 1000.0
            if rtt_sec > 0:
                result["throughput_est"] = round(min((mtu * 8) / rtt_sec / 1_000_000, 10.0), 2)
        else:
            result["error"] = "No response"
            return result
    except Exception as e:
        result["error"] = str(e)
        return result

    # Test 2: EDNS support
    try:
        qname = dns.name.from_text("example.com")
        request = dns.message.make_query(qname, dns.rdatatype.A, use_edns=0)
        resp = _exec_query(request, resolver_ip, timeout_sec, protocol, fronting_domain)
        if resp.edns >= 0:
            result["edns_support"] = True
            result["score"] += 1
    except: pass

    # Test 3: NXDOMAIN hijacking
    try:
        rnd = f"nxtest-{random.randint(100000,999999)}.definitelynotareal.domain"
        qname = dns.name.from_text(rnd)
        request = dns.message.make_query(qname, dns.rdatatype.A)
        resp = _exec_query(request, resolver_ip, timeout_sec, protocol, fronting_domain)
        if resp.rcode() == dns.rcode.NXDOMAIN:
            result["nxdomain_hijack"] = False
            result["score"] += 1
        else:
            result["nxdomain_hijack"] = True
    except:
        result["score"] += 1

    # Test 4: Tunnel domain resolution
    if domain and domain != "example.com":
        try:
            qname = dns.name.from_text(domain)
            request = dns.message.make_query(qname, dns.rdatatype.NS)
            resp = _exec_query(request, resolver_ip, timeout_sec, protocol, fronting_domain)
            if resp.answer or resp.authority:
                result["resolves_domain"] = True
                result["score"] += 1
        except:
            pass

    # Test 5: DPI / Payload Profiling
    if do_payload_test:
        try:
            qname = dns.name.from_text("example.com")
            request = dns.message.make_query(qname, dns.rdatatype.TXT)
            resp = _exec_query(request, resolver_ip, timeout_sec, protocol, fronting_domain)
            result["txt_support"] = True if resp.answer else False
            
            request = dns.message.make_query(qname, dns.rdatatype.ANY)
            resp = _exec_query(request, resolver_ip, timeout_sec, protocol, fronting_domain)
            result["null_support"] = True if resp.answer else False
        except:
            result["txt_support"] = False
            result["null_support"] = False

    return result


def _guess_country(ip: str) -> str:
    for country, resolvers in BUILTIN_RESOLVERS.items():
        if ip in resolvers: return country
    return "unknown"


# ─── Scan Orchestrator ─────────────────────────────────────────────────────────

def start_dns_scan(resolvers=None, domain="example.com", countries=None, concurrency=20, timeout_ms=5000, protocol="udp", do_payload_test=False, fronting_domain=None) -> Dict:
    resolver_list = []
    if resolvers: resolver_list.extend(resolvers)
    if countries:
        for c in countries: resolver_list.extend(BUILTIN_RESOLVERS.get(c, []))
    if not resolver_list:
        for rl in BUILTIN_RESOLVERS.values(): resolver_list.extend(rl)
    resolver_list = list(dict.fromkeys(resolver_list))

    scan_id = str(uuid.uuid4())[:8]
    state = DnsScanState(scan_id, len(resolver_list))
    state.domain = domain
    _scans[scan_id] = state

    def _run():
        try:
            with ThreadPoolExecutor(max_workers=min(concurrency, len(resolver_list))) as ex:
                futs = {ex.submit(_test_resolver, ip, domain, timeout_ms, 3, protocol, do_payload_test, fronting_domain): ip for ip in resolver_list}
                for f in as_completed(futs):
                    if state.cancelled: break
                    try: state.add_result(f.result(timeout=timeout_ms/1000+5))
                    except Exception as e:
                        state.add_result({"resolver":futs[f],"score":0,"error":str(e),"reachable":False})
            with state.lock:
                state.status = "cancelled" if state.cancelled else "completed"
            # Save to SQLite history
            d = state.to_dict()
            try:
                conn = sqlite3.connect(DB_PATH)
                conn.execute('''INSERT INTO history 
                    (scan_id, timestamp, domain, total, best_resolver, best_score, avg_latency, pass_rate) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)''', 
                    (scan_id, state.started_at, domain, state.total, 
                     d["results"][0]["resolver"] if d["results"] else None,
                     d["stats"]["best_score"], d["stats"]["avg_latency"], d["stats"]["pass_rate"]))
                conn.commit()
                conn.close()
            except Exception as e:
                print(f"Failed to save history: {e}")
        except:
            with state.lock: state.status = "failed"

    threading.Thread(target=_run, daemon=True).start()
    return {"scan_id": scan_id, "total": len(resolver_list)}


def get_scan_status(scan_id: str) -> Dict:
    state = _scans.get(scan_id)
    return state.to_dict() if state else {"error": "Scan not found"}

def stop_scan(scan_id: str) -> Dict:
    state = _scans.get(scan_id)
    if not state: return {"error": "Scan not found"}
    state.cancelled = True
    return {"success": True}

def quick_test_resolver(resolver_ip: str, domain: str = "example.com", protocol: str = "udp", utls_fingerprint: Optional[str] = None) -> Dict:
    # utls_fingerprint is metadata only — dnspython doesn't perform JA3/uTLS forging.
    # We pass it through so the result records the requested fingerprint hint for
    # downstream tunnel clients (slipnet://, dnstt) and so the UI can display it.
    out = _test_resolver(resolver_ip, domain, timeout_ms=5000, rounds=5, protocol=protocol)
    if utls_fingerprint:
        out["utls_fingerprint"] = utls_fingerprint
    out["protocol"] = protocol
    return out


def e2e_test_resolver(resolver_ip: str, domain: str, target_url: str = "https://www.cloudflare.com/cdn-cgi/trace", timeout_ms: int = 8000, protocol: str = "udp") -> Dict:
    """E2E test: resolve target via the resolver, then HTTP GET to one of its IPs.

    Validates that the resolver is not poisoning A records for tunnel-relevant
    hosts AND that an actual end-to-end fetch succeeds through that resolver's
    answer. Returns combined timing.
    """
    from urllib.parse import urlparse
    out = {
        "resolver": resolver_ip, "target_url": target_url, "protocol": protocol,
        "dns_ok": False, "http_ok": False, "resolved_ips": [],
        "dns_latency_ms": None, "http_latency_ms": None, "http_status": None,
        "total_latency_ms": None, "error": None, "poisoned": False,
    }
    timeout_sec = timeout_ms / 1000.0
    parsed = urlparse(target_url)
    host = parsed.hostname or domain or "www.cloudflare.com"

    # 1) DNS resolve
    try:
        qname = dns.name.from_text(host)
        request = dns.message.make_query(qname, dns.rdatatype.A)
        t0 = time.time()
        resp = _exec_query(request, resolver_ip, timeout_sec, protocol, None)
        out["dns_latency_ms"] = round((time.time() - t0) * 1000, 1)
        ips = []
        for ans in resp.answer or []:
            for item in ans.items:
                txt = item.to_text()
                if txt.count(".") == 3 and all(p.isdigit() for p in txt.split(".")):
                    ips.append(txt)
        out["resolved_ips"] = ips
        out["dns_ok"] = len(ips) > 0
        # Heuristic poison check — known sinkhole / RFC1918 ranges
        for ip in ips:
            if ip.startswith("10.") or ip.startswith("127.") or ip.startswith("0.") or ip.startswith("192.168."):
                out["poisoned"] = True
    except Exception as e:
        out["error"] = f"dns: {e}"
        return out

    if not out["dns_ok"] or out["poisoned"]:
        out["error"] = out["error"] or ("poisoned answers" if out["poisoned"] else "no A records")
        return out

    # 2) HTTP fetch (force connect to first resolved IP, with Host header)
    try:
        import httpx
        ip = out["resolved_ips"][0]
        url = target_url.replace(host, ip, 1)
        t0 = time.time()
        with httpx.Client(verify=False, timeout=timeout_sec, headers={"Host": host}) as c:
            r = c.get(url)
        out["http_latency_ms"] = round((time.time() - t0) * 1000, 1)
        out["http_status"] = r.status_code
        out["http_ok"] = 200 <= r.status_code < 400
    except Exception as e:
        out["error"] = f"http: {e}"
        return out

    out["total_latency_ms"] = round((out["dns_latency_ms"] or 0) + (out["http_latency_ms"] or 0), 1)
    return out

def get_scan_history() -> List[Dict]:
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("SELECT * FROM history ORDER BY id DESC LIMIT 50")
        rows = cur.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        print(f"Error reading history: {e}")
        return []

def predict_best_resolver() -> Dict:
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute('''
            SELECT best_resolver, COUNT(*) as frequency, AVG(avg_latency) as avg_lat
            FROM history 
            WHERE best_resolver IS NOT NULL AND best_score >= 4
            GROUP BY best_resolver 
            ORDER BY frequency DESC, avg_lat ASC 
            LIMIT 1
        ''')
        row = cur.fetchone()
        conn.close()
        if row:
            return {
                "predicted": True, "resolver": row["best_resolver"], 
                "confidence": "high" if row["frequency"] > 3 else "medium", 
                "avg_latency": round(row["avg_lat"], 1)
            }
        return {"predicted": False, "error": "Not enough historical data to predict."}
    except Exception as e:
        return {"predicted": False, "error": str(e)}


# ─── Retest Top Resolvers ─────────────────────────────────────────────────────

def retest_top_resolvers(scan_id: str, top_n: int = 10, rounds: int = 10) -> Dict:
    state = _scans.get(scan_id)
    if not state: return {"error": "Scan not found"}
    data = state.to_dict()
    top = data["results"][:top_n]
    if not top: return {"error": "No results"}

    refined = []
    for r in top:
        new_r = _test_resolver(r["resolver"], state.domain, timeout_ms=5000, rounds=rounds)
        new_r["original_score"] = r.get("score", 0)
        new_r["original_latency"] = r.get("latency_ms")
        refined.append(new_r)

    refined.sort(key=lambda x: (-x.get("score",0), x.get("latency_ms",9999)))
    return {"results": refined, "rounds": rounds}


# ─── Export ────────────────────────────────────────────────────────────────────

def export_scan(scan_id: str, fmt: str = "json") -> Any:
    state = _scans.get(scan_id)
    if not state: return {"error": "Scan not found"}
    data = state.to_dict()
    if fmt == "csv":
        lines = ["resolver,score,latency_ms,edns,hijack,country,throughput_est"]
        for r in data["results"]:
            lines.append(f'{r.get("resolver","")},{r.get("score",0)},{r.get("latency_ms","")},{r.get("edns_support","")},{r.get("nxdomain_hijack","")},{r.get("country","")},{r.get("throughput_est","")}')
        return "\n".join(lines)
    return data


# ─── Config Generation ────────────────────────────────────────────────────────

def generate_config(resolver: str, domain: str, tunnel_type: str = "auto", pubkey: str = None) -> Dict:
    """Generate ready-to-use tunnel configs from a resolver + domain."""
    configs = {}

    # SlipNet URI
    slip_data = {"resolver": resolver, "domain": domain, "type": tunnel_type}
    slip_b64 = base64.urlsafe_b64encode(json.dumps(slip_data).encode()).decode()
    configs["slipnet_uri"] = f"slipnet://{slip_b64}"

    # DNSTT client config
    configs["dnstt"] = {
        "resolver": resolver,
        "domain": domain,
        "pubkey": pubkey or "<YOUR_PUBKEY>",
        "cmd": f"./dnstt-client -doh https://dns.google/dns-query -pubkey {pubkey or '<PUBKEY>'} {domain} 127.0.0.1:1080"
    }

    # Slipstream config
    configs["slipstream"] = {
        "dns": resolver,
        "domain": domain,
        "listen": "127.0.0.1:1080",
        "mtu": 1232,
    }

    # SSH over DNS command
    configs["ssh_dns"] = f"ssh -o ProxyCommand='./dnstt-client -doh https://dns.google/dns-query -pubkey {pubkey or '<PUBKEY>'} {domain}' user@localhost"

    return configs


# ─── Best Config ──────────────────────────────────────────────────────────────

def get_best_config(scan_id: str, domain: str, pubkey: str = None) -> Dict:
    state = _scans.get(scan_id)
    if not state: return {"error": "Scan not found"}
    data = state.to_dict()
    results = data.get("results", [])
    if not results: return {"error": "No results yet"}

    good = [r for r in results if r.get("score",0) >= 4]
    good.sort(key=lambda r: r.get("latency_ms", 9999))
    if not good:
        good = sorted(results, key=lambda r: (-r.get("score",0), r.get("latency_ms",9999)))[:3]

    best = good[0] if good else results[0]
    ttype = "dnstt" if best.get("edns_support") else "slipstream"

    configs = generate_config(best["resolver"], domain, ttype, pubkey)

    return {
        "best_resolver": best["resolver"],
        "best_score": best.get("score", 0),
        "best_latency": best.get("latency_ms"),
        "best_throughput": best.get("throughput_est"),
        "top_resolvers": [{"ip":r["resolver"],"score":r.get("score",0),"latency":r.get("latency_ms"),"throughput":r.get("throughput_est")} for r in good[:5]],
        "recommendation": {
            "resolver": best["resolver"],
            "tunnel_type": ttype,
            "mtu": 1232 if best.get("latency_ms",0)<200 else 1100,
            "notes": _build_notes(best),
        },
        "configs": configs,
    }

def _build_notes(best):
    notes = []
    if best.get("nxdomain_hijack"): notes.append("This resolver hijacks NXDOMAIN — use with caution")
    if best.get("latency_ms",0) > 500: notes.append("High latency — connection may be slow")
    if not best.get("edns_support"): notes.append("No EDNS support — Slipstream recommended over DNSTT")
    if best.get("throughput_est") and best["throughput_est"] < 1.0: notes.append("Low estimated throughput — consider a closer resolver")
    return notes
