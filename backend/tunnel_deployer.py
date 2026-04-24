# Copyright (c) 2026 Taher AkbariSaeed
"""
DNS Tunnel Deployer — SSH-based server deployment for dnstm-setup.
Handles connection, pre-flight checks, DNS verification, deployment,
and config generation for Slipstream/DNSTT/NoizDNS/VayDNS tunnels.
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
            state.update(phase="Installing dnstm...", progress=20)
            state.log("Running dnstm install --mode multi...")
            try:
                _, _, dnstm_code = _exec("which dnstm", 5)
            except TimeoutError:
                dnstm_code = 1
            if dnstm_code != 0:
                # NOTE: upstream installers (install.sh / dnstm-setup.sh) read from
                # /dev/tty for confirmation prompts. Without a PTY this fails with:
                #   "/tmp/dnstm-install.sh: line 104: /dev/tty: No such device or address"
                # We work around it by:
                #   (a) wrapping with `script -qec '...' /dev/null` to allocate a pty
                #       (util-linux `script` ships on every supported distro), and
                #   (b) piping `yes ''` so any read accepts the default.
                # If `script` is missing we fall back to a `setsid` + here-doc form.
                install_ok = False

                # Installer #1: net2share/dnstm install.sh in --mode multi
                inst1 = (
                    "if command -v script >/dev/null 2>&1; then "
                    "  yes '' 2>/dev/null | script -qec "
                    "    \"bash /tmp/dnstm-install.sh install --mode multi\" /dev/null; "
                    "else "
                    "  yes '' 2>/dev/null | setsid bash /tmp/dnstm-install.sh install --mode multi; "
                    "fi"
                )
                try:
                    out, err, code = _exec(
                        "curl -fsSL --max-time 60 --connect-timeout 8 "
                        "https://raw.githubusercontent.com/net2share/dnstm/master/install.sh "
                        "-o /tmp/dnstm-install.sh && chmod +x /tmp/dnstm-install.sh && " + inst1 + " 2>&1 | tail -80",
                        timeout=300
                    )
                    state.log((out or err or '')[-800:] or f"installer #1 exit={code}")
                    if code == 0:
                        install_ok = True
                except TimeoutError as te:
                    state.log(f"installer #1 timed out: {te}", "warn")

                # Verify dnstm landed on PATH
                if install_ok:
                    try:
                        _, _, c2 = _exec("which dnstm", 5)
                        install_ok = (c2 == 0)
                    except TimeoutError:
                        install_ok = False

                # Fallback installer #2: bundled dnstm-setup.sh under a pty
                if not install_ok:
                    state.log("Installer #1 did not place dnstm on PATH — trying dnstm-setup.sh fallback...", "warn")
                    inst2 = (
                        "chmod +x /tmp/dnstm-setup.sh && "
                        "if command -v script >/dev/null 2>&1; then "
                        "  yes '' 2>/dev/null | script -qec "
                        "    \"DEBIAN_FRONTEND=noninteractive bash /tmp/dnstm-setup.sh\" /dev/null; "
                        "else "
                        "  yes '' 2>/dev/null | setsid bash /tmp/dnstm-setup.sh; "
                        "fi"
                    )
                    try:
                        out, err, code = _exec(inst2 + " 2>&1 | tail -80", timeout=360)
                        state.log((out or err or '')[-800:] or f"installer #2 exit={code}")
                    except TimeoutError as te:
                        state.log(f"installer #2 timed out: {te}", "warn")

                # Final verification — DO NOT proceed if dnstm is still missing.
                try:
                    out, _, c3 = _exec(
                        "which dnstm 2>/dev/null || command -v dnstm 2>/dev/null || "
                        "ls /usr/local/bin/dnstm 2>/dev/null || ls /usr/bin/dnstm 2>/dev/null || "
                        "ls /root/go/bin/dnstm 2>/dev/null",
                        5,
                    )
                except TimeoutError:
                    out, c3 = "", 1
                if c3 != 0 or not out:
                    state.update(
                        status="failed",
                        error=(
                            "dnstm install completed but the `dnstm` binary is not on PATH. "
                            "Common cause: the upstream installer needs an interactive prompt "
                            "or a missing prerequisite (curl/Go/apt). SSH into the VPS and run: "
                            "  bash /tmp/dnstm-setup.sh   "
                            "— answer the prompts manually, then click Deploy again."
                        ),
                    )
                    return
                # If found via ls fallback, ensure it's symlinked into PATH
                bin_path = out.splitlines()[0].strip()
                if bin_path and bin_path != "/usr/local/bin/dnstm":
                    try:
                        _exec(f"ln -sf {bin_path} /usr/local/bin/dnstm", 5)
                    except TimeoutError:
                        pass
                state.log(f"✓ dnstm installed at {bin_path}", "success")
            else:
                state.log("✓ dnstm already installed", "success")

            # Phase 4: Create tunnels
            state.update(phase="Creating tunnels...", progress=40)
            tunnel_configs = [
                ("slip1", "slipstream", "socks", f"t.{domain}"),
                ("dnstt1", "dnstt", "socks", f"d.{domain}"),
                ("noiz1", "noizdns", "socks", f"n.{domain}"),
                ("vay1", "vaydns", "socks", f"v.{domain}"),
                ("slip-ssh", "slipstream", "ssh", f"s.{domain}"),
                ("dnstt-ssh", "dnstt", "ssh", f"ds.{domain}"),
                ("noiz-ssh", "noizdns", "ssh", f"z.{domain}"),
                ("vay-ssh", "vaydns", "ssh", f"vz.{domain}"),
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
            for key_type in ["dnstt", "noizdns", "vaydns"]:
                out, _, _ = _exec(f"cat /etc/dnstm/keys/{key_type}/server.pub 2>/dev/null || echo ''", 5)
                if out.strip():
                    pubkeys[key_type] = out.strip()

            # Get share URLs
            share_urls = {}
            for tag, _, _, subdomain in tunnel_configs:
                out, _, code = _exec(f"dnstm tunnel share -t {tag} 2>/dev/null", 10)
                if code == 0 and out.strip():
                    share_urls[tag] = out.strip()

            # Build config output
            configs = {
                "domain": domain,
                "tunnels": tunnel_out,
                "pubkeys": pubkeys,
                "share_urls": share_urls,
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
