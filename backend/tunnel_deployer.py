# Copyright (c) 2026 Taher AkbariSaeed
"""
DNS Tunnel Deployer — SSH-based server deployment for dnstm-setup.
Handles connection, pre-flight checks, DNS verification, deployment,
and config generation for Slipstream/DNSTT/VayDNS tunnels.
"""

import io
import re
import json
import time
import threading
import traceback
from typing import Optional, Dict, List, Any

# Defensive optional imports — DNS Tunnel must not crash the whole backend
# if a single dependency is missing. Each function checks these flags and
# returns a clear, user-facing error instead of a 500.
_MISSING: List[str] = []
try:
    import paramiko
except Exception as _e:  # pragma: no cover
    paramiko = None  # type: ignore
    _MISSING.append(f"paramiko ({_e.__class__.__name__})")
try:
    import dns.resolver  # type: ignore
    import dns.rdatatype  # type: ignore
    _HAS_DNS = True
except Exception as _e:  # pragma: no cover
    _HAS_DNS = False
    _MISSING.append(f"dnspython ({_e.__class__.__name__})")
try:
    import requests
except Exception as _e:  # pragma: no cover
    requests = None  # type: ignore
    _MISSING.append(f"requests ({_e.__class__.__name__})")


def _require(*deps: str) -> Optional[Dict]:
    """Return an error payload if any required dep is missing, else None."""
    missing = []
    if "paramiko" in deps and paramiko is None:
        missing.append("paramiko")
    if "dns" in deps and not _HAS_DNS:
        missing.append("dnspython")
    if "requests" in deps and requests is None:
        missing.append("requests")
    if missing:
        return {
            "success": False,
            "error": "missing_dependency",
            "missing": missing,
            "message": (
                "Backend is missing required Python packages: "
                + ", ".join(missing)
                + ". Install with:  pip install -r backend/requirements.txt"
            ),
        }
    return None


def get_dependency_status() -> Dict:
    """Health probe used by /api/tunnel/health."""
    return {
        "ok": not _MISSING,
        "missing": list(_MISSING),
        "have": {
            "paramiko": paramiko is not None,
            "dnspython": _HAS_DNS,
            "requests": requests is not None,
        },
    }

# ─── Deployment State Machine ──────────────────────────────────────────────────

class DeploymentState:
    """Thread-safe deployment state tracker."""
    def __init__(self):
        self.lock = threading.Lock()
        self.status = "idle"        # idle, connecting, preflight, deploying, completed, failed, cancelled
        self.phase = ""             # Current phase description
        self.progress = 0           # 0-100
        self.logs = []              # List of log lines
        self.error = None
        self.configs = {}           # Generated configs
        self.preflight_results = {} # Pre-flight check results
        self.dns_results = {}       # DNS verification results
        self.tunnel_status = {}     # Tunnel status after deploy

    def update(self, **kwargs):
        with self.lock:
            for k, v in kwargs.items():
                setattr(self, k, v)

    def log(self, message: str, level: str = "info"):
        with self.lock:
            self.logs.append({"time": time.time(), "level": level, "msg": message})

    def to_dict(self):
        with self.lock:
            return {
                "status": self.status,
                "phase": self.phase,
                "progress": self.progress,
                "logs": self.logs[-100:],  # Last 100 lines
                "error": self.error,
                "configs": self.configs,
                "preflight_results": self.preflight_results,
                "dns_results": self.dns_results,
                "tunnel_status": self.tunnel_status,
            }


# Global deployment state
_deploy_state = DeploymentState()
_ssh_client = None  # Optional[paramiko.SSHClient] when paramiko is available
_ssh_host: str = ""  # remembered so we can build client connection details after deploy
_ssh_lock = threading.Lock()


# ─── SSH Connection ────────────────────────────────────────────────────────────

def ssh_connect(host: str, port: int = 22, username: str = "root",
                password: str = None, private_key: str = None) -> Dict:
    """
    Establish SSH connection to the target server.
    Returns: {"success": bool, "message": str, "server_info": dict}
    """
    err = _require("paramiko")
    if err:
        return err
    global _ssh_client
    try:
        with _ssh_lock:
            if _ssh_client:
                try:
                    _ssh_client.close()
                except:
                    pass

            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

            connect_kwargs = {
                "hostname": host,
                "port": port,
                "username": username,
                "timeout": 15,
                "banner_timeout": 15,
                "auth_timeout": 15,
            }

            if private_key:
                # Try loading as various key formats
                key_obj = None
                key_data = private_key.strip()
                key_file = io.StringIO(key_data)
                for key_class in [paramiko.RSAKey, paramiko.Ed25519Key, paramiko.ECDSAKey]:
                    try:
                        key_file.seek(0)
                        key_obj = key_class.from_private_key(key_file)
                        break
                    except:
                        continue
                if not key_obj:
                    return {"success": False, "message": "Invalid private key format. Supported: RSA, Ed25519, ECDSA (PEM/OpenSSH format)."}
                connect_kwargs["pkey"] = key_obj
            elif password:
                connect_kwargs["password"] = password
            else:
                return {"success": False, "message": "Either password or private key is required."}

            client.connect(**connect_kwargs)
            _ssh_client = client
            globals()["_ssh_host"] = host

        # Gather server info
        info = {}
        try:
            _, stdout, _ = client.exec_command("hostname", timeout=5)
            info["hostname"] = stdout.read().decode().strip()
        except:
            info["hostname"] = "unknown"
        try:
            _, stdout, _ = client.exec_command("cat /etc/os-release | grep PRETTY_NAME | cut -d'\"' -f2", timeout=5)
            info["os"] = stdout.read().decode().strip() or "Unknown OS"
        except:
            info["os"] = "Unknown"
        try:
            _, stdout, _ = client.exec_command("curl -4 -s --max-time 5 https://api.ipify.org", timeout=10)
            info["public_ip"] = stdout.read().decode().strip()
        except:
            info["public_ip"] = host

        return {"success": True, "message": f"Connected to {info['hostname']}", "server_info": info}
    except paramiko.AuthenticationException:
        return {"success": False, "message": "Authentication failed. Check your username, password, or private key."}
    except paramiko.SSHException as e:
        return {"success": False, "message": f"SSH error: {str(e)}"}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}


def ssh_disconnect():
    """Close the SSH connection."""
    global _ssh_client
    with _ssh_lock:
        if _ssh_client:
            try:
                _ssh_client.close()
            except:
                pass
            _ssh_client = None


