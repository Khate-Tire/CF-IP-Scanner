# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 2.5.x   | ✅ Currently supported |
| < 2.0   | ❌ No longer supported |

## Reporting a Vulnerability

If you discover a security vulnerability in Antigravity IP Scanner, please report it responsibly.

### How to Report

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Send an email to **khatetire@proton.me** with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)
3. Or contact via Telegram: [@hossein_shiravani](https://t.me/hossein_shiravani)

### What to Expect

- **Acknowledgment** within 48 hours
- **Assessment** within 1 week
- **Fix** released as soon as possible for verified vulnerabilities

### Scope

The following are in scope:

- Backend API vulnerabilities (FastAPI server)
- Frontend XSS or injection risks
- Data leakage or privacy concerns
- Authentication/authorization bypass
- Supply chain vulnerabilities

### Out of Scope

- Vulnerabilities in third-party Xray-core binary (report upstream)
- Issues requiring physical access to the machine
- Social engineering attacks

## Security Best Practices for Users

1. **Enable TLS Verification** — Always enable "Strict TLS" in advanced settings to prevent MITM attacks
2. **Keep Updated** — Use the latest version for security patches
3. **Verify Downloads** — Only download from the official GitHub repository
4. **Config Privacy** — Your VLESS configs are processed locally and never uploaded

## Acknowledgments

We thank all security researchers who help keep this project safe. Contributors will be acknowledged in release notes (with permission).
