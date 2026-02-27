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

async def optimize_and_test():
    pool = await aiomysql.create_pool(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD, db=DB_NAME, autocommit=True
    )
    
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            print("Adding specialized index for Timeline query: idx_provider_time(provider, timestamp)...")
            try:
                await cur.execute("CREATE INDEX idx_provider_time ON scan_results(provider, timestamp)")
                print("Index added successfully.")
            except Exception as e:
                print(f"Index might already exist or failed: {e}")
                
            print("Running Timeline query again...")
            q_start = time.time()
            await cur.execute("SELECT DATE(timestamp) as date, COUNT(*) as total_scans, SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) as successful_scans FROM scan_results WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY) AND provider='cloudflare' GROUP BY DATE(timestamp) ORDER BY date ASC")
            res = await cur.fetchall()
            q_time = time.time() - q_start
            
            print(f"Timeline query now took: {q_time:.3f}s")
            
            print("Running Failures query...")
            q_start = time.time()
            await cur.execute("SELECT status as fail_reason, COUNT(*) as count FROM scan_results WHERE status != 'ok' AND provider='cloudflare' AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY status")
            res = await cur.fetchall()
            q_time = time.time() - q_start
            print(f"Failures query now took: {q_time:.3f}s")
            
    pool.close()
    await pool.wait_closed()

if __name__ == "__main__":
    asyncio.run(optimize_and_test())
