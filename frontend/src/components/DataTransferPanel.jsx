import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
    Download, Upload, Database, CheckCircle, ShieldCheck, Server,
    AlertTriangle, Eye, EyeOff, Lock, Unlock, FileSearch, Camera,
    History, Trash2, RefreshCw, Settings, FileDown, FileUp, Layers,
    KeyRound, Sparkles, ListChecks
} from 'lucide-react';
import {
    exportDatabase, importDatabase, previewBackup,
    listBackupSections, listSnapshots, createSnapshot, downloadSnapshot,
    deleteSnapshot, importHistory
} from '../api';
import { toast } from 'react-hot-toast';
import { useTranslation } from '../i18n/LanguageContext';

const fmtBytes = (b) => {
    if (!b && b !== 0) return '—';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(2)} MB`;
};

export default function DataTransferPanel() {
    const { t } = useTranslation();

    // ---------- state ----------
    const [tab, setTab] = useState('export'); // export | import | snapshots | history
    const [sections, setSections] = useState([]); // [{key,label}]
    const [selectedSections, setSelectedSections] = useState(new Set());
    const [passphrase, setPassphrase] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [scanLimit, setScanLimit] = useState(50000);

    const [exportPhase, setExportPhase] = useState({ active: false, progress: 0, text: '' });
    const [importPhase, setImportPhase] = useState({ active: false, progress: 0, text: '' });
    const [importStats, setImportStats] = useState(null);
    const [previewData, setPreviewData] = useState(null);
    const [snapshots, setSnapshots] = useState([]);
    const [history, setHistory] = useState([]);
    const [pendingFile, setPendingFile] = useState(null);

    const fileInputRef = useRef(null);
    const previewInputRef = useRef(null);

    // ---------- progress simulation ----------
    const exportSteps = [
        { p: 8, t: t('data.steps.init', 'Initializing Database Connection...') },
        { p: 18, t: t('data.steps.scans', 'Extracting Scan Results...') },
        { p: 28, t: t('data.steps.live', 'Fetching Live Community Configs...') },
        { p: 38, t: t('data.steps.recs', 'Bundling Smart AI Recommendations...') },
        { p: 48, t: t('data.steps.analytics', 'Collecting Analytics & Geo Data...') },
        { p: 58, t: t('data.steps.bypasses', 'Caching Country Domains & Bypasses...') },
        { p: 66, t: t('data.steps.tunnels', 'Adding Tunnel Deployments & WARP Endpoints...') },
        { p: 74, t: t('data.steps.settings', 'Saving Settings & Subscriptions...') },
        { p: 82, t: t('data.steps.manifest', 'Building SHA-256 Integrity Manifest...') },
        { p: 90, t: t('data.steps.compress', 'Compressing Archive (Zlib L9)...') },
        { p: 96, t: t('data.steps.encrypt', 'Applying AES-256 + HMAC...') },
    ];
    const importSteps = [
        { p: 8, t: t('data.steps.header', 'Validating AGDB Header & Integrity...') },
        { p: 22, t: t('data.steps.decrypt', 'Decrypting Payload...') },
        { p: 38, t: t('data.steps.decompress', 'Decompressing Zlib Archive...') },
        { p: 52, t: t('data.steps.merge', 'Merging Scans into Local SQLite...') },
        { p: 64, t: t('data.steps.restoreCfg', 'Restoring Working Configs...') },
        { p: 74, t: t('data.steps.cache', 'Caching Analytics & Geo Data...') },
        { p: 82, t: t('data.steps.bypasses', 'Restoring Bypass Profiles & Domains...') },
        { p: 90, t: t('data.steps.applySettings', 'Applying Settings & Tunnel Deployments...') },
        { p: 96, t: t('data.steps.finalize', 'Finalizing Offline Cache...') },
    ];
    const simulateProgress = (setPhaseState, steps) => {
        let i = 0;
        const id = setInterval(() => {
            if (i < steps.length) { setPhaseState({ active: true, progress: steps[i].p, text: steps[i].t }); i++; }
        }, 1200);
        return id;
    };

    // ---------- bootstrap ----------
    useEffect(() => {
        listBackupSections().then(r => {
            const list = r?.sections || [];
            setSections(list);
            setSelectedSections(new Set(list.map(s => s.key)));
        }).catch(() => { });
        refreshSnapshots();
        refreshHistory();
    }, []);

    const refreshSnapshots = async () => {
        try { const r = await listSnapshots(); setSnapshots(r?.snapshots || []); } catch { }
    };
    const refreshHistory = async () => {
        try { const r = await importHistory(); setHistory(r?.history || []); } catch { }
    };

    // ---------- helpers ----------
    const allSelected = sections.length > 0 && selectedSections.size === sections.length;
    const toggleSection = (key) => {
        const next = new Set(selectedSections);
        next.has(key) ? next.delete(key) : next.add(key);
        setSelectedSections(next);
    };
    const toggleAll = () => {
        setSelectedSections(allSelected ? new Set() : new Set(sections.map(s => s.key)));
    };
    const sectionsParam = useMemo(() => {
        if (allSelected) return undefined;
        return Array.from(selectedSections);
    }, [allSelected, selectedSections]);

    // ---------- export ----------
    const handleExport = async () => {
        if (selectedSections.size === 0) {
            toast.error(t('data.errSelect', 'Select at least one section to export'));
            return;
        }
        setExportPhase({ active: true, progress: 0, text: t('data.starting', 'Starting Export...') });
        const id = simulateProgress(setExportPhase, exportSteps);
        try {
            const blob = await exportDatabase({ sections: sectionsParam, passphrase: passphrase || undefined, scanLimit });
            clearInterval(id);
            setExportPhase({ active: true, progress: 100, text: t('data.steps.download', 'Finalizing File Download...') });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `antigravity-backup-${Date.now()}.agdb`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            toast.success(t('data.exportOk', 'Database exported securely!'));
            setTimeout(() => setExportPhase({ active: false, progress: 0, text: '' }), 1800);
        } catch (e) {
            clearInterval(id);
            toast.error(t('data.exportFail', 'Failed to export database'));
            setExportPhase({ active: false, progress: 0, text: '' });
        }
    };

    // ---------- preview ----------
    const handlePreview = async (file) => {
        if (!file) return;
        try {
            const r = await previewBackup(file, { passphrase: passphrase || undefined });
            if (r?.success) {
                setPreviewData({ file, ...r.preview });
                setPendingFile(file);
                toast.success(t('data.previewOk', 'Preview ready'));
            } else {
                toast.error(r?.error || t('data.previewFail', 'Preview failed (wrong passphrase?)'));
                setPreviewData(null);
            }
        } catch (e) {
            toast.error(t('data.previewFail', 'Preview failed'));
            setPreviewData(null);
        }
    };

    // ---------- import ----------
    const handleImportFile = async (file) => {
        if (!file) return;
        if (!file.name.endsWith('.agdb')) {
            toast.error(t('data.invalidFormat', 'Invalid format. Only .agdb files supported.'));
            return;
        }
        setPendingFile(file);
        await handlePreview(file); // auto-preview on selection
    };

    const handleConfirmImport = async () => {
        if (!pendingFile) return;
        const ok = window.confirm(
            t('data.confirmImport', 'Importing "{name}" will MERGE its data into your local database. Continue?', { name: pendingFile.name })
        );
        if (!ok) return;
        setImportStats(null);
        setImportPhase({ active: true, progress: 0, text: t('data.reading', 'Reading File...') });
        const id = simulateProgress(setImportPhase, importSteps);
        try {
            const result = await importDatabase(pendingFile, {
                passphrase: passphrase || undefined,
                sections: sectionsParam,
            });
            clearInterval(id);
            if (result.success) {
                setImportPhase({ active: true, progress: 100, text: t('data.importDone', 'Import Successfully Completed!') });
                setImportStats(result.stats);
                toast.success(t('data.importOk', 'Import successful!'));
                setTimeout(() => setImportPhase({ active: false, progress: 0, text: '' }), 2400);
                refreshHistory();
                setPendingFile(null);
                setPreviewData(null);
            } else {
                toast.error((t('data.importFail', 'Import failed: ')) + (result.error || ''));
                setImportPhase({ active: false, progress: 0, text: '' });
            }
        } catch (e) {
            clearInterval(id);
            toast.error(t('data.serverErr', 'Server error during import'));
            setImportPhase({ active: false, progress: 0, text: '' });
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // ---------- snapshots ----------
    const handleCreateSnapshot = async () => {
        const label = window.prompt(t('data.snapLabel', 'Snapshot label (optional):'), '');
        try {
            const r = await createSnapshot({
                label: label || undefined,
                passphrase: passphrase || undefined,
                sections: sectionsParam ? sectionsParam.join(',') : undefined,
                scan_limit: scanLimit,
            });
            if (r?.success) {
                toast.success(t('data.snapCreated', 'Snapshot created'));
                refreshSnapshots();
            } else {
                toast.error(r?.error || t('data.snapFail', 'Snapshot failed'));
            }
        } catch {
            toast.error(t('data.snapFail', 'Snapshot failed'));
        }
    };
    const handleDownloadSnapshot = async (name) => {
        try {
            const blob = await downloadSnapshot(name);
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = name;
            document.body.appendChild(a); a.click();
            window.URL.revokeObjectURL(url); document.body.removeChild(a);
        } catch { toast.error(t('data.dlFail', 'Download failed')); }
    };
    const handleDeleteSnapshot = async (name) => {
        if (!window.confirm(t('data.delSnap', 'Delete snapshot {name}?', { name }))) return;
        try {
            const r = await deleteSnapshot(name);
            if (r?.success) { toast.success(t('data.deleted', 'Deleted')); refreshSnapshots(); }
            else toast.error(r?.error || 'Failed');
        } catch { toast.error(t('data.delFail', 'Delete failed')); }
    };

    // ---------- render ----------
    const TabBtn = ({ id, icon: Icon, label }) => (
        <button
            onClick={() => setTab(id)}
            className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all ${tab === id
                ? 'bg-blue-600/30 text-blue-200 border border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.25)]'
                : 'bg-black/40 text-gray-400 border border-white/5 hover:border-white/20 hover:text-white'}`}
        >
            <Icon className="w-4 h-4" /> {label}
        </button>
    );

    return (
        <div className="space-y-6 animate-fade-in relative max-w-5xl mx-auto">
            {/* HEADER */}
            <div className="text-center space-y-3 mb-6">
                <div className="inline-flex items-center justify-center p-4 rounded-full bg-blue-500/10 border border-blue-500/30 mb-2">
                    <Database className="w-10 h-10 text-blue-400" />
                </div>
                <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                    {t('data.offlineSync', 'Offline Data Sync')}
                </h2>
                <p className="text-gray-400 text-sm max-w-2xl mx-auto">
                    {t('data.syncDescPro', 'Powerful, fully-offline backup engine: 17 data sections, optional passphrase encryption (AES-256-GCM + PBKDF2), SHA-256 integrity manifest, dry-run preview, server-side snapshots, and selective restore.')}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
                    <span className="px-2 py-1 rounded bg-green-500/10 border border-green-500/30 text-green-300 inline-flex items-center gap-1"><ShieldCheck className="w-3 h-3" />AES-256</span>
                    <span className="px-2 py-1 rounded bg-purple-500/10 border border-purple-500/30 text-purple-300 inline-flex items-center gap-1"><KeyRound className="w-3 h-3" />PBKDF2</span>
                    <span className="px-2 py-1 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 inline-flex items-center gap-1"><Layers className="w-3 h-3" />Manifest</span>
                    <span className="px-2 py-1 rounded bg-pink-500/10 border border-pink-500/30 text-pink-300 inline-flex items-center gap-1"><Sparkles className="w-3 h-3" />Selective</span>
                    <span className="px-2 py-1 rounded bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 inline-flex items-center gap-1"><Camera className="w-3 h-3" />Snapshots</span>
                </div>
            </div>

            {/* TABS */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-black/30 p-1.5 rounded-xl border border-white/10">
                <TabBtn id="export" icon={FileDown} label={t('data.tab.export', 'Export')} />
                <TabBtn id="import" icon={FileUp} label={t('data.tab.import', 'Import')} />
                <TabBtn id="snapshots" icon={Camera} label={t('data.tab.snapshots', 'Snapshots')} />
                <TabBtn id="history" icon={History} label={t('data.tab.history', 'History')} />
            </div>

            {/* SHARED: passphrase + sections (export & import only) */}
            {(tab === 'export' || tab === 'import') && (
                <div className="bg-black/40 border border-white/10 rounded-xl p-4 space-y-4">
                    {/* Passphrase */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold text-gray-300 flex items-center gap-2">
                                <Lock className="w-3.5 h-3.5 text-purple-400" />
                                {t('data.passphrase', 'Passphrase (optional)')}
                            </label>
                            <span className="text-[10px] text-gray-500">
                                {passphrase ? t('data.aesGcm', 'AGDB03 · AES-256-GCM · PBKDF2') : t('data.aesCbc', 'AGDB02 · env-key + HMAC')}
                            </span>
                        </div>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <input
                                    type={showPass ? 'text' : 'password'}
                                    value={passphrase}
                                    onChange={(e) => setPassphrase(e.target.value)}
                                    placeholder={t('data.passPh', 'Leave empty to use built-in encryption key')}
                                    className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white pr-10 focus:border-purple-500/60 focus:outline-none"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPass(!showPass)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                                >
                                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                            {passphrase && (
                                <button
                                    onClick={() => setPassphrase('')}
                                    className="px-3 py-2 rounded-lg bg-black/60 border border-white/10 text-gray-400 hover:text-white text-xs"
                                >
                                    <Unlock className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Sections */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold text-gray-300 flex items-center gap-2">
                                <ListChecks className="w-3.5 h-3.5 text-cyan-400" />
                                {t('data.sectionsTitle', 'Sections to include')} ({selectedSections.size}/{sections.length})
                            </label>
                            <button onClick={toggleAll} className="text-[11px] text-cyan-400 hover:text-cyan-300">
                                {allSelected ? t('data.deselectAll', 'Deselect all') : t('data.selectAll', 'Select all')}
                            </button>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                            {sections.map(s => (
                                <label key={s.key} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs border transition-all ${selectedSections.has(s.key)
                                    ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-100'
                                    : 'bg-black/40 border-white/5 text-gray-400 hover:border-white/20'}`}>
                                    <input
                                        type="checkbox"
                                        checked={selectedSections.has(s.key)}
                                        onChange={() => toggleSection(s.key)}
                                        className="accent-cyan-500"
                                    />
                                    <span className="truncate">{s.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Scan limit */}
                    {tab === 'export' && (
                        <div>
                            <label className="text-xs font-semibold text-gray-300 flex items-center gap-2 mb-1.5">
                                <Settings className="w-3.5 h-3.5 text-blue-400" />
                                {t('data.scanLimit', 'Scan rows cap')}: <span className="text-blue-300 font-mono">{scanLimit.toLocaleString()}</span>
                            </label>
                            <input
                                type="range" min="1000" max="200000" step="1000"
                                value={scanLimit}
                                onChange={(e) => setScanLimit(Number(e.target.value))}
                                className="w-full accent-blue-500"
                            />
                        </div>
                    )}
                </div>
            )}

            {/* EXPORT TAB */}
            {tab === 'export' && (
                <div className="bg-black/60 border border-white/10 rounded-2xl p-6 relative overflow-hidden group hover:border-blue-500/50 transition-colors">
                    <div className="absolute top-0 right-0 p-4">
                        <Upload className="w-24 h-24 text-blue-500/5 rotate-180 group-hover:text-blue-500/10 group-hover:scale-110 transition-all duration-500" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                        <Download className="w-5 h-5 text-blue-400" />
                        {t('data.exportDb', 'Export Database')}
                    </h3>
                    <p className="text-gray-400 text-sm mb-6 pr-8">
                        {t('data.exportDescPro', 'Bundle EVERYTHING — scans, configs, analytics, settings, bypass profiles, recommendations, tunnel deployments, DNS history, WARP endpoints, subscriptions and more — into a fully encrypted .agdb file.')}
                    </p>
                    <button
                        onClick={handleExport}
                        disabled={exportPhase.active}
                        className={`w-full py-4 px-6 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all ${exportPhase.active
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30 cursor-not-allowed'
                            : 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)]'}`}
                    >
                        {exportPhase.active
                            ? (<><Database className="w-5 h-5 animate-bounce" />{t('data.packaging', 'Packaging...')}</>)
                            : (<><Download className="w-5 h-5" />{t('data.downloadBundle', 'Download .agdb Bundle')}</>)}
                    </button>
                    {exportPhase.active && (
                        <div className="mt-6 flex flex-col items-center">
                            <span className="text-blue-400 text-xs font-mono mb-2 animate-pulse">{exportPhase.text} {exportPhase.progress}%</span>
                            <div className="w-full bg-blue-900/30 rounded-full h-1.5 overflow-hidden">
                                <div className="bg-blue-500 h-1.5 transition-all duration-500" style={{ width: `${exportPhase.progress}%` }}></div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* IMPORT TAB */}
            {tab === 'import' && (
                <div className="bg-black/60 border border-white/10 rounded-2xl p-6 relative overflow-hidden group hover:border-purple-500/50 transition-colors">
                    <div className="absolute top-0 right-0 p-4">
                        <Database className="w-24 h-24 text-purple-500/5 group-hover:text-purple-500/10 group-hover:scale-110 transition-all duration-500" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                        <Upload className="w-5 h-5 text-purple-400" />
                        {t('data.importDb', 'Import Database')}
                    </h3>
                    <p className="text-gray-400 text-sm mb-4 pr-8">
                        {t('data.importDescPro', 'Select a .agdb file. We auto-decrypt and show a manifest preview before any data is written. Choose which sections to restore.')}
                    </p>

                    <input
                        type="file" ref={fileInputRef} accept=".agdb" className="hidden"
                        onChange={(e) => handleImportFile(e.target.files[0])}
                    />

                    {!pendingFile && (
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={importPhase.active}
                            className="w-full py-4 px-6 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_20px_rgba(168,85,247,0.3)] hover:shadow-[0_0_30px_rgba(168,85,247,0.5)]"
                        >
                            <FileSearch className="w-5 h-5" />
                            {t('data.selectFile', 'Select .agdb File')}
                        </button>
                    )}

                    {/* Preview panel */}
                    {previewData && (
                        <div className="mt-4 bg-black/40 rounded-xl border border-purple-500/30 p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-purple-200 font-semibold">
                                    <Eye className="w-4 h-4" />
                                    {t('data.previewTitle', 'Bundle Preview')}
                                </div>
                                <span className="text-[10px] font-mono text-gray-400">
                                    {previewData.format} · {fmtBytes(previewData.size_bytes)}
                                </span>
                            </div>
                            <div className="text-[11px] text-gray-400 grid grid-cols-2 gap-x-4 gap-y-1">
                                <div>{t('data.bundleVersion', 'Bundle version')}: <span className="text-white font-mono">{previewData.manifest?.bundle_version}</span></div>
                                <div>{t('data.exportedAt', 'Exported')}: <span className="text-white font-mono">{previewData.manifest?.exported_at?.slice(0, 19).replace('T', ' ')}</span></div>
                            </div>
                            <div className="max-h-48 overflow-y-auto bg-black/40 rounded p-2 font-mono text-[10px]">
                                {Object.entries(previewData.manifest?.sections || {}).map(([k, v]) => (
                                    <div key={k} className="flex justify-between py-0.5 border-b border-white/5">
                                        <span className={selectedSections.has(k) ? 'text-purple-200' : 'text-gray-500'}>
                                            {selectedSections.has(k) ? '✓' : '○'} {k}
                                        </span>
                                        <span className="text-gray-400">
                                            {v.count} · {fmtBytes(v.bytes)} · <span className="text-gray-600">{(v.sha256 || '').slice(0, 8)}</span>
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleConfirmImport}
                                    disabled={importPhase.active || selectedSections.size === 0}
                                    className="flex-1 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2"
                                >
                                    <Upload className="w-4 h-4" />
                                    {t('data.restoreSelected', 'Restore Selected')}
                                </button>
                                <button
                                    onClick={() => { setPendingFile(null); setPreviewData(null); }}
                                    className="px-4 py-2.5 rounded-lg bg-black/60 border border-white/10 text-gray-300 hover:border-white/20 text-sm"
                                >
                                    {t('common.cancel', 'Cancel')}
                                </button>
                            </div>
                        </div>
                    )}

                    {importPhase.active && (
                        <div className="mt-6 flex flex-col items-center">
                            <span className="text-purple-400 text-xs font-mono mb-2 animate-pulse">{importPhase.text} {importPhase.progress}%</span>
                            <div className="w-full bg-purple-900/30 rounded-full h-1.5 overflow-hidden">
                                <div className="bg-purple-500 h-1.5 transition-all duration-500" style={{ width: `${importPhase.progress}%` }}></div>
                            </div>
                        </div>
                    )}

                    {!importPhase.active && importStats && (
                        <div className="mt-4 text-xs bg-purple-500/10 p-3 rounded border border-purple-500/20">
                            <div className="text-purple-300 font-bold mb-2 flex items-center justify-center gap-1">
                                <CheckCircle className="w-4 h-4" /> {t('data.syncComplete', 'Full Offline Sync Complete!')}
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-gray-400 font-mono">
                                {Object.entries(importStats).filter(([k]) => k !== '_manifest').map(([k, v]) => (
                                    <div key={k} className="text-center bg-black/30 rounded p-1.5">
                                        <span className="block text-white text-base">{typeof v === 'number' ? v : '✓'}</span>
                                        <span className="text-[10px]">{k}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {!importPhase.active && !importStats && !pendingFile && (
                        <div className="mt-4 flex items-center gap-2 text-xs text-yellow-400/80 bg-yellow-400/10 p-2 rounded justify-center border border-yellow-400/20">
                            <AlertTriangle className="w-4 h-4" />
                            {t('data.overwriteWarn', 'Overwrites existing duplicate IPs silently')}
                        </div>
                    )}
                </div>
            )}

            {/* SNAPSHOTS TAB */}
            {tab === 'snapshots' && (
                <div className="bg-black/60 border border-white/10 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xl font-bold text-white flex items-center gap-2">
                            <Camera className="w-5 h-5 text-yellow-400" />
                            {t('data.snapshots', 'Server-side Snapshots')}
                        </h3>
                        <div className="flex gap-2">
                            <button
                                onClick={refreshSnapshots}
                                className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-gray-300 hover:border-white/20 text-xs flex items-center gap-1"
                            >
                                <RefreshCw className="w-3.5 h-3.5" /> {t('common.refresh', 'Refresh')}
                            </button>
                            <button
                                onClick={handleCreateSnapshot}
                                className="px-3 py-1.5 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white text-xs font-semibold flex items-center gap-1"
                            >
                                <Camera className="w-3.5 h-3.5" /> {t('data.snapNow', 'Take Snapshot Now')}
                            </button>
                        </div>
                    </div>
                    <p className="text-xs text-gray-400">
                        {t('data.snapDesc', 'Snapshots are stored locally under your app data folder. Up to 20 are kept; older ones are pruned automatically.')}
                    </p>
                    {snapshots.length === 0 ? (
                        <div className="text-center text-gray-500 text-sm py-8 border border-dashed border-white/10 rounded-xl">
                            {t('data.noSnap', 'No snapshots yet — take one now to get a rolling backup history.')}
                        </div>
                    ) : (
                        <div className="space-y-1.5 max-h-96 overflow-y-auto">
                            {snapshots.map(s => (
                                <div key={s.name} className="flex items-center justify-between bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs">
                                    <div className="font-mono truncate flex-1 text-gray-200">{s.name}</div>
                                    <div className="text-gray-500 mx-3 hidden md:block">{(s.modified || '').slice(0, 19).replace('T', ' ')}</div>
                                    <div className="text-gray-400 mx-3 font-mono">{fmtBytes(s.size)}</div>
                                    <div className="flex gap-1.5">
                                        <button onClick={() => handleDownloadSnapshot(s.name)} className="p-1.5 rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30">
                                            <Download className="w-3.5 h-3.5" />
                                        </button>
                                        <button onClick={() => handleDeleteSnapshot(s.name)} className="p-1.5 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30">
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* HISTORY TAB */}
            {tab === 'history' && (
                <div className="bg-black/60 border border-white/10 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xl font-bold text-white flex items-center gap-2">
                            <History className="w-5 h-5 text-pink-400" />
                            {t('data.importHistory', 'Import History')}
                        </h3>
                        <button
                            onClick={refreshHistory}
                            className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-gray-300 hover:border-white/20 text-xs flex items-center gap-1"
                        >
                            <RefreshCw className="w-3.5 h-3.5" /> {t('common.refresh', 'Refresh')}
                        </button>
                    </div>
                    {history.length === 0 ? (
                        <div className="text-center text-gray-500 text-sm py-8 border border-dashed border-white/10 rounded-xl">
                            {t('data.noHistory', 'No imports recorded yet.')}
                        </div>
                    ) : (
                        <div className="space-y-2 max-h-96 overflow-y-auto">
                            {history.map((h, i) => (
                                <div key={i} className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="font-mono text-pink-200 truncate">{h.filename}</span>
                                        <span className="text-gray-500">{(h.imported_at || '').slice(0, 19).replace('T', ' ')}</span>
                                    </div>
                                    <div className="text-gray-500 font-mono text-[10px]">
                                        {fmtBytes(h.size)} · {Array.isArray(h.sections) ? `${h.sections.length} sections` : 'all sections'}
                                    </div>
                                    {h.stats && (
                                        <div className="mt-1 text-[10px] text-gray-400 flex flex-wrap gap-1">
                                            {Object.entries(h.stats).map(([k, v]) => (
                                                <span key={k} className="px-1.5 py-0.5 rounded bg-white/5">
                                                    {k}: <span className="text-white">{typeof v === 'number' ? v : '✓'}</span>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
