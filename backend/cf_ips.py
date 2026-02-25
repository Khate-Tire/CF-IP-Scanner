# Copyright (c) 2026 Taher AkbariSaeed
import ipaddress
import random
import urllib.request
import aiohttp
import asyncio
import re
from datetime import datetime, timedelta
from db import get_country_domains, save_country_domains

# Fallback ranges if fetch fails
CLOUDFLARE_RANGES = [
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
    "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
    "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22"
]

COMMUNITY_SCRAPE_URLS = [
    "https://raw.githubusercontent.com/vfarid/cf-ip-scanner/main/ipv4.txt",
    "https://raw.githubusercontent.com/ircfspace/scanner/main/ipv4.txt",
    "https://raw.githubusercontent.com/Epodon/v2ray-configs/main/Cloudflare-IPs.txt"
]

def update_cf_ranges():
    global CLOUDFLARE_RANGES
    new_ranges = []
    
    urls = [
        "https://www.cloudflare.com/ips-v4",
        "https://www.cloudflare.com/ips-v6"
    ]
    
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status == 200:
                    text = resp.read().decode('utf-8')
                    lines = text.strip().split('\n')
                    valid = [line.strip() for line in lines if line.strip()]
                    new_ranges.extend(valid)
        except Exception as e:
            print(f"Failed to update CF ranges from {url}: {e}")
            
    if new_ranges:
        CLOUDFLARE_RANGES = list(set(new_ranges)) # Unique
        print(f"Updated CF Ranges: {len(CLOUDFLARE_RANGES)} subnets")

def D(x):
    y = 0
    for char in x:
        y = ((y << 5) - y + ord(char)) & 0xFFFFFFFF
        if y > 0x7FFFFFFF:
            y -= 0x100000000
    return hex(y & 0xFFFFFFFF)[2:]

def get_bw_cookie():
    import time
    import random
    g = str(int(time.time() * 1000))
    chars = '0123456789abcdefghijklmnopqrstuvwxyz'
    h = ''.join(random.choice(chars) for _ in range(10))
    i = 0
    for v in range(1000000):
        w = D(f'{g}:{h}:{v}')
        if w[-1] == '0':
            i = v
            break
    j = f'{g}:{h}:{i}'
    return f'{j}:{D(j)}'

def _scrape_builtwith_sync(country: str):
    import urllib.request
    from collections import Counter
    url = f"https://trends.builtwith.com/websitelist/Cloudflare/{country.replace(' ', '-')}"
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Cookie": f"BWSTATE={get_bw_cookie()}"
        })
        with urllib.request.urlopen(req, timeout=20) as resp:
            text = resp.read().decode('utf-8', errors='ignore')
            
        # Extract everything that looks like a domain
        raw_domains = re.findall(r'[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', text)
        
        # Filter junk and valid
        junk = {"builtwith", "w3.org", "cdnpi.pe", "twitter.com", "facebook.com", "google.com", "linkedin.com", "github.com", "pinterest.com", "youtube.com"}
        valid_tlds = {'com', 'ru', 'org', 'net', 'io', 'co', 'info', 'me', 'biz', 'tv', 'pw', 'su', 'kz', 'by', 'ua', 'pro', 'mobi', 'name', 'space', 'site', 'online', 'store', 'tech', 'vip', 'club', 'xyz', 'top', 'app', 'dev', 'ai', 'ly', 'sh', 'ir', 'us', 'uk', 'de', 'fr', 'ca', 'au', 'in', 'br', 'jp', 'cn'}
        valid_domains = []
        for d in raw_domains:
            d = d.lower()
            if d.startswith('.'): d = d[1:]
            if len(d) > 4 and d.count('.') >= 1 and not any(j in d for j in junk):
                tld = d.split('.')[-1]
                if tld in valid_tlds:
                    valid_domains.append(d)
                
        if not valid_domains:
            return []
            
        counts = Counter(valid_domains)
        return [domain for domain, count in counts.most_common(50)]
    except Exception as e:
        print(f"Scrape BuiltWith error: {e}")
        return []

