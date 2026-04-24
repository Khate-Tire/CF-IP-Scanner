/* Copyright (c) 2026 Taher AkbariSaeed */
import React, { useState, useCallback } from 'react';
import { useTranslation } from '../i18n/LanguageContext';
import DeployWizard from './DeployWizard';
import DnsOptimizer from './DnsOptimizer';
import ConfigLab from './ConfigLab';
import { sendToConfigLab, sendToDeployWizard } from '../state/optimizerBridge';

export default function DnsTunnelTab({ onSendToAdvanced }) {
    const { t } = useTranslation();
    const [subTab, setSubTab] = useState('deploy');

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
                </div>
            </div>

            {subTab === 'deploy' && <DeployWizard onSendToAdvanced={onSendToAdvanced} onGoToOptimizer={goToOptimizer} onGoToLab={goToConfigLab} />}
            {subTab === 'optimizer' && <DnsOptimizer onSendToAdvanced={onSendToAdvanced} onSendToLab={goToConfigLab} />}
            {subTab === 'lab' && <ConfigLab onSendToDeploy={goToDeployWizard} onGoToOptimizer={goToOptimizer} />}
        </div>
    );
}
