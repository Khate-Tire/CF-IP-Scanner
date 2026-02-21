import React from 'react';

export default function AboutBox() {
    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="glass-panel p-8 neon-border shadow-[0_0_20px_rgba(0,243,255,0.1)]">
                <h2 className="text-3xl font-black mb-6 text-transparent bg-clip-text bg-gradient-to-r from-neon-blue to-neon-purple drop-shadow-[0_0_10px_rgba(188,19,254,0.5)] border-b border-white/10 pb-4">
                    About Antigravity Scanner
                </h2>

                <div className="space-y-6 text-gray-300">
                    <section>
                        <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                            <span className="text-neon-blue">🚀</span> What is this app?
                        </h3>
                        <p className="leading-relaxed">
                            The Antigravity IP Scanner is an advanced, high-performance network tool designed to discover and verify Cloudflare Edge IPs (and WARP endpoints) that bypass Deep Packet Inspection (DPI) and geographic censorship. It tests latency, jitter, and real-world download/upload speeds to find the absolute best connections for your specific internet provider.
                        </p>
                    </section>

                    <section>
                        <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                            <span className="text-neon-purple">⚡</span> How to Use the Scanner
                        </h3>
                        <ol className="list-decimal pl-5 space-y-3 leading-relaxed">
                            <li><strong>VLESS Config:</strong> Paste a working VLESS (or VMess/Trojan) configuration into the text box. The app needs this base configuration to test the different "clean" IPs against.</li>
                            <li><strong>IP Source:</strong> Choose where to hunt for IPs:
                                <ul className="list-disc pl-5 mt-2 space-y-1 text-sm text-gray-400">
                                    <li><strong className="text-gray-300">Smart History:</strong> Checks IPs that have previously worked flawlessly on your exact ISP. (Fastest)</li>
                                    <li><strong className="text-amber-400">Gold IPs:</strong> The ultimate combination of your Smart History + top Cloudflare domains currently popular in your country.</li>
                                    <li><strong className="text-neon-purple">Community Gold:</strong> Pulls from a global database of IPs that other users in your region have verified as working.</li>
                                    <li><strong className="text-blue-400">Auto-Scrape:</strong> Downloads thousands of freshly scanned IPs from community GitHub repositories.</li>
                                </ul>
                            </li>
                            <li><strong>Start Scan:</strong> Hit the start button. The backend will rapidly test hundreds of IPs concurrently. It stops automatically once it finds the target number of "Good" IPs.</li>
                            <li><strong>Copy & Use:</strong> In the Results table at the bottom, click <span className="text-neon-blue underline px-1">Copy Link</span> to copy the optimized V2Ray configuration directly to your clipboard.</li>
                        </ol>
                    </section>

                    <section>
                        <h3 className="text-xl font-bold text-white mb-2 mt-8 border-t border-white/10 pt-6 flex items-center gap-2">
                            <span className="text-orange-400">🛡️</span> Advanced Features
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                            <div className="bg-black/40 p-4 rounded border border-white/5">
                                <h4 className="font-bold text-red-400 mb-1">Strict TLS Verification</h4>
                                <p className="text-sm text-gray-400">Prevents Man-In-The-Middle attacks by validating the server's TLS certificate belongs to Cloudflare before allowing traffic.</p>
                            </div>
                            <div className="bg-black/40 p-4 rounded border border-white/5">
                                <h4 className="font-bold text-white mb-1">DPI Fragment Analyzer</h4>
                                <p className="text-sm text-gray-400">Tests various V2Ray fragment configurations (length/interval chunking) on a single IP to bypass advanced firewall filtering.</p>
                            </div>
                            <div className="bg-black/40 p-4 rounded border border-white/5">
                                <h4 className="font-bold text-neon-blue mb-1">SNI Fronting</h4>
                                <p className="text-sm text-gray-400">Scans a single working IP against a large list of domain names to find unblocked SNIs (Server Name Indications) for disguised routing.</p>
                            </div>
                            <div className="bg-black/40 p-4 rounded border border-white/5">
                                <h4 className="font-bold text-orange-400 mb-1">WARP Scanner</h4>
                                <p className="text-sm text-gray-400">Hunts for pure Cloudflare UDP endpoints that can be plugged directly into Wireguard clients (like TunSafe or the official Wireguard app) for full-device VPN.</p>
                            </div>
                        </div>
                    </section>

                    <section className="mt-10 pt-8 border-t border-white/10">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Developer Info */}
                            <div className="bg-black/40 p-6 rounded-lg border border-white/5 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-neon-blue/10 rounded-full blur-3xl -mr-10 -mt-10 transition-all group-hover:bg-neon-blue/20"></div>
                                <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                                    <span className="text-neon-blue">👨‍💻</span> Author & Contact
                                </h3>
                                <div className="space-y-3 relative z-10">
                                    <p className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-neon-blue to-teal-400">Khate Tire</p>

                                    <div className="flex items-center gap-3 text-sm text-gray-300">
                                        <span className="w-6 text-center">✉️</span>
                                        <a href="mailto:khatetire@proton.me" className="hover:text-neon-blue transition-colors">khatetire@proton.me</a>
                                    </div>

                                    <div className="flex items-center gap-3 text-sm text-gray-300">
                                        <span className="w-6 text-center">🐙</span>
                                        <a href="https://github.com/Khate-Tire" target="_blank" rel="noreferrer" className="hover:text-white transition-colors">github.com/Khate-Tire</a>
                                    </div>

                                    <div className="flex items-center gap-3 text-sm text-gray-300">
                                        <span className="w-6 text-center">✈️</span>
                                        <a href="https://t.me/hossein_shiravani" target="_blank" rel="noreferrer" className="hover:text-neon-blue transition-colors">@hossein_shiravani</a>
                                    </div>

                                    <div className="flex items-center gap-3 text-sm text-gray-300">
                                        <span className="w-6 text-center">🆔</span>
                                        <a href="https://orcid.org/0000-0002-9517-9773" target="_blank" rel="noreferrer" className="hover:text-green-400 transition-colors">ORCID: 0000-0002-9517-9773</a>
                                    </div>
                                </div>
                            </div>

                            {/* Community & Support */}
                            <div className="bg-black/40 p-6 rounded-lg border border-white/5 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-neon-purple/10 rounded-full blur-3xl -mr-10 -mt-10 transition-all group-hover:bg-neon-purple/20"></div>
                                <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                                    <span className="text-neon-purple">🌟</span> Community & Support
                                </h3>

                                <div className="space-y-4 relative z-10">
                                    <a href="https://github.com/Khate-Tire/CF-IP-Scanner" target="_blank" rel="noreferrer"
                                        className="flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-all group/btn">
                                        <div className="flex items-center gap-3">
                                            <span className="text-xl">⭐</span>
                                            <div>
                                                <p className="text-sm font-bold text-white group-hover/btn:text-yellow-400 transition-colors">Star us on GitHub</p>
                                                <p className="text-xs text-gray-400">Support the open-source project</p>
                                            </div>
                                        </div>
                                        <span className="text-gray-500 group-hover/btn:text-white">→</span>
                                    </a>

                                    <a href="https://t.me/antigravity_ip_bot" target="_blank" rel="noreferrer"
                                        className="flex items-center justify-between p-3 bg-neon-blue/5 hover:bg-neon-blue/10 border border-neon-blue/20 rounded transition-all group/btn">
                                        <div className="flex items-center gap-3">
                                            <span className="text-xl">🤖</span>
                                            <div>
                                                <p className="text-sm font-bold text-neon-blue group-hover/btn:drop-shadow-[0_0_5px_rgba(0,243,255,0.8)] transition-all">Free VPN Telegram Bot</p>
                                                <p className="text-xs text-gray-400">Get free configurations instantly</p>
                                            </div>
                                        </div>
                                        <span className="text-neon-blue opacity-50 group-hover/btn:opacity-100">→</span>
                                    </a>

                                    <a href="https://t.me/ANTIGRAVITY_IP" target="_blank" rel="noreferrer"
                                        className="flex items-center justify-between p-3 bg-neon-purple/5 hover:bg-neon-purple/10 border border-neon-purple/20 rounded transition-all group/btn">
                                        <div className="flex items-center gap-3">
                                            <span className="text-xl">💬</span>
                                            <div>
                                                <p className="text-sm font-bold text-neon-purple group-hover/btn:drop-shadow-[0_0_5px_rgba(188,19,254,0.8)] transition-all">Join our Telegram Group</p>
                                                <p className="text-xs text-gray-400">Share bugs, comments & feedback</p>
                                            </div>
                                        </div>
                                        <span className="text-neon-purple opacity-50 group-hover/btn:opacity-100">→</span>
                                    </a>
                                </div>
                            </div>
                        </div>
                    </section>

                    <div className="mt-8 pt-6 border-t border-white/10 flex items-center justify-between text-sm text-gray-500">
                        <p>Built for a free and open internet.</p>
                        <p>Version 2.5</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
