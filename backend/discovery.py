# Copyright (c) 2026 Taher AkbariSaeed
import asyncio
import aiohttp
import aiodns
import os
import random
from typing import List
from core_manager import APP_DIR

async def batch_resolve_domains(domains: List[str]) -> List[str]:
    """Resolves domains across multiple global DNS servers concurrently to find edge IPs"""
    resolver = aiodns.DNSResolver()
    
    # Cloudflare, Google, Quad9 nameservers
    NAMESERVERS = ['1.1.1.1', '8.8.8.8', '9.9.9.9', '208.67.222.222', '1.0.0.1']
    ips_found = set()
    
    async def resolve_single(domain: str, ns: str):
        try:
            temp_resolver = aiodns.DNSResolver(nameservers=[ns])
            res = await temp_resolver.query(domain, 'A')
            for record in res:
                ips_found.add(record.host)
        except Exception as e:
            pass

    tasks = []
    for domain in domains:
        for ns in NAMESERVERS:
            tasks.append(resolve_single(domain, ns))
            
    if tasks:
        await asyncio.gather(*tasks)
        
    return list(ips_found)

async def scrape_builtwith_domains(country_code="US"):
    import db
    db_domains_res = await db.get_country_domains(country_code)
    
    # Load custom domains from list.txt if available
    custom_domains = []
    try:
        list_path = os.path.join(APP_DIR, 'CF-SITES', 'main', 'list.txt')
        if os.path.exists(list_path):
            with open(list_path, 'r', encoding='utf-8') as f:
                custom_domains = [line.strip() for line in f if line.strip() and not line.startswith('#')]
    except Exception as e:
        print(f"Failed to load custom list.txt: {e}")

    db_domains = db_domains_res['domains'] if db_domains_res and 'domains' in db_domains_res else []
    
    all_domains = list(set(db_domains + custom_domains))
    if all_domains:
        print(f"Using {len(all_domains)} combined domains for {country_code}")
        return await batch_resolve_domains(all_domains)
    return []

async def get_advanced_ips(req, use_proxy=False) -> List[str]:
    """Resolves Community GitHub URLs and custom Text Lists"""
    manual_ips = []
    if req.ip_source == 'community_scrape':
        repos = ['MortezaBashsiz/CF-Workers-sub', 'ircf/awesome-vless'] # Example repos
        async with aiohttp.ClientSession(trust_env=use_proxy) as session:
            try:
                url = f"https://raw.githubusercontent.com/{random.choice(repos)}/main/ips.txt"
                print(f"Scraping community list: {url}")
                async with session.get(url, timeout=10) as resp:
                    if resp.status == 200:
                        text = await resp.text()
                        scrape_ips = [line.strip() for line in text.splitlines() if line.strip() and not ':' in line.strip()]
                        manual_ips.extend(scrape_ips)
            except:
                pass
    elif req.ip_source == 'custom_url' and req.custom_url:
        async with aiohttp.ClientSession(trust_env=use_proxy) as session:
            try:
                print(f"Fetching custom URL: {req.custom_url}")
                async with session.get(req.custom_url, timeout=10) as resp:
                    if resp.status == 200:
                        text = await resp.text()
                        custom_ips = [line.strip() for line in text.splitlines() if line.strip() and not ':' in line.strip()]
                        manual_ips.extend(custom_ips)
            except Exception as e:
                pass
    return manual_ips


async def fetch_fastly_ips(use_proxy=False) -> List[str]:
    """Fetches official Fastly IPv4 ranges from their public API."""
    async with aiohttp.ClientSession(trust_env=use_proxy) as session:
        try:
            print("Fetching Fastly IP ranges...")
            async with session.get("https://api.fastly.com/public-ip-list", timeout=10) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data.get("addresses", [])
        except Exception as e:
            print(f"Failed to fetch Fastly IPs: {e}")
            
    # Fallback to known Fastly IPv4 ranges if the API is blocked (e.g. in Iran)
    print("Using Fastly fallback IP ranges...")
    return [
        "23.235.32.0/20", "43.249.72.0/22", "103.244.50.0/24", "103.245.222.0/23",
        "103.245.224.0/24", "104.156.80.0/20", "140.248.64.0/18", "140.248.128.0/17",
        "146.75.0.0/16", "151.101.0.0/16", "157.52.64.0/18", "167.82.0.0/17",
        "167.82.128.0/20", "167.82.160.0/20", "167.82.224.0/20", "172.111.64.0/18",
        "185.31.16.0/22", "199.27.72.0/21", "199.232.0.0/16"
    ]

