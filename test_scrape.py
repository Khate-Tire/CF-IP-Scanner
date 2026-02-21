import cloudscraper
import re

scraper = cloudscraper.create_scraper(browser={'browser': 'chrome', 'platform': 'windows', 'mobile': False})
html = scraper.get('https://trends.builtwith.com/websitelist/Cloudflare/Iran').text
domains = re.findall(r'https://builtwith.com/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})', html)
print(list(set(domains))[:30])
