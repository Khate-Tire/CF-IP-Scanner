/* Copyright (c) 2026 Taher AkbariSaeed */
import React, { useState, useEffect } from 'react';

const UpdateModal = () => {
    const [updateStatus, setUpdateStatus] = useState(null);

    useEffect(() => {
        if (window.require) {
            try {
                const { ipcRenderer } = window.require('electron');

                ipcRenderer.on('update_available', () => {
                    setUpdateStatus('available');
                });

                ipcRenderer.on('update_downloaded', () => {
                    setUpdateStatus('downloaded');
                });

                return () => {
                    ipcRenderer.removeAllListeners('update_available');
                    ipcRenderer.removeAllListeners('update_downloaded');
                };
            } catch (e) {
                console.log("Not running in Electron environment.", e);
            }
        }
    }, []);

    const handleRestart = () => {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.send('restart_app');
        }
    };

    if (!updateStatus) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-[#111] border border-neon-blue/50 rounded-2xl p-8 max-w-sm w-full shadow-[0_0_30px_rgba(0,243,255,0.3)] select-none">

                <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 rounded-full border border-neon-blue flex items-center justify-center bg-neon-blue/10 animate-pulse">
                        <svg className="w-6 h-6 text-neon-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-white tracking-widest">UPDATE</h3>
                        <p className="text-neon-blue text-sm uppercase">{updateStatus === 'available' ? 'Downloading...' : 'Ready to Install'}</p>
                    </div>
                </div>

                <div className="text-gray-400 text-sm mb-6">
                    {updateStatus === 'available'
                        ? "A new version of Antigravity Scanner is being downloaded in the background. You can continue using the app."
                        : "The update has been downloaded successfully. Restart the application to apply the changes."}
                </div>

                {updateStatus === 'downloaded' && (
                    <button
                        onClick={handleRestart}
                        className="w-full py-3 bg-neon-blue text-black font-bold uppercase tracking-widest rounded-lg shadow-[0_0_15px_rgba(0,243,255,0.5)] hover:bg-white transition-colors animate-in fade-in"
                    >
                        Restart & Install
                    </button>
                )}
            </div>
        </div>
    );
};

export default UpdateModal;
