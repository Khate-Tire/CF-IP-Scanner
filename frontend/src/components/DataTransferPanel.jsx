import React, { useState, useRef } from 'react';
import { Download, Upload, Database, CheckCircle, ShieldCheck, Server, AlertTriangle } from 'lucide-react';
import { exportDatabase, importDatabase } from '../api';
import { toast } from 'react-hot-toast';
import { useTranslation } from '../i18n/LanguageContext';

export default function DataTransferPanel() {
    const { t } = useTranslation();
    const [exportPhase, setExportPhase] = useState({ active: false, progress: 0, text: '' });
    const [importPhase, setImportPhase] = useState({ active: false, progress: 0, text: '' });
    const [importStats, setImportStats] = useState(null);
    const fileInputRef = useRef(null);
    
    // Simulate progress steps for UX since single fetch request blocks
    const exportSteps = [
        { p: 8, t: "Initializing Database Connection..." },
        { p: 20, t: "Extracting 20,000+ Scan Results..." },
        { p: 35, t: "Fetching Live Community Configs..." },
        { p: 45, t: "Bundling Smart AI Recommendations..." },
        { p: 55, t: "Collecting Analytics & Geo Data..." },
        { p: 65, t: "Caching Country Domains & Bypasses..." },
        { p: 75, t: "Saving App Settings & Preferences..." },
        { p: 85, t: "Compressing Archive (Zlib)..." },
        { p: 95, t: "Applying AES-256-CBC Encryption..." }
    ];

    const importSteps = [
        { p: 8, t: "Validating AGDB01 Header Integrity..." },
        { p: 20, t: "Decrypting AES-256-CBC Payload..." },
        { p: 35, t: "Decompressing Zlib Archive..." },
        { p: 50, t: "Merging Scans into Local SQLite..." },
        { p: 60, t: "Restoring Working Configs..." },
        { p: 70, t: "Caching Analytics & Geo Data..." },
        { p: 80, t: "Restoring Bypass Profiles & Domains..." },
        { p: 90, t: "Applying Settings & Preferences..." },
        { p: 95, t: "Finalizing Offline Cache..." }
    ];

    const simulateProgress = (setPhaseState, steps) => {
        let currentStep = 0;
        const interval = setInterval(() => {
            if (currentStep < steps.length) {
                setPhaseState({ active: true, progress: steps[currentStep].p, text: steps[currentStep].t });
                currentStep++;
            }
        }, 1500); // update every 1.5s
        return interval;
    };

    const handleExport = async () => {
        setExportPhase({ active: true, progress: 0, text: 'Starting Export...' });
        const interval = simulateProgress(setExportPhase, exportSteps);
        
        try {
            const blob = await exportDatabase();
            clearInterval(interval);
            setExportPhase({ active: true, progress: 100, text: 'Finalizing File Download...' });
            
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `antigravity-backup-${Date.now()}.agdb`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            toast.success("Database exported securely!");
            
            setTimeout(() => setExportPhase({ active: false, progress: 0, text: '' }), 2000);
        } catch (error) {
            clearInterval(interval);
            toast.error("Failed to export database");
            setExportPhase({ active: false, progress: 0, text: '' });
        }
    };

    const handleImportClick = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.name.endsWith('.agdb')) {
            toast.error("Invalid file format. Only .agdb files are supported.");
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }

        const ok = window.confirm(
            `Importing "${file.name}" will MERGE its data into your local database.\n\n` +
            `Existing scan results, settings and discovered nodes may be overwritten.\n\n` +
            `Continue?`
        );
        if (!ok) {
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }

        setImportStats(null);
        setImportPhase({ active: true, progress: 0, text: 'Reading File...' });
        const interval = simulateProgress(setImportPhase, importSteps);

        try {
            const result = await importDatabase(file);
            clearInterval(interval);
            
            if (result.success) {
                setImportPhase({ active: true, progress: 100, text: 'Import Successfully Completed!' });
                setImportStats(result.stats);
                toast.success("Import successful!");
                setTimeout(() => setImportPhase({ active: false, progress: 0, text: '' }), 3000);
            } else {
                toast.error("Import failed: " + result.error);
                setImportPhase({ active: false, progress: 0, text: '' });
            }
        } catch (error) {
            clearInterval(interval);
            toast.error("Server error during import");
            setImportPhase({ active: false, progress: 0, text: '' });
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <div className="space-y-6 animate-fade-in relative max-w-4xl mx-auto">
            <div className="text-center space-y-3 mb-8">
                <div className="inline-flex items-center justify-center p-4 rounded-full bg-blue-500/10 border border-blue-500/30 mb-2">
                    <Database className="w-10 h-10 text-blue-400" />
                </div>
                <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                    {t('data.offlineSync', 'Offline Data Sync')}
                </h2>
                <p className="text-gray-400 text-sm max-w-lg mx-auto">
                    {t('data.syncDesc', 'Export your full database to share with others in restricted regions. The bundle is compressed and AES-encrypted, keeping your data completely unreadable to anyone outside of the Antigravity App.')}
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* EXPORT SECTION */}
                <div className="bg-black/60 border border-white/10 rounded-2xl p-6 relative overflow-hidden group hover:border-blue-500/50 transition-colors">
                    <div className="absolute top-0 right-0 p-4">
                        <Upload className="w-24 h-24 text-blue-500/5 rotate-180 group-hover:text-blue-500/10 group-hover:scale-110 transition-all duration-500" />
                    </div>
                    
                    <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                        <Download className="w-5 h-5 text-blue-400" />
                        {t('data.exportDb', 'Export Database')}
                    </h3>
                    <p className="text-gray-400 text-sm mb-6 pr-8">
                        {t('data.exportDesc', 'Bundle ALL app data — scans, configs, analytics, settings, bypass profiles, and recommendations — into a fully encrypted .agdb file for complete offline use.')}
                    </p>

                    <button
                        onClick={handleExport}
                        disabled={exportPhase.active}
                        className={`w-full py-4 px-6 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all ${
                            exportPhase.active 
                                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30 cursor-not-allowed' 
                                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)]'
                        }`}
                    >
                        {exportPhase.active ? (
                            <>
                                <Database className="w-5 h-5 animate-bounce" />
                                {t('data.packaging', 'Packaging...')}
                            </>
                        ) : (
                            <>
                                <Download className="w-5 h-5" />
                                {t('data.downloadBundle', 'Download .agdb Bundle')}
                            </>
                        )}
                    </button>
                    {exportPhase.active && (
                        <div className="mt-6 flex flex-col items-center">
                            <span className="text-blue-400 text-xs font-mono mb-2 animate-pulse">{exportPhase.text} {exportPhase.progress}%</span>
                            <div className="w-full bg-blue-900/30 rounded-full h-1.5 overflow-hidden">
                                <div className="bg-blue-500 h-1.5 transition-all duration-500" style={{ width: `${exportPhase.progress}%` }}></div>
                            </div>
                        </div>
                    )}
                    
                    {!exportPhase.active && (
                        <div className="mt-4 flex items-center gap-2 text-xs text-green-400/80 bg-green-400/10 p-2 rounded justify-center border border-green-400/20">
                            <ShieldCheck className="w-4 h-4" />
                            {t('data.encrypted', 'AES-256 Encrypted & ZLib Compressed')}
                        </div>
                    )}
                </div>

                {/* IMPORT SECTION */}
                <div className="bg-black/60 border border-white/10 rounded-2xl p-6 relative overflow-hidden group hover:border-purple-500/50 transition-colors">
                    <div className="absolute top-0 right-0 p-4">
                        <Database className="w-24 h-24 text-purple-500/5 group-hover:text-purple-500/10 group-hover:scale-110 transition-all duration-500" />
                    </div>
                    
                    <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                        <Upload className="w-5 h-5 text-purple-400" />
                        {t('data.importDb', 'Import Database')}
                    </h3>
                    <p className="text-gray-400 text-sm mb-6 pr-8">
                        {t('data.importDesc', 'Select a shared .agdb file to populate your app locally. Great for totally offline censored environments.')}
                    </p>

                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileChange} 
                        accept=".agdb" 
                        className="hidden" 
                    />

                    <button
                        onClick={handleImportClick}
                        disabled={importPhase.active}
                        className={`w-full py-4 px-6 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all ${
                            importPhase.active 
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30 cursor-not-allowed' 
                                : 'bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_20px_rgba(168,85,247,0.3)] hover:shadow-[0_0_30px_rgba(168,85,247,0.5)]'
                        }`}
                    >
                        {importPhase.active ? (
                            <>
                                <Server className="w-5 h-5 animate-pulse" />
                                {t('data.processing', 'Processing...')}
                            </>
                        ) : (
                            <>
                                <Upload className="w-5 h-5" />
                                {t('data.uploadFile', 'Upload .agdb File')}
                            </>
                        )}
                    </button>
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
                            <div className="text-purple-300 font-bold mb-2 flex items-center justify-center gap-1"><CheckCircle className="w-4 h-4"/> {t('data.syncComplete', 'Full Offline Sync Complete!')}</div>
                            <div className="grid grid-cols-3 gap-2 text-gray-400 font-mono">
                                {importStats.scan_results != null && <div className="text-center"><span className="block text-white text-lg">{importStats.scan_results}</span> {t('data.scans', 'Scans')}</div>}
                                {importStats.working_configs != null && <div className="text-center"><span className="block text-white text-lg">{importStats.working_configs}</span> {t('data.configs', 'Configs')}</div>}
                                {importStats.vpn_cf_configs != null && <div className="text-center"><span className="block text-white text-lg">{importStats.vpn_cf_configs}</span> {t('data.cfSub', 'CF Sub')}</div>}
                                {importStats.vpn_vanilla_configs != null && <div className="text-center"><span className="block text-white text-lg">{importStats.vpn_vanilla_configs}</span> {t('data.vanilla', 'Vanilla')}</div>}
                                {importStats.smart_recommendations != null && <div className="text-center"><span className="block text-white text-lg">{importStats.smart_recommendations}</span> {t('data.recs', 'Recs')}</div>}
                                {importStats.settings && <div className="text-center"><span className="block text-white text-lg">✓</span> {t('data.settings', 'Settings')}</div>}
                                {importStats.analytics && <div className="text-center"><span className="block text-white text-lg">✓</span> {t('data.analytics', 'Analytics')}</div>}
                                {importStats.geo_analytics && <div className="text-center"><span className="block text-white text-lg">✓</span> {t('data.geoData', 'Geo Data')}</div>}
                                {importStats.country_domains != null && <div className="text-center"><span className="block text-white text-lg">{importStats.country_domains}</span> {t('data.regions', 'Regions')}</div>}
                                {importStats.bypass_profiles != null && <div className="text-center"><span className="block text-white text-lg">{importStats.bypass_profiles}</span> {t('data.bypasses', 'Bypasses')}</div>}
                            </div>
                        </div>
                    )}
                    
                    {!importPhase.active && !importStats && (
                        <div className="mt-4 flex items-center gap-2 text-xs text-yellow-400/80 bg-yellow-400/10 p-2 rounded justify-center border border-yellow-400/20">
                            <AlertTriangle className="w-4 h-4" />
                            {t('data.overwriteWarn', 'Overwrites existing duplicate IPs silently')}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