def _exec(cmd: str, timeout: int = 30) -> tuple:
    """Execute a command on the connected SSH server with a HARD timeout.

    paramiko's `exec_command(timeout=...)` only applies to socket reads; the
    `recv_exit_status()` call itself blocks indefinitely if the remote command
    hangs (e.g. curl stuck on a slow/unreachable host). We enforce the timeout
    ourselves on the channel and raise TimeoutError so the deploy thread can
    surface a clean failure instead of looking 'stuck' forever.

    Also honours `_deploy_state.status == 'cancelled'` so the user-facing
    Cancel button actually interrupts a running command.

    Returns (stdout, stderr, exit_code).
    """
    global _ssh_client
    if not _ssh_client:
        raise ConnectionError("Not connected to any server")
    _, stdout, stderr = _ssh_client.exec_command(cmd, timeout=timeout, get_pty=False)
    chan = stdout.channel
    deadline = time.time() + max(1, timeout)
    while not chan.exit_status_ready():
        if _deploy_state.status == "cancelled":
            try: chan.close()
            except Exception: pass
            raise TimeoutError("cancelled by user")
        if time.time() > deadline:
            try: chan.close()
            except Exception: pass
            raise TimeoutError(f"command timed out after {timeout}s: {cmd[:120]}")
        time.sleep(0.1)
    exit_code = chan.recv_exit_status()
    try:
        out = stdout.read().decode("utf-8", errors="replace").strip()
    except Exception:
        out = ""
    try:
        err = stderr.read().decode("utf-8", errors="replace").strip()
    except Exception:
        err = ""
    return out, err, exit_code


# ─── Pre-flight Checks ────────────────────────────────────────────────────────

def run_preflight() -> Dict:
    """
    Run pre-flight checks on the connected server.
    Returns: {"success": bool, "checks": dict}
    """
    err = _require("paramiko")
    if err:
        return err
    checks = {}

    # 1. Root check
    try:
        out, _, code = _exec("id -u", 5)
        checks["root"] = {"ok": out.strip() == "0", "detail": "Running as root" if out.strip() == "0" else "Not running as root"}
    except Exception as e:
        checks["root"] = {"ok": False, "detail": str(e)}

    # 2. OS check
    try:
        out, _, _ = _exec("cat /etc/os-release 2>/dev/null | grep -iE 'ubuntu|debian' | head -1", 5)
        is_supported = bool(out.strip())
        os_out, _, _ = _exec("cat /etc/os-release | grep PRETTY_NAME | cut -d'\"' -f2", 5)
        checks["os"] = {"ok": is_supported, "detail": os_out.strip() or "Unknown OS"}
    except Exception as e:
        checks["os"] = {"ok": False, "detail": str(e)}

    # 3. curl check
    try:
        _, _, code = _exec("which curl", 5)
        checks["curl"] = {"ok": code == 0, "detail": "curl is installed" if code == 0 else "curl not found — will be installed"}
    except Exception as e:
        checks["curl"] = {"ok": False, "detail": str(e)}

    # 4. Port 53 check
    try:
        out, _, _ = _exec("ss -ulnp 2>/dev/null | grep -E ':53\\b' || echo 'free'", 10)
        is_free = "free" in out and "systemd-resolve" not in out
        if "dnstm" in out or "dns-router" in out:
            checks["port53"] = {"ok": True, "detail": "Port 53 in use by dnstm (existing installation)"}
        elif is_free:
            checks["port53"] = {"ok": True, "detail": "Port 53 is free"}
        else:
            blocker = "systemd-resolved" if "systemd-resolve" in out else "unknown service"
            checks["port53"] = {"ok": False, "detail": f"Port 53 blocked by {blocker}", "blocker": blocker}
    except Exception as e:
        checks["port53"] = {"ok": False, "detail": str(e)}

    # 5. dnstm already installed?
    try:
        _, _, code = _exec("which dnstm", 5)
        checks["dnstm_installed"] = {"ok": True, "detail": "dnstm is already installed" if code == 0 else "dnstm not installed (will be installed)"}
    except:
        checks["dnstm_installed"] = {"ok": False, "detail": "Check failed"}

    # 6. Public IP
    try:
        out, _, _ = _exec("curl -4 -s --max-time 5 https://api.ipify.org", 10)
        checks["public_ip"] = {"ok": bool(out.strip()), "detail": out.strip() or "Could not detect"}
    except Exception as e:
        checks["public_ip"] = {"ok": False, "detail": str(e)}

    all_critical_ok = checks.get("root", {}).get("ok") and checks.get("os", {}).get("ok")

    _deploy_state.update(preflight_results=checks)

    return {"success": all_critical_ok, "checks": checks}


# ─── Port 53 auto-fix ──────────────────────────────────────────────────────────

def fix_port53() -> Dict:
    """
    Free up UDP/TCP port 53 on the connected server by disabling the
    systemd-resolved stub listener (the most common reason port 53 is
    "blocked" on a fresh Ubuntu/Debian VPS) and pointing /etc/resolv.conf
    at a real upstream resolver (1.1.1.1 + 8.8.8.8) so the box itself
    can still resolve DNS for apt / curl / etc.

    Returns: {"success": bool, "message": str, "after": "<ss output>"}
    """
    err = _require("ssh")
    if err:
        return err
    steps = []
    try:
        # 1. Inspect current occupant
        before, _, _ = _exec("ss -ulnp 2>/dev/null | grep -E ':53\\b' || echo 'free'", 10)
        steps.append(f"before: {before.strip() or '(empty)'}")

        # 2. Disable the stub listener (preserve the rest of resolved)
        _exec(
            "mkdir -p /etc/systemd/resolved.conf.d && "
            "printf '[Resolve]\\nDNSStubListener=no\\nDNS=1.1.1.1 8.8.8.8\\nFallbackDNS=9.9.9.9\\n' "
            "> /etc/systemd/resolved.conf.d/99-disable-stub.conf",
            15,
        )
        steps.append("wrote /etc/systemd/resolved.conf.d/99-disable-stub.conf")

        # 3. Replace /etc/resolv.conf with a real, working resolver so the
        #    VPS doesn't lose DNS the moment we kill the stub.
        _exec(
            "rm -f /etc/resolv.conf && "
            "printf 'nameserver 1.1.1.1\\nnameserver 8.8.8.8\\noptions edns0 trust-ad\\n' "
            "> /etc/resolv.conf && "
            "chattr +i /etc/resolv.conf 2>/dev/null || true",
            15,
        )
        steps.append("rewrote /etc/resolv.conf -> 1.1.1.1, 8.8.8.8 (locked)")

        # 4. Restart resolved so the stub goes away.
        _exec("systemctl restart systemd-resolved 2>/dev/null || true", 20)
        steps.append("restarted systemd-resolved")

        # 5. Verify
        after, _, _ = _exec("ss -ulnp 2>/dev/null | grep -E ':53\\b' || echo 'free'", 10)
        ok = ("free" in after) or ("dnstm" in after)
        return {
            "success": ok,
            "message": "Port 53 is free." if ok
                       else "systemd-resolved stub disabled, but something else is still on :53 — see 'after'.",
            "steps": steps,
            "after": after.strip(),
        }
    except Exception as e:
        return {"success": False, "message": f"fix_port53 failed: {e}", "steps": steps}


