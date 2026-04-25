/* Copyright (c) 2026 Taher AkbariSaeed */
import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from '../i18n/LanguageContext';
import DeployWizard from './DeployWizard';
import DeployManage from './DeployManage';
import DnsOptimizer from './DnsOptimizer';
import ConfigLab from './ConfigLab';
import SpeedMatrix from './SpeedMatrix';
import { sendToConfigLab, sendToDeployWizard } from '../state/optimizerBridge';
import { tunnelHealth } from '../api';

export default function DnsTunnelTab({ onSendToAdvanced }) {
    const { t } = useTranslation();
    const [subTab, setSubTab] = useState('deploy');
    const [health, setHealth] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const check = async () => {
            const h = await tunnelHealth();
            if (!cancelled) setHealth(h);
        };
        check();
        const id = setInterval(check, 30000);
        return () => { cancelled = true; clearInterval(id); };
    }, []);

    const goToConfigLab = useCallback((payload) => {
        if (payload) sendToConfigLab(payload);
        setSubTab('lab');
    }, []);

    const goToDeployWizard = useCallback((payload) => {
        if (payload) sendToDeployWizard(payload);
        setSubTab('deploy');
    }, []);

    const goToOptimizer = useCallback(() => setSubTab('optimizer'), []);

    return (
        <div className="space-y-6 animate-in fade-in zoom-in duration-500">
            {health && health.ok === false && (
                <div className="bg-red-500/10 border border-red-500/40 text-red-200 rounded-2xl p-4 flex items-start gap-3">
                    <svg className="w-6 h-6 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3L13.74 4a2 2 0 00-3.48 0L3.34 16a2 2 0 001.73 3z"/>
                    </svg>
                    <div className="flex-1 text-sm">
                        <div className="font-bold mb-1">{t('dnsTunnel.healthFail', 'DNS Tunnel backend is degraded')}</div>
                        <div className="opacity-80">
                            {t('dnsTunnel.missingDeps', 'Missing Python packages')}:{' '}
                            <span className="font-mono text-red-300">
                                {[...(health.deployer?.missing || []), ...(health.scanner?.missing || [])].join(', ') || (health.missing || []).join(', ') || 'unknown'}
                            </span>
                        </div>
                        <div className="opacity-70 mt-1 text-xs">
                            {health.hint || t('dnsTunnel.fixHint', 'Run: pip install -r backend/requirements.txt and restart the backend.')}
                        </div>
                    </div>
                </div>
            )}
            {/* Sub-tab Navigation */}
            <div className="flex justify-center">
                <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-1.5 flex gap-1 shadow-[0_4px_30px_rgba(0,0,0,0.3)]">
                    <button
                        onClick={() => setSubTab('deploy')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${subTab === 'deploy'
                            ? 'bg-emerald-500/15 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.3)] border border-emerald-500/30'
                            : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.05]'
                            }`}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path>
                        </svg>
                        {t('dnsTunnel.deployTab', 'Deploy Tunnel')}
                    </button>
                    <button
                        onClick={() => setSubTab('optimizer')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${subTab === 'optimizer'
                            ? 'bg-violet-500/15 text-violet-400 shadow-[0_0_20px_rgba(139,92,246,0.3)] border border-violet-500/30'
                            : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.05]'
                            }`}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                        </svg>
                        {t('dnsTunnel.optimizerTab', 'DNS Optimizer')}
                    </button>
                    <button
                        onClick={() => setSubTab('lab')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${subTab === 'lab'
                            ? 'bg-indigo-500/15 text-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.3)] border border-indigo-500/30'
                            : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.05]'
                            }`}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        {t('dnsTunnel.labTab', 'Config Lab')}
                    </button>
                    <button
                        onClick={() => setSubTab('matrix')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${subTab === 'matrix'
                            ? 'bg-amber-500/15 text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.3)] border border-amber-500/30'
                            : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.05]'
                            }`}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                        </svg>
                        {t('dnsTunnel.matrixTab', 'Speed Matrix')}
                    </button>
                    <button
                        onClick={() => setSubTab('manage')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${subTab === 'manage'
                            ? 'bg-cyan-500/15 text-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.3)] border border-cyan-500/30'
                            : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.05]'
                            }`}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                        </svg>
                        {t('dnsTunnel.manageTab', 'Manage')}
                    </button>
                </div>
            </div>

            {subTab === 'deploy' && <DeployWizard onSendToAdvanced={onSendToAdvanced} onGoToOptimizer={goToOptimizer} onGoToLab={goToConfigLab} />}
            {subTab === 'optimizer' && <DnsOptimizer onSendToAdvanced={onSendToAdvanced} onSendToLab={goToConfigLab} />}
            {subTab === 'lab' && <ConfigLab onSendToDeploy={goToDeployWizard} onGoToOptimizer={goToOptimizer} />}
            {subTab === 'matrix' && <SpeedMatrix />}
            {subTab === 'manage' && <DeployManage />}
        </div>
    );
}
