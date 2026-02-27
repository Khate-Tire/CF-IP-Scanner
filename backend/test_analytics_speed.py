import asyncio
import time
import os
from dotenv import load_dotenv
import aiomysql

load_dotenv()

DB_HOST = os.environ.get('DB_HOST', '')
DB_USER = os.environ.get('DB_USER', '')
DB_PASSWORD = os.environ.get('DB_PASSWORD', '')
DB_NAME = os.environ.get('DB_NAME', '')
DB_PORT = int(os.environ.get('DB_PORT', '') or '3306')

async def test_analytics_speed():
    print(f"Connecting to DB: {DB_HOST}:{DB_PORT}/{DB_NAME} as {DB_USER}")
    start_time = time.time()
    
    try:
        pool = await aiomysql.create_pool(
            host=DB_HOST,
            port=DB_PORT,
            user=DB_USER,
            password=DB_PASSWORD,
            db=DB_NAME,
            autocommit=True,
            charset='utf8mb4'
        )
    except Exception as e:
        print(f"Failed to connect: {e}")
        return

    conn_time = time.time() - start_time
    print(f"Connection established in {conn_time:.2f}s")
    
    p = 'cloudflare'
    
    queries = [
        ("Datacenters", f"SELECT datacenter, COUNT(*) as count, ROUND(AVG(ping)) as avg_ping FROM scan_results WHERE status='ok' AND datacenter != 'Unknown' AND datacenter IS NOT NULL AND provider='{p}' AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY datacenter ORDER BY count DESC LIMIT 10"),
        ("Ports", f"SELECT port, COUNT(*) as count FROM scan_results WHERE status='ok' AND port != -1 AND port IS NOT NULL AND provider='{p}' AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY port ORDER BY count DESC LIMIT 5"),
        ("Networks", f"SELECT network_type, COUNT(*) as count FROM scan_results WHERE status='ok' AND network_type != 'Unknown' AND network_type IS NOT NULL AND provider='{p}' AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY network_type ORDER BY count DESC"),
        ("Total Scans", f"SELECT COUNT(*) as count FROM scan_results WHERE provider='{p}'"),
        ("Total Good", f"SELECT COUNT(*) as count FROM scan_results WHERE status='ok' AND provider='{p}'"),
        ("Timeline", f"SELECT DATE(timestamp) as date, COUNT(*) as total_scans, SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) as successful_scans FROM scan_results WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY) AND provider='{p}' GROUP BY DATE(timestamp) ORDER BY date ASC"),
        ("ASNs", f"SELECT asn, COUNT(*) as count FROM scan_results WHERE status='ok' AND asn != 'Unknown' AND asn IS NOT NULL AND provider='{p}' AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY asn ORDER BY count DESC LIMIT 5"),
        ("ISPs", f"SELECT user_isp as isp, COUNT(*) as count FROM scan_results WHERE status='ok' AND user_isp != 'Unknown' AND user_isp IS NOT NULL AND provider='{p}' AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY user_isp ORDER BY count DESC LIMIT 5"),
        ("Failures", f"SELECT status as fail_reason, COUNT(*) as count FROM scan_results WHERE status != 'ok' AND provider='{p}' AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY status")
    ]
    
    total_query_time = 0
    
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            for name, q in queries:
                q_start = time.time()
                await cur.execute(q)
                res = await cur.fetchall()
                q_time = time.time() - q_start
                total_query_time += q_time
                print(f"[{name}] took {q_time:.3f}s - {len(res)} rows returned")
                
    print(f"\\nTotal sequential query time: {total_query_time:.3f}s")
    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(test_analytics_speed())