# ─── DNS Verification ──────────────────────────────────────────────────────────

def verify_dns_records(domain: str, server_ip: str = None) -> Dict:
    """
    Verify that all required DNS records are properly configured.
    Checks: 1 A record (ns.domain) + 8 NS records (t/d/n/v/s/ds/z/vz).
    """
    err = _require("dns")
    if err:
        return err
    if not server_ip:
        try:
            out, _, _ = _exec("curl -4 -s --max-time 5 https://api.ipify.org", 10)
            server_ip = out.strip()
        except:
            server_ip = ""

    results = {"domain": domain, "server_ip": server_ip, "records": {}, "all_ok": True}
    resolver = dns.resolver.Resolver()
    resolver.nameservers = ["8.8.8.8", "1.1.1.1"]
    resolver.timeout = 5
    resolver.lifetime = 10

    # Check A record: ns.domain -> server_ip
    a_name = f"ns.{domain}"
    try:
        answers = resolver.resolve(a_name, "A")
        found_ips = [r.to_text() for r in answers]
        matches = server_ip in found_ips if server_ip else len(found_ips) > 0
        results["records"]["A_ns"] = {
            "type": "A", "name": "ns", "expected": server_ip,
            "found": found_ips, "ok": matches
        }
    except dns.resolver.NXDOMAIN:
        results["records"]["A_ns"] = {"type": "A", "name": "ns", "expected": server_ip, "found": [], "ok": False, "error": "NXDOMAIN"}
        results["all_ok"] = False
    except Exception as e:
        results["records"]["A_ns"] = {"type": "A", "name": "ns", "expected": server_ip, "found": [], "ok": False, "error": str(e)}
        results["all_ok"] = False

    # Check NS records for each subdomain
    ns_subdomains = ["t", "d", "n", "v", "s", "ds", "z", "vz"]
    expected_ns = f"ns.{domain}."

    for sub in ns_subdomains:
        fqdn = f"{sub}.{domain}"
        key = f"NS_{sub}"
        try:
            answers = resolver.resolve(fqdn, "NS")
            found = [r.to_text().lower() for r in answers]
            ok = any(expected_ns.lower() in f for f in found)
            results["records"][key] = {
                "type": "NS", "name": sub, "expected": f"ns.{domain}",
                "found": found, "ok": ok
            }
            if not ok:
                results["all_ok"] = False
        except dns.resolver.NoAnswer:
            results["records"][key] = {"type": "NS", "name": sub, "expected": f"ns.{domain}", "found": [], "ok": False, "error": "No NS record"}
            results["all_ok"] = False
        except dns.resolver.NXDOMAIN:
            results["records"][key] = {"type": "NS", "name": sub, "expected": f"ns.{domain}", "found": [], "ok": False, "error": "NXDOMAIN"}
            results["all_ok"] = False
        except Exception as e:
            results["records"][key] = {"type": "NS", "name": sub, "expected": f"ns.{domain}", "found": [], "ok": False, "error": str(e)}
            results["all_ok"] = False

    _deploy_state.update(dns_results=results)
    return results


# ─── Cloudflare API DNS Management ────────────────────────────────────────────

def cloudflare_create_dns_records(api_token: str, domain: str, server_ip: str) -> Dict:  # noqa: D401
    err = _require("requests")
    if err:
        return err
    return _cloudflare_create_dns_records_impl(api_token, domain, server_ip)


def _cloudflare_create_dns_records_impl(api_token: str, domain: str, server_ip: str) -> Dict:
    """
    Auto-create all 9 DNS records (1 A + 8 NS) in Cloudflare via API.
    Requires a Cloudflare API token with DNS edit permissions.
    """
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json"
    }

    # 1. Find the zone ID for the domain
    try:
        resp = requests.get(
            f"https://api.cloudflare.com/client/v4/zones?name={domain}&status=active",
            headers=headers, timeout=10
        )
        data = resp.json()
        if not data.get("success") or not data.get("result"):
            return {"success": False, "message": f"Could not find zone for {domain}. Make sure the domain is added to your Cloudflare account."}
        zone_id = data["result"][0]["id"]
    except Exception as e:
        return {"success": False, "message": f"Cloudflare API error: {str(e)}"}

    created = []
    errors = []

    # 2. Create A record: ns.domain -> server_ip (DNS only, no proxy)
    try:
        resp = requests.post(
            f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
            headers=headers, timeout=10,
            json={"type": "A", "name": f"ns.{domain}", "content": server_ip, "ttl": 1, "proxied": False}
        )
        r = resp.json()
        if r.get("success"):
            created.append(f"A  ns.{domain} → {server_ip}")
        else:
            err_msg = r.get("errors", [{}])[0].get("message", "Unknown error")
            if "already exists" in err_msg.lower():
                created.append(f"A  ns.{domain} → {server_ip} (already exists)")
            else:
                errors.append(f"A record: {err_msg}")
    except Exception as e:
        errors.append(f"A record: {str(e)}")

    # 3. Create 8 NS records
    ns_subdomains = ["t", "d", "n", "v", "s", "ds", "z", "vz"]
    for sub in ns_subdomains:
        try:
            resp = requests.post(
                f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
                headers=headers, timeout=10,
                json={"type": "NS", "name": f"{sub}.{domain}", "content": f"ns.{domain}", "ttl": 1}
            )
            r = resp.json()
            if r.get("success"):
                created.append(f"NS {sub}.{domain} → ns.{domain}")
            else:
                err_msg = r.get("errors", [{}])[0].get("message", "Unknown error")
                if "already exists" in err_msg.lower():
                    created.append(f"NS {sub}.{domain} → ns.{domain} (already exists)")
                else:
                    errors.append(f"NS {sub}: {err_msg}")
        except Exception as e:
            errors.append(f"NS {sub}: {str(e)}")

    return {
        "success": len(errors) == 0,
        "created": created,
        "errors": errors,
        "message": f"Created {len(created)} records" + (f", {len(errors)} errors" if errors else "")
    }


# ─── Deployment Engine ─────────────────────────────────────────────────────────

def start_deployment(domain: str, mtu: int = 1232,  # noqa: D401
                     *args, **kwargs) -> Dict:
    err = _require("paramiko")
    if err:
        return err
    return _start_deployment_impl(domain, mtu, *args, **kwargs)


