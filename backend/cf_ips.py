
import ipaddress
import random
import requests

# Fallback ranges if fetch fails
CLOUDFLARE_RANGES = [
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
    "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
    "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22"
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
            resp = requests.get(url, timeout=10)
            if resp.status_code == 200:
                lines = resp.text.strip().split('\n')
                valid = [line.strip() for line in lines if line.strip()]
                new_ranges.extend(valid)
        except Exception as e:
            print(f"Failed to update CF ranges from {url}: {e}")
            
    if new_ranges:
        CLOUDFLARE_RANGES = list(set(new_ranges)) # Unique
        print(f"Updated CF Ranges: {len(CLOUDFLARE_RANGES)} subnets")

class SmartIPGenerator:
    def __init__(self):
        self.priority_subnets = set() # Set of /24 subnets that successfully connected
        self.tried_count = 0
        
    def get_next_ip(self, ip_version="all"):
        self.tried_count += 1
        
        # Filter ranges based on version request
        available_ranges = CLOUDFLARE_RANGES
        if ip_version == "ipv4":
            available_ranges = [r for r in CLOUDFLARE_RANGES if "." in r]
        elif ip_version == "ipv6":
            available_ranges = [r for r in CLOUDFLARE_RANGES if ":" in r]
            
        if not available_ranges: return "1.1.1.1"

        # Strategy: 40% chance to exploit good neighborhoods
        if self.priority_subnets and random.random() < 0.4:
            # Filter priority subnets too
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
            # Add the /24 of this IP to priority
            # For IPv4
            if "." in ip:
                network = ipaddress.ip_network(f"{ip}/24", strict=False)
                self.priority_subnets.add(str(network))
            # For IPv6, maybe /120? Cloudflare IPv6 ranges are /20 typically.
            # Let's use a smaller slice for neighborhood, e.g., /112 or just keep strict random for v6
            # For simplicity, we stick to v4 neighborhood logic mostly or generic network logic
            else:
                 network = ipaddress.ip_network(f"{ip}/120", strict=False)
                 self.priority_subnets.add(str(network))
        except:
             pass

smart_generator = SmartIPGenerator()

def get_smart_ip(ip_version="all"):
    return smart_generator.get_next_ip(ip_version)

def report_good_ip(ip):
    smart_generator.report_success(ip)

def get_random_ips(count=100):
   # Valid for initial batch or fallback
   return [smart_generator.get_next_ip() for _ in range(count)]

def get_systematic_ips_iter():
    # Generator that yields IPs systematically from all ranges
    # To avoid getting stuck in one range, we can interleave or just iterate
    # For massive speed, random sampling is often better than sequential for finding "good" ones quickly across different subnets
    # But user asked for systematic. Let's do a shuffled systematic approach:
    # 1. Shuffle ranges
    # 2. Iterate each range
    
    ranges = list(CLOUDFLARE_RANGES)
    random.shuffle(ranges)
    
    for cidr in ranges:
        network = ipaddress.ip_network(cidr)
        # Iterating millions is too slow for Python generator in this context if we want variety.
        # Compromise: Yield chunks from each range
        for ip in network:
            yield str(ip)