async def get_gold_domains(country: str):
    if not country or country == "Unknown":
        country = "United States" # Fallback to get some global gold IPs
        
    cached = await get_country_domains(country)
    
    # Check if cache exists and is fresh (< 7 days)
    if cached and cached.get("last_updated"):
        age = datetime.now() - cached["last_updated"]
        if age < timedelta(days=7) and len(cached.get("domains", [])) > 0:
            return cached["domains"]
            
    # Cache miss or expired, scrape in background thread
    print(f"Fetching fresh Gold Domains for {country} from BuiltWith...")
    domains = await asyncio.to_thread(_scrape_builtwith_sync, country)
    
    if domains:
        await save_country_domains(country, domains)
        return domains
    elif cached and len(cached.get("domains", [])) > 0:
        return cached["domains"] # Fallback to expired cache if scrape fails
        
    # Ultimate fallback if IP is rate-limited by BuiltWith and no cache exists
    print("BuiltWith scrape failed/rate-limited. Using Top Global Cloudflare Domains fallback.")
    fallback_domains = [
        "discord.com", "cloudflare.com", "shopify.com", "reddit.com", "chatgpt.com",
        "canva.com", "medium.com", "zoom.us", "fiverr.com", "udemy.com", 
        "khanacademy.org", "okta.com", "gitlab.com", "hubspot.com", "zendesk.com",
        "upwork.com", "glassdoor.com", "yelp.com", "quizlet.com", "coursehero.com",
        "patreon.com", "cisco.com", "ibm.com", "trello.com", "asana.com"
    ]
    # Optionally cache the fallback so we don't wait 20 seconds every scan while IP is banned
    await save_country_domains(country, fallback_domains)
    return fallback_domains

async def fetch_custom_ips(source_type="custom_url", custom_url=None):
    urls_to_fetch = []
    if source_type == "auto_scrape":
        urls_to_fetch = COMMUNITY_SCRAPE_URLS
    elif source_type == "custom_url" and custom_url:
        urls_to_fetch = [custom_url]
    elif source_type == "fastly_cdn":
        from discovery import fetch_fastly_ips
        return await fetch_fastly_ips()
    else:
        return []

    fetched_ranges = []
    async with aiohttp.ClientSession() as session:
        for url in urls_to_fetch:
            try:
                async with session.get(url, timeout=15) as resp:
                    if resp.status == 200:
                        text = await resp.text()
                        for line in text.splitlines():
                            line = line.strip()
                            if not line or line.startswith('#'): continue
                            # If it's just an IP, treat as /32 or /128
                            if '/' not in line:
                                if ':' in line: line = f"{line}/128"
                                else: line = f"{line}/32"
                            fetched_ranges.append(line)
            except Exception as e:
                print(f"Failed to scrape from {url}: {e}")
                
    if not fetched_ranges:
        print(f"Failed to fetch any custom IPs for {source_type}. Using hardcoded Cloudflare fallback ranges...")
        fetched_ranges = CLOUDFLARE_RANGES
        
    
    return list(set(fetched_ranges))

class SmartIPGenerator:
    def __init__(self, custom_ranges=None):
        self.priority_subnets = set()
        self.tried_count = 0
        self.ranges = custom_ranges if custom_ranges else CLOUDFLARE_RANGES
        
    def get_next_ip(self, ip_version="all"):
        self.tried_count += 1
        
        # Filter ranges based on version request
        available_ranges = self.ranges
        if ip_version == "ipv4":
            available_ranges = [r for r in self.ranges if "." in r]
        elif ip_version == "ipv6":
            available_ranges = [r for r in self.ranges if ":" in r]
            
        if not available_ranges: return "1.1.1.1"

        # Strategy: 40% chance to exploit good neighborhoods
        if self.priority_subnets and random.random() < 0.4:
            valid_priority = []
            for s in self.priority_subnets:
                 if ip_version == "ipv4" and ":" in s: continue
                 if ip_version == "ipv6" and "." in s: continue
                 valid_priority.append(s)
            
            if valid_priority:
                subnet = random.choice(valid_priority)
                try:
                    net = ipaddress.ip_network(subnet)
                    random_int = random.randint(0, net.num_addresses - 1)
                    return str(net[random_int])
                except:
                    pass
        
        # Default: Exploration
        cidr = random.choice(available_ranges)
        try:
            network = ipaddress.ip_network(cidr)
            random_int = random.randint(0, int(network.num_addresses) - 1)
            return str(network[random_int])
        except:
             return "1.1.1.1"

    def report_success(self, ip):
        try:
            if "." in ip:
                network = ipaddress.ip_network(f"{ip}/24", strict=False)
                self.priority_subnets.add(str(network))
            else:
                 network = ipaddress.ip_network(f"{ip}/120", strict=False)
                 self.priority_subnets.add(str(network))
        except:
             pass

# Default global generator
smart_generator = SmartIPGenerator()

def get_smart_ip(ip_version="all"):
    return smart_generator.get_next_ip(ip_version)

def report_good_ip(ip):
    smart_generator.report_success(ip)