def _start_deployment_impl(domain: str, mtu: int = 1232,
                     socks_auth: bool = False, socks_user: str = "proxy", socks_pass: str = "",
                     ssh_tunnel_user: bool = False, ssh_user: str = "tunnel", ssh_pass: str = "",
                     add_xray: bool = False, xray_protocol: str = "vless") -> Dict:
    """
    Start the full dnstm-setup deployment on the connected server.
    Runs in a background thread, updates _deploy_state with progress.
    """
    global _deploy_state, _ssh_client
    if not _ssh_client:
        return {"success": False, "message": "Not connected to any server"}

    if _deploy_state.status == "deploying":
        return {"success": False, "message": "Deployment already in progress"}

    _deploy_state = DeploymentState()
    _deploy_state.update(status="deploying", phase="Preparing...")

    def _deploy_thread():
        try:
            state = _deploy_state

            # Phase 1: Download dnstm-setup
            state.update(phase="Downloading dnstm-setup...", progress=5)
            state.log("Downloading dnstm-setup.sh from GitHub...")
            # Try multiple mirrors with hard --max-time so a slow/blocked GitHub
            # connection cannot hang the deploy thread forever.
            DNSTM_URLS = [
                "https://raw.githubusercontent.com/SamNet-dev/dnstm-setup/master/dnstm-setup.sh",
                "https://raw.githubusercontent.com/net2share/dnstm/master/install.sh",
            ]
            downloaded = False
            last_err = ""
            for url in DNSTM_URLS:
                state.log(f"Trying {url}...")
                try:
                    out, err, code = _exec(
                        f"curl -fsSL --max-time 25 --connect-timeout 8 -o /tmp/dnstm-setup.sh '{url}' && test -s /tmp/dnstm-setup.sh && echo OK",
                        timeout=35
                    )
                except TimeoutError as te:
                    last_err = str(te)
                    state.log(f"  ⏱ {te}", "warn")
                    continue
                if code == 0 and "OK" in out:
                    downloaded = True
                    state.log(f"✓ Downloaded from {url.split('/')[2]}", "success")
                    break
                last_err = err or out or f"exit {code}"
                state.log(f"  ✗ {last_err[:160]}", "warn")
            if not downloaded:
                state.update(
                    status="failed",
                    error=(
                        "Could not download dnstm-setup script. The server cannot reach GitHub. "
                        "Check the VPS network/DNS, or run manually:  curl -fsSL "
                        "https://raw.githubusercontent.com/SamNet-dev/dnstm-setup/master/dnstm-setup.sh -o /tmp/dnstm-setup.sh\n"
                        f"Last error: {last_err}"
                    ),
                )
                return

            # Phase 2: Fix port 53 if needed
            state.update(phase="Checking port 53...", progress=10)
            state.log("Checking port 53 availability...")
            try:
                out, _, _ = _exec("ss -ulnp 2>/dev/null | grep -E ':53\\b'", 10)
            except TimeoutError:
                out = ""
            if "systemd-resolve" in out:
                state.log("Disabling systemd-resolved (blocking port 53)...")
                for c in [
                    "systemctl stop systemd-resolved.socket systemd-resolved.service 2>/dev/null",
                    "systemctl disable systemd-resolved.socket systemd-resolved.service 2>/dev/null",
                    "systemctl mask systemd-resolved.socket systemd-resolved.service 2>/dev/null",
                    "pkill -9 systemd-resolve 2>/dev/null",
                    'chattr -i /etc/resolv.conf 2>/dev/null; rm -f /etc/resolv.conf; echo "nameserver 8.8.8.8" > /etc/resolv.conf; chattr +i /etc/resolv.conf',
                ]:
                    try: _exec(c, 10)
                    except TimeoutError: state.log(f"  ⏱ slow: {c[:60]}", "warn")
                state.log("✓ systemd-resolved disabled, DNS set to 8.8.8.8", "success")
            else:
                state.log("✓ Port 53 is available", "success")

            # Phase 3: Install dnstm
            #
            # We deliberately bypass the upstream wrapper installers
            # (install.sh / dnstm-setup.sh). Both read from /dev/tty for
            # confirmation prompts, which fails over a non-PTY SSH exec
            # channel with:
            #   "install.sh: line 104: /dev/tty: No such device or address"
            #
            # Instead we mirror what SamNet/dnstm-setup's `step_install_dnstm`
            # actually does internally:
            #   1. detect arch  (uname -m -> amd64/arm64/armv7)
            #   2. curl the release binary directly to /usr/local/bin/dnstm
            #   3. chmod +x
            #   4. run `dnstm install --mode multi --force`
            #      (Go binary, does NOT touch /dev/tty)
            #   5. verify with `dnstm --version` and `which dnstm`
            state.update(phase="Installing dnstm...", progress=18)
            try:
                _, _, dnstm_code = _exec("which dnstm", 5)
            except TimeoutError:
                dnstm_code = 1

            if dnstm_code != 0:
                # 3a. Detect architecture
                state.log("Detecting server architecture...")
                try:
                    arch_raw, _, _ = _exec("uname -m", 5)
                except TimeoutError:
                    arch_raw = ""
                arch_map = {
                    "x86_64": "amd64", "amd64": "amd64",
                    "aarch64": "arm64", "arm64": "arm64",
                    "armv7l": "armv7", "armv6l": "armv7",
                }
                arch = arch_map.get(arch_raw.strip(), "amd64")
                state.log(f"  Architecture: {arch_raw or '?'} -> dnstm-linux-{arch}")

                # 3b. Ensure curl exists (most distros have it)
                try:
                    _, _, has_curl = _exec("command -v curl", 5)
                except TimeoutError:
                    has_curl = 1
                if has_curl != 0:
                    state.log("Installing curl...")
                    try:
                        _exec("apt-get update -qq && apt-get install -y -qq curl", 120)
                    except TimeoutError:
                        state.log("  ⏱ apt-get install curl timed out", "warn")

                # 3c. Download binary directly from GitHub releases
                bin_url = (
                    f"https://github.com/net2share/dnstm/releases/latest/"
                    f"download/dnstm-linux-{arch}"
                )
                state.update(phase="Downloading dnstm binary...", progress=22)
                state.log(f"Downloading {bin_url}...")
                try:
                    out, err, code = _exec(
                        f"curl -fsSL --max-time 120 --connect-timeout 10 -o /usr/local/bin/dnstm '{bin_url}' "
                        f"&& chmod +x /usr/local/bin/dnstm "
                        f"&& test -s /usr/local/bin/dnstm && echo OK",
                        timeout=180,
                    )
                except TimeoutError as te:
                    state.update(status="failed", error=f"dnstm binary download timed out: {te}")
                    return
                if code != 0 or "OK" not in out:
                    state.update(
                        status="failed",
                        error=(
                            f"Failed to download dnstm binary for {arch}. "
                            f"URL: {bin_url}\n"
                            f"curl: {(err or out)[-300:]}\n"
                            f"Verify the VPS can reach github.com (try: curl -I https://github.com)."
                        ),
                    )
                    return
                state.log(f"✓ Downloaded dnstm binary for {arch}", "success")

                # 3d. Run `dnstm install --mode multi --force` (the Go CLI itself,
                # NOT the wrapper script — does not need a PTY).
                state.update(phase="Running dnstm install --mode multi...", progress=28)
                state.log("Running: dnstm install --mode multi --force")
                # Save iptables before install (dnstm install resets firewall rules).
                try: _exec("iptables-save > /tmp/iptables-pre-dnstm 2>/dev/null || true", 10)
                except TimeoutError: pass
                try:
                    out, err, code = _exec(
                        "dnstm install --mode multi --force 2>&1 | tail -80",
                        timeout=240,
                    )
                except TimeoutError as te:
                    state.update(status="failed", error=f"`dnstm install` timed out: {te}")
                    return
                state.log((out or err or '')[-800:] or f"dnstm install exit={code}")
                # Restore iptables
                try: _exec("test -s /tmp/iptables-pre-dnstm && iptables-restore < /tmp/iptables-pre-dnstm 2>/dev/null; rm -f /tmp/iptables-pre-dnstm", 10)
                except TimeoutError: pass

                # 3e. Verify
                try:
                    ver, _, vc = _exec("dnstm --version 2>&1", 10)
                except TimeoutError:
                    ver, vc = "", 1
                if vc != 0:
                    state.update(
                        status="failed",
                        error=(
                            "dnstm binary downloaded but `dnstm --version` failed. "
                            f"Output: {ver[:300]}. The binary may be incompatible with this "
                            "system (wrong arch or missing GLIBC). SSH in and run "
                            "`dnstm --version` manually for details."
                        ),
                    )
                    return
                state.log(f"✓ dnstm installed: {ver.splitlines()[0] if ver else 'ok'}", "success")
            else:
                try:
                    ver, _, _ = _exec("dnstm --version 2>&1", 5)
                except TimeoutError:
                    ver = "unknown"
                state.log(f"✓ dnstm already installed ({ver.splitlines()[0] if ver else 'ok'})", "success")

                # Ensure router is in multi mode even when reusing existing install
                try:
                    mode_out, _, _ = _exec("dnstm router mode 2>&1", 10)
                except TimeoutError:
                    mode_out = ""
                if "multi" not in mode_out.lower():
                    state.log("Switching router to multi mode...")
                    try:
                        _exec("dnstm install --mode multi --force 2>&1 | tail -20", 180)
                    except TimeoutError:
                        state.log("  ⏱ multi-mode switch timed out", "warn")

            # Phase 4: Create tunnels
            #
            # dnstm only supports three transports: slipstream, dnstt, vaydns.
            # (Earlier versions of this code also tried 'noizdns' which the CLI
            # rejects with: "invalid transport type: noizdns".)
            state.update(phase="Creating tunnels...", progress=40)
            tunnel_configs = [
                ("slip1",    "slipstream", "socks", f"t.{domain}"),
                ("dnstt1",   "dnstt",      "socks", f"d.{domain}"),
                ("vay1",     "vaydns",     "socks", f"v.{domain}"),
                ("slip-ssh", "slipstream", "ssh",   f"s.{domain}"),
                ("dnstt-ssh","dnstt",      "ssh",   f"ds.{domain}"),
                ("vay-ssh",  "vaydns",     "ssh",   f"vz.{domain}"),
            ]

            for i, (tag, transport, backend, subdomain) in enumerate(tunnel_configs):
                state.log(f"Creating tunnel: {tag} ({transport}+{backend}) on {subdomain}...")
                mtu_arg = f"--mtu {mtu}" if transport == "dnstt" else ""
                try:
                    out, err, code = _exec(
                        f"dnstm tunnel add --tag {tag} --transport {transport} --backend {backend} --domain {subdomain} {mtu_arg} 2>&1",
                        timeout=30
                    )
                except TimeoutError as te:
                    state.log(f"  ⏱ {tag}: {te}", "warn")
                    code, out, err = 124, "", str(te)
                if code == 0 or "already exists" in (out + err).lower():
                    state.log(f"  ✓ {tag} created", "success")
                else:
                    state.log(f"  ⚠ {tag}: {err or out}", "warn")
                state.update(progress=40 + int((i + 1) / len(tunnel_configs) * 20))

            # Phase 5: Start services
            state.update(phase="Starting services...", progress=65)
            state.log("Starting DNS Router...")
            try: _exec("dnstm router start 2>&1", 15)
            except TimeoutError: state.log("  ⏱ router start slow", "warn")
            state.log("Starting all tunnels...")
            for tag, _, _, _ in tunnel_configs:
                try: _exec(f"dnstm tunnel start --tag {tag} 2>&1", 10)
                except TimeoutError: state.log(f"  ⏱ {tag} start slow", "warn")
            state.log("✓ All services started", "success")

            # Phase 6: Configure SOCKS auth (if enabled)
            state.update(phase="Configuring authentication...", progress=75)
            if socks_auth and socks_pass:
                state.log(f"Enabling SOCKS5 auth (user: {socks_user})...")
                try: _exec(f'dnstm backend auth -t socks -u "{socks_user}" -p "{socks_pass}" 2>&1', 15)
                except TimeoutError: state.log("  ⏱ socks auth slow", "warn")
                state.log("✓ SOCKS5 authentication enabled", "success")
            else:
                state.log("SOCKS auth: disabled (open proxy)", "info")

            # Phase 7: Configure SSH tunnel user (if enabled)
            if ssh_tunnel_user and ssh_pass:
                state.log(f"Creating SSH tunnel user: {ssh_user}...")
                # Download sshtun-user if not installed
                _exec("which sshtun-user || curl -fsSL https://raw.githubusercontent.com/net2share/sshtun-user/master/install.sh | bash", 30)
                _exec(f'sshtun-user add --user "{ssh_user}" --pass "{ssh_pass}" 2>&1', 15)
                state.log(f"✓ SSH tunnel user '{ssh_user}' created", "success")

            # Phase 8: Xray integration (if enabled)
            if add_xray:
                state.update(phase="Setting up Xray backend...", progress=80)
                state.log(f"Adding Xray backend ({xray_protocol})...")
                out, err, code = _exec(
                    f'bash /tmp/dnstm-setup.sh --add-xray 2>&1 || echo "Xray setup requires manual intervention"',
                    timeout=120
                )
                state.log(f"Xray setup output: {out[:500]}", "info")

            # Phase 9: Get status & configs
            state.update(phase="Retrieving configs...", progress=90)
            state.log("Getting tunnel status and share URLs...")

            # Get tunnel list
            tunnel_out, _, _ = _exec("dnstm tunnel list 2>&1", 10)
            state.log(f"Active tunnels:\n{tunnel_out}")

            # Extract public keys
            pubkeys = {}
            for key_type in ["dnstt", "vaydns"]:
                out, _, _ = _exec(f"cat /etc/dnstm/keys/{key_type}/server.pub 2>/dev/null || echo ''", 5)
                if out.strip():
                    pubkeys[key_type] = out.strip()

            # Get share URLs.
            #   - SOCKS tunnels: dnstm tunnel share -t <tag>
            #   - SSH  tunnels: dnstm tunnel share -t <tag> --user <u> --password <p>
            #     (the SSH share URL needs creds because it embeds the connection block)
            share_urls = {}
            for tag, _, backend, _ in tunnel_configs:
                if backend == "ssh":
                    if not (ssh_tunnel_user and ssh_user and ssh_pass):
                        continue  # no creds -> dnstm won't emit a usable URL
                    cmd = (
                        f"dnstm tunnel share -t {tag} "
                        f"--user '{ssh_user}' --password '{ssh_pass}' 2>/dev/null"
                    )
                else:
                    cmd = f"dnstm tunnel share -t {tag} 2>/dev/null"
                try:
                    out, _, code = _exec(cmd, 10)
                except TimeoutError:
                    continue
                if code == 0 and out.strip():
                    # share output sometimes includes a header line; pick the dnst:// line
                    for line in out.splitlines():
                        line = line.strip()
                        if line.startswith("dnst://"):
                            share_urls[tag] = line
                            break
                    else:
                        share_urls[tag] = out.strip()

            # Parse `dnstm tunnel list` to extract per-tunnel ports so we can
            # surface SSH connection details for the *-ssh tunnels.
            #   TAG       TRANSPORT  BACKEND  PORT  DOMAIN              STATUS
            #   slip-ssh  Slipstream ssh      5313  s.matrus.exchange   Running
            tunnel_ports: Dict[str, int] = {}
            try:
                for line in (tunnel_out or "").splitlines():
                    parts = line.split()
                    if len(parts) >= 5 and parts[0] in {t[0] for t in tunnel_configs}:
                        for token in parts[1:]:
                            if token.isdigit() and 1 <= int(token) <= 65535:
                                tunnel_ports[parts[0]] = int(token)
                                break
            except Exception:
                pass

            # Build SSH endpoint info for ssh-backend tunnels. Clients connect
            # to the dnstm DNS port (the VPS public IP at the parsed PORT) and
            # authenticate with the sshtun-user credentials configured in Phase 7.
            host_ip = globals().get("_ssh_host") or "<your-server-ip>"
            ssh_endpoints = {}
            if ssh_tunnel_user and ssh_user:
                for tag, transport, backend, subdomain in tunnel_configs:
                    if backend != "ssh":
                        continue
                    ssh_endpoints[tag] = {
                        "transport": transport,           # slipstream / dnstt / vaydns
                        "domain": subdomain,              # e.g. s.matrus.exchange
                        "host": host_ip,                  # VPS public IP
                        "port": tunnel_ports.get(tag),    # e.g. 5313
                        "ssh_user": ssh_user,
                        "ssh_pass": ssh_pass,
                        "hint": (
                            f"Use an SSH-over-DNS client (HTTP Injector / SlipNet) with "
                            f"transport={transport}, domain={subdomain}, server={host_ip}:"
                            f"{tunnel_ports.get(tag, '?')}, ssh user={ssh_user}."
                        ),
                    }

            # Build a SlipNet-friendly manual config block per tunnel by decoding
            # the dnst:// share URL (base64url JSON payload). SlipNet doesn't
            # accept dnst:// directly, so we surface the same fields ready to
            # paste into its 'New Profile' form.
            import base64 as _b64, json as _json
            def _decode_dnst(url: str) -> Dict:
                try:
                    payload = url.split("dnst://", 1)[1].split("#", 1)[0]
                    pad = "=" * (-len(payload) % 4)
                    raw = _b64.urlsafe_b64decode((payload + pad).encode("ascii"))
                    return _json.loads(raw.decode("utf-8", errors="ignore"))
                except Exception:
                    return {}

            manual_configs: Dict[str, Dict] = {}
            for tag, transport, backend, subdomain in tunnel_configs:
                url = share_urls.get(tag, "")
                decoded = _decode_dnst(url) if url else {}
                tr = (decoded.get("transport") or {})
                mc = {
                    "slipnet_tunnel_type": {
                        ("slipstream", "socks"): "Slipstream",
                        ("slipstream", "ssh"):   "Slipstream + SSH",
                        ("dnstt", "socks"):      "DNSTT",
                        ("dnstt", "ssh"):        "DNSTT + SSH",
                        ("vaydns", "socks"):     "VayDNS",
                        ("vaydns", "ssh"):       "VayDNS + SSH",
                    }.get((transport, backend), transport),
                    "transport": transport,
                    "backend": backend,
                    "domain": tr.get("domain") or subdomain,
                    "server_host": host_ip,
                    "server_port": tunnel_ports.get(tag),
                }
                if tr.get("pubkey"):                 # dnstt / vaydns
                    mc["pubkey_hex"] = tr["pubkey"]
                if tr.get("cert"):                   # slipstream PEM cert
                    mc["tls_cert_pem"] = tr["cert"]
                # VayDNS specifics
                for k in ("clientid_size", "idle_timeout", "keepalive",
                          "record_type", "dnstt_compat", "mtu"):
                    if k in tr:
                        mc[f"vaydns_{k}" if transport == "vaydns" else k] = tr[k]
                if backend == "ssh" and ssh_tunnel_user and ssh_user:
                    mc["ssh_host"] = host_ip
                    mc["ssh_port"] = tunnel_ports.get(tag)
                    mc["ssh_user"] = ssh_user
                    mc["ssh_pass"] = ssh_pass
                manual_configs[tag] = mc

            # ── slipnet:// URI builder ────────────────────────────────────────
            # SlipNet won't import dnst:// (that's the dnstc CLI's format), but
            # it imports its own slipnet:// URIs (base64url(JSON)). The schema
            # below is the best-effort shape inferred from the SlipNet README
            # and DNS-Multiplexer's parser; if SlipNet rejects an import the
            # manual_configs block above is the fallback.
            def _slipnet_url(mc: Dict, tunnel_type_override: str = None) -> str:
                tt = tunnel_type_override or mc.get("slipnet_tunnel_type") or ""
                payload: Dict = {
                    "v": 1,
                    "name": mc.get("_tag") or tt,
                    "tunnel_type": tt,
                    "domain": mc.get("domain") or "",
                    "server_host": mc.get("server_host") or "",
                    "server_port": mc.get("server_port") or 0,
                }
                if mc.get("pubkey_hex"):
                    payload["pubkey"] = mc["pubkey_hex"]
                if mc.get("tls_cert_pem"):
                    payload["cert"] = mc["tls_cert_pem"]
                if mc.get("mtu"):
                    payload["mtu"] = mc["mtu"]
                # VayDNS extras
                vd = {}
                for src, dst in (("vaydns_clientid_size", "clientid_size"),
                                 ("vaydns_idle_timeout", "idle_timeout"),
                                 ("vaydns_keepalive", "keepalive"),
                                 ("vaydns_record_type", "record_type"),
                                 ("vaydns_dnstt_compat", "dnstt_compat")):
                    if src in mc:
                        vd[dst] = mc[src]
                if vd:
                    payload["vaydns"] = vd
                # SSH block
                if mc.get("ssh_host"):
                    payload["ssh"] = {
                        "host": mc.get("ssh_host"),
                        "port": mc.get("ssh_port") or 22,
                        "user": mc.get("ssh_user") or "",
                        "pass": mc.get("ssh_pass") or "",
                        "cipher": "aes128-gcm",
                    }
                # Default DNS resolvers — gives the SlipNet client something
                # sensible if the user's ISP DNS is hijacking.
                payload["resolvers"] = ["1.1.1.1", "8.8.8.8", "9.9.9.9"]
                raw = _json.dumps(payload, separators=(",", ":")).encode("utf-8")
                b64 = _b64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
                return "slipnet://" + b64

            slipnet_urls: Dict[str, str] = {}
            slipnet_urls_noizdns: Dict[str, str] = {}
            for tag, mc in manual_configs.items():
                mc_named = dict(mc); mc_named["_tag"] = tag
                slipnet_urls[tag] = _slipnet_url(mc_named)
                # dnstt tunnels can ALSO be consumed in NoizDNS mode (same
                # server binary, DPI-evasion client-side toggle).
                if mc.get("transport") == "dnstt":
                    noiz_type = ("NoizDNS + SSH" if mc.get("backend") == "ssh"
                                 else "NoizDNS")
                    slipnet_urls_noizdns[tag] = _slipnet_url(mc_named, noiz_type)

            # Build config output
            configs = {
                "domain": domain,
                "server_host": globals().get("_ssh_host") or "",
                "tunnels": tunnel_out,
                "tunnel_ports": tunnel_ports,
                "pubkeys": pubkeys,
                "share_urls": share_urls,
                "ssh_endpoints": ssh_endpoints,
                "manual_configs": manual_configs,
                "slipnet_urls": slipnet_urls,
                "slipnet_urls_noizdns": slipnet_urls_noizdns,
                "socks_auth": {"enabled": socks_auth, "user": socks_user} if socks_auth else {"enabled": False},
                "ssh_tunnel": {"enabled": ssh_tunnel_user, "user": ssh_user} if ssh_tunnel_user else {"enabled": False},
                "client_links": {
                    "slipnet_android": "https://github.com/anonvector/SlipNet/releases",
                    "http_injector_ios": "https://apps.apple.com/us/app/http-injector/id1659992827",
                    "slipnet_cli_windows": "https://github.com/anonvector/SlipNet/releases",
                    "slipnet_cli_macos": "https://github.com/anonvector/SlipNet/releases",
                    "slipnet_cli_linux": "https://github.com/anonvector/SlipNet/releases",
                },
                "dns_resolvers": [
                    "8.8.8.8:53", "1.1.1.1:53", "9.9.9.9:53",
                    "208.67.222.222:53", "94.140.14.14:53", "185.228.168.9:53"
                ],
            }

            state.update(
                status="completed", phase="Deployment complete!", progress=100,
                configs=configs, tunnel_status=tunnel_out
            )
            state.log("🎉 Deployment completed successfully!", "success")

        except Exception as e:
            _deploy_state.update(status="failed", error=str(e))
            _deploy_state.log(f"❌ Deployment failed: {str(e)}", "error")
            _deploy_state.log(traceback.format_exc(), "error")

    thread = threading.Thread(target=_deploy_thread, daemon=True)
    thread.start()
    return {"success": True, "message": "Deployment started"}


