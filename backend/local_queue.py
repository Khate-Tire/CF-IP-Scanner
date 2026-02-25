import sqlite3
import json
import asyncio
from datetime import datetime
import os
import sys

# Copyright (c) 2026 Taher AkbariSaeed

# Determine path for local database (works with PyInstaller and dev mode)
if getattr(sys, 'frozen', False):
    DB_PATH = os.path.join(os.path.dirname(sys.executable), 'scan_queue.db')
else:
    DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scan_queue.db')

def _execute(query, params=(), fetchone=False, fetchall=False, commit=False):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        c = conn.cursor()
        c.execute(query, params)
        res = None
        if fetchone:
            row = c.fetchone()
            res = dict(row) if row else None
        elif fetchall:
            res = [dict(row) for row in c.fetchall()]
        if commit:
            conn.commit()
        return res
    finally:
        conn.close()

def init_queue_db():
    _execute('''
        CREATE TABLE IF NOT EXISTS queued_scans (
            scan_id TEXT PRIMARY KEY,
            status TEXT DEFAULT 'queued',
            payload TEXT,
            total INTEGER DEFAULT 0,
            completed INTEGER DEFAULT 0,
            found_good INTEGER DEFAULT 0,
            logs TEXT,
            stats TEXT,
            results TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''', commit=True)
    
    # Auto-resume interrupted tasks as paused/failed
    _execute("UPDATE queued_scans SET status = 'paused' WHERE status = 'running'", commit=True)

init_queue_db()

async def create_scan_task(scan_id: str, payload: dict, initial_logs: list, initial_stats: dict):
    def _create():
        _execute(
            "INSERT INTO queued_scans (scan_id, status, payload, logs, stats, results) VALUES (?, ?, ?, ?, ?, ?)",
            (scan_id, 'queued', json.dumps(payload), json.dumps(initial_logs), json.dumps(initial_stats), '[]'),
            commit=True
        )
    await asyncio.to_thread(_create)

async def update_scan_status_db(scan_id: str, status: str = None, total: int = None, 
                               completed: int = None, found_good: int = None, 
                               logs: list = None, stats: dict = None, results: list = None):
    def _update():
        fields = []
        params = []
        if status is not None:
            fields.append("status = ?")
            params.append(status)
        if total is not None:
            fields.append("total = ?")
            params.append(total)
        if completed is not None:
            fields.append("completed = ?")
            params.append(completed)
        if found_good is not None:
            fields.append("found_good = ?")
            params.append(found_good)
        if logs is not None:
            fields.append("logs = ?")
            params.append(json.dumps(logs))
        if stats is not None:
            fields.append("stats = ?")
            params.append(json.dumps(stats))
        if results is not None:
            fields.append("results = ?")
            params.append(json.dumps(results))
            
        if not fields: return
        
        query = f"UPDATE queued_scans SET {', '.join(fields)} WHERE scan_id = ?"
        params.append(scan_id)
        _execute(query, tuple(params), commit=True)
        
    await asyncio.to_thread(_update)

async def get_scan_state(scan_id: str):
    def _get():
        row = _execute("SELECT * FROM queued_scans WHERE scan_id = ?", (scan_id,), fetchone=True)
        # Handle SQLite cursor returning a tuple instead of row object depending on row_factory parsing,
        # but row_factory=sqlite3.Row is enabled.
        # Wait, fetchone in _execute uses `c.fetchone()` again? Yes! Bug: c.fetchone is consumed!
        # Handled in _execute.
        return row
    return await asyncio.to_thread(_get)

async def load_unfinished_scans():
    def _load():
        return _execute("SELECT * FROM queued_scans WHERE status IN ('queued', 'running', 'paused')", fetchall=True)
    return await asyncio.to_thread(_load)
