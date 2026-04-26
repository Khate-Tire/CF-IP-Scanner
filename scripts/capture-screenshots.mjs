// Playwright screenshot capture script for Antigravity IP Scanner.
//
// Captures the main app tabs at a consistent 1440x900 viewport and writes
// PNGs into docs/screenshots/. Run AFTER the dev servers are up:
//
//     # Terminal 1
//     python run_app.py            # backend on :8000 + Electron window
//   OR
//     cd backend && python main.py  # backend only
//
//     # Terminal 2 (if not using Electron)
//     cd frontend && npm run dev   # Vite dev server on :5173
//
//     # Terminal 3
//     node scripts/capture-screenshots.mjs
//
// Install Playwright once:
//     npm i -D playwright
//     npx playwright install chromium
//
// Optional flags:
//     --url=http://127.0.0.1:5173    Override frontend URL (default 5173)
//     --out=docs/screenshots          Output directory
//     --only=scanner,data,dnstunnel   Only capture these tabs
//     --width=1440 --height=900       Override viewport
//     --headed                        Show the browser while running

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const args = Object.fromEntries(
    process.argv.slice(2).map(a => {
        if (!a.startsWith('--')) return [a, true];
        const [k, ...rest] = a.replace(/^--/, '').split('=');
        return [k, rest.length ? rest.join('=') : true];
    })
);

const URL = args.url || 'http://localhost:5173';
const OUT = resolve(projectRoot, args.out || 'docs/screenshots');
const VIEWPORT = {
    width: parseInt(args.width || '1440', 10),
    height: parseInt(args.height || '900', 10),
};
const HEADED = !!args.headed;
const ONLY = args.only ? String(args.only).split(',').map(s => s.trim()) : null;

// Each entry: { id, file, tabLabel?, subAction?, waitFor? }
//   tabLabel  — visible text of the top-bar button to click
//   subAction — async (page) => {} for any extra navigation (sub-tabs, etc.)
//   waitFor   — selector to wait for after navigation, before snapping
const SHOTS = [
    { id: 'scanner',    file: 'scanner.png',    tabLabel: 'Scanner' },
    { id: 'analytics',  file: 'analytics.png',  tabLabel: 'Global Analytics' },
    { id: 'advanced',   file: 'advanced.png',   tabLabel: 'Advanced Bypasses' },
    { id: 'warp',       file: 'warp.png',       tabLabel: 'WARP Endpoints' },
    { id: 'about',      file: 'about.png',      tabLabel: 'About App' },
    {
        id: 'data-sync', file: 'data-sync.png', tabLabel: 'Data Sync',
        // Default opens on the Export tab — perfect for the README shot.
    },
    {
        id: 'dns-tunnel', file: 'dns-tunnel.png', tabLabel: 'DNS Tunnel',
        // DnsTunnelTab opens on the Deploy sub-tab by default, which is
        // exactly what the README placeholder asks for.
    },
];

async function main() {
    await mkdir(OUT, { recursive: true });
    console.log(`[shots] viewport=${VIEWPORT.width}x${VIEWPORT.height}  url=${URL}  out=${OUT}`);

    const browser = await chromium.launch({ headless: !HEADED });
    const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 2, // crisper README images
        colorScheme: 'dark',
    });

    // Force English locale so the tab text matches our SHOTS table even when
    // the user's last-used language was something else.
    await context.addInitScript(() => {
        try {
            // Real key used by frontend/src/i18n/LanguageContext.jsx:
            localStorage.setItem('app-lang', 'en');
            // Pre-tick "Route Location API & Discovery through System Proxy / VPN":
            localStorage.setItem('app-systemProxy', '1');
        } catch (_) { /* ignore */ }
    });

    const page = await context.newPage();
    page.on('pageerror', e => console.warn('[page error]', e.message));
    page.on('requestfailed', r => {
        const u = r.url();
        if (u.includes('127.0.0.1') || u.includes('localhost')) {
            console.warn('[req fail]', u, r.failure()?.errorText);
        }
    });

    try {
        await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
        console.error(`\n[fatal] Could not reach ${URL}.`);
        console.error('         Start the frontend with `cd frontend && npm run dev`,');
        console.error('         or pass --url=http://localhost:PORT if you use a different port.\n');
        await browser.close();
        process.exitCode = 1;
        return;
    }

    // Wait for the top nav to mount (any tab button visible).
    try {
        await page.waitForSelector('button:has-text("Scanner")', { timeout: 15000 });
    } catch {
        console.warn('[warn] Top nav not detected within 15s — capturing anyway.');
    }
    // Settle a touch for any post-mount toasts / banners.
    await page.waitForTimeout(800);

    let ok = 0, skipped = 0, failed = 0;
    for (const shot of SHOTS) {
        if (ONLY && !ONLY.includes(shot.id)) { skipped++; continue; }
        const dest = join(OUT, shot.file);
        try {
            if (shot.tabLabel) {
                const btn = page.locator(`button:has-text("${shot.tabLabel}")`).first();
                await btn.waitFor({ state: 'visible', timeout: 10000 });
                await btn.click();
                await page.waitForTimeout(900); // tab transition + lazy renders
            }
            if (shot.subAction) await shot.subAction(page);
            if (shot.waitFor) await page.waitForSelector(shot.waitFor, { timeout: 10000 });
            // Dismiss any react-hot-toast that might be on screen.
            await page.evaluate(() => {
                document.querySelectorAll('[id^="toast-"]').forEach(el => el.remove());
            });
            await page.screenshot({ path: dest, fullPage: false });
            console.log(`  ✓ ${shot.id.padEnd(12)} → ${dest}`);
            ok++;
        } catch (e) {
            console.error(`  ✗ ${shot.id.padEnd(12)} failed: ${e.message}`);
            failed++;
        }
    }

    await browser.close();
    console.log(`\n[done] captured=${ok} skipped=${skipped} failed=${failed}`);
    if (failed > 0) process.exitCode = 1;
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