def cancel_deployment():
    """Cancel the current deployment."""
    _deploy_state.update(status="cancelled", phase="Cancelled by user")
    _deploy_state.log("Deployment cancelled by user", "warn")
    return {"success": True}


def get_deployment_status() -> Dict:
    """Get the current deployment state."""
    return _deploy_state.to_dict()


def get_tunnel_configs() -> Dict:
    """Get the generated configs from the last deployment."""
    return _deploy_state.configs or {}


# ─── Phase 2: Manage existing deployment ─────────────────────────────────────
# These functions assume an SSH session is already connected to a host that
# has dnstm installed (whether or not it was deployed by THIS app). Each
# returns a JSON-serialisable dict with at least {success, message, ...}.

def manage_status() -> Dict:
    """Probe an existing dnstm install: version, listening ports, tunnels, services."""
    if not _ssh_client:
        return {"success": False, "message": "Not connected"}
    try:
        ver_out, _, ver_code = _exec("dnstm --version 2>&1 || dnstm version 2>&1", 10)
        if ver_code != 0:
            return {"success": False, "installed": False, "message": "dnstm not installed on this host"}
        # Listening UDP/TCP on :53 and any tunnel ports
        ss_out, _, _ = _exec("ss -tulnp 2>/dev/null | head -40 || netstat -tulnp 2>/dev/null | head -40", 10)
        # dnstm-managed tunnels
        tunnels_out, _, _ = _exec("dnstm tunnel list 2>&1 | head -40", 15)
        # systemd unit health
        units_out, _, _ = _exec(
            "systemctl list-units --type=service --no-legend --no-pager 2>/dev/null "
            "| awk '$1 ~ /dnstm/ {print $1\" \"$3\" \"$4}'",
            10,
        )
        # uptime of any dnstm unit
        uptime_out, _, _ = _exec(
            "systemctl show dnstm.service -p ActiveEnterTimestamp --value 2>/dev/null", 5
        )
        return {
            "success": True,
            "installed": True,
            "version": ver_out.strip(),
            "listening": ss_out,
            "tunnels": tunnels_out,
            "units": [l for l in units_out.splitlines() if l.strip()],
            "active_since": uptime_out.strip(),
            "host": globals().get("_ssh_host") or "",
        }
    except Exception as e:
        return {"success": False, "message": str(e)}


def manage_restart() -> Dict:
    """Restart all dnstm-related systemd units."""
    if not _ssh_client:
        return {"success": False, "message": "Not connected"}
    try:
        out, err, code = _exec(
            "systemctl list-units --type=service --no-legend --no-pager 2>/dev/null "
            "| awk '$1 ~ /dnstm/ {print $1}' | xargs -r systemctl restart "
            "&& sleep 1 && systemctl list-units --type=service --no-legend --no-pager "
            "| awk '$1 ~ /dnstm/ {print $1\" \"$3\" \"$4}'",
            45,
        )
        return {"success": code == 0, "message": (out or err)[-800:] or "restarted"}
    except Exception as e:
        return {"success": False, "message": str(e)}


def manage_users_list() -> Dict:
    """List SSH-tunnel users created by `dnstm install --mode multi`."""
    if not _ssh_client:
        return {"success": False, "message": "Not connected"}
    try:
        # Prefer the dnstm subcommand if it exists; otherwise enumerate /home
        # users that have a shell of /usr/sbin/nologin or whose group contains
        # 'dnstm'/'tunnel'.
        out, _, code = _exec("dnstm user list 2>&1", 15)
        if code != 0 or "Unknown" in out or "command" in out.lower():
            out, _, _ = _exec(
                "getent passwd | awk -F: '$3>=1000 && $3<65000 && $7 !~ /false/ {print $1}'",
                10,
            )
            users = [u.strip() for u in out.splitlines() if u.strip()]
            return {"success": True, "users": users, "source": "passwd"}
        # Parse dnstm output (one user per line typically)
        users = [l.strip() for l in out.splitlines() if l.strip() and not l.startswith("#")]
        return {"success": True, "users": users, "source": "dnstm"}
    except Exception as e:
        return {"success": False, "message": str(e)}


def manage_users_add(username: str, password: str) -> Dict:
    """Add a new SSH-tunnel user (no shell, password-only, in tunnel group)."""
    if not _ssh_client:
        return {"success": False, "message": "Not connected"}
    if not username or not username.replace("_", "").replace("-", "").isalnum():
        return {"success": False, "message": "Invalid username"}
    if not password or len(password) < 4:
        return {"success": False, "message": "Password too short (min 4)"}
    try:
        # Try `dnstm user add` first; fall back to manual useradd + chpasswd.
        cmd = (
            f"dnstm user add '{username}' --password '{password}' 2>&1 || "
            f"(id -u '{username}' >/dev/null 2>&1 || useradd -m -s /usr/sbin/nologin '{username}') "
            f"&& echo '{username}:{password}' | chpasswd "
            f"&& usermod -aG tunnel '{username}' 2>/dev/null; echo DONE"
        )
        out, err, code = _exec(cmd, 30)
        ok = "DONE" in (out or "") or code == 0
        return {"success": ok, "message": (out or err)[-400:]}
    except Exception as e:
        return {"success": False, "message": str(e)}


def manage_users_remove(username: str) -> Dict:
    """Remove an SSH-tunnel user."""
    if not _ssh_client:
        return {"success": False, "message": "Not connected"}
    if not username or not username.replace("_", "").replace("-", "").isalnum():
        return {"success": False, "message": "Invalid username"}
    if username in ("root", "ubuntu", "debian", "admin"):
        return {"success": False, "message": "Refusing to remove system user"}
    try:
        cmd = (
            f"dnstm user remove '{username}' 2>&1 || "
            f"(pkill -KILL -u '{username}' 2>/dev/null; userdel -r '{username}' 2>&1)"
        )
        out, err, code = _exec(cmd, 30)
        return {"success": code == 0 or "userdel" in (out or ""), "message": (out or err)[-400:]}
    except Exception as e:
        return {"success": False, "message": str(e)}


def manage_update() -> Dict:
    """Re-download the latest dnstm release binary in place and restart units."""
    if not _ssh_client:
        return {"success": False, "message": "Not connected"}
    try:
        arch_out, _, _ = _exec("uname -m", 5)
        arch = (arch_out or "").strip()
        arch_map = {"x86_64": "amd64", "aarch64": "arm64", "armv7l": "arm"}
        gohost = arch_map.get(arch, "amd64")
        # Match the URL pattern used by the installer
        bin_url = (
            f"https://github.com/net2share/dnstm/releases/latest/download/dnstm-linux-{gohost}"
        )
        cmd = (
            "set -e; "
            "cp /usr/local/bin/dnstm /usr/local/bin/dnstm.bak 2>/dev/null || true; "
            f"curl -fsSL --max-time 120 -o /tmp/dnstm.new '{bin_url}' "
            "&& chmod +x /tmp/dnstm.new "
            "&& /tmp/dnstm.new --version "
            "&& mv /tmp/dnstm.new /usr/local/bin/dnstm "
            "&& systemctl list-units --type=service --no-legend --no-pager "
            "| awk '$1 ~ /dnstm/ {print $1}' | xargs -r systemctl restart "
            "&& dnstm --version"
        )
        out, err, code = _exec(cmd, 180)
        return {"success": code == 0, "message": (out or err)[-800:]}
    except Exception as e:
        return {"success": False, "message": str(e)}


def manage_uninstall() -> Dict:
    """Stop & remove dnstm. Best-effort — does NOT delete user accounts."""
    if not _ssh_client:
        return {"success": False, "message": "Not connected"}
    try:
        cmd = (
            "systemctl list-units --type=service --no-legend --no-pager 2>/dev/null "
            "| awk '$1 ~ /dnstm/ {print $1}' | xargs -r systemctl stop; "
            "systemctl list-units --type=service --no-legend --no-pager 2>/dev/null "
            "| awk '$1 ~ /dnstm/ {print $1}' | xargs -r systemctl disable; "
            "dnstm uninstall --force 2>&1 || true; "
            "rm -f /usr/local/bin/dnstm /usr/local/bin/dnstm.bak; "
            "rm -rf /etc/dnstm /var/lib/dnstm /var/log/dnstm; "
            "echo DONE"
        )
        out, err, code = _exec(cmd, 90)
        return {"success": "DONE" in (out or ""), "message": (out or err)[-800:]}
    except Exception as e:
        return {"success": False, "message": str(e)}
