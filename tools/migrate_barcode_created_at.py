# tools/migrate_barcode_created_at.py
import os, sys

print(">>> migrate_barcode_created_at: start", flush=True)

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from app import create_app
from stockcontrol.db import get_conn

def table_exists(c, name):
    return c.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1", (name,)
    ).fetchone() is not None

def columns(c, table):
    return [r["name"] for r in c.execute(f"PRAGMA table_info({table})")]

app = create_app()
with app.app_context():
    conn = get_conn()
    c = conn.cursor()

    # 1) Garante a tabela (se não existir, cria já com tudo)
    if not table_exists(c, "product_barcodes"):
        print("[MIGRATION] Criando tabela product_barcodes...", flush=True)
        c.execute("""
            CREATE TABLE product_barcodes(
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                symbology  TEXT NOT NULL DEFAULT 'CODE128',
                code       TEXT NOT NULL UNIQUE,
                pack_qty   INTEGER DEFAULT 1,
                label      TEXT,
                is_primary INTEGER DEFAULT 0,
                created_at TEXT,
                FOREIGN KEY(product_id) REFERENCES products(id)
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_pbarcodes_product ON product_barcodes(product_id)")
        conn.commit()
        print("[OK] Tabela criada.", flush=True)
    else:
        print("[INFO] Tabela product_barcodes já existe.", flush=True)

    # 2) Garante colunas (idempotente)
    want = {
        "pack_qty":   "ALTER TABLE product_barcodes ADD COLUMN pack_qty INTEGER DEFAULT 1",
        "label":      "ALTER TABLE product_barcodes ADD COLUMN label TEXT",
        "is_primary": "ALTER TABLE product_barcodes ADD COLUMN is_primary INTEGER DEFAULT 0",
        "created_at": "ALTER TABLE product_barcodes ADD COLUMN created_at TEXT",
    }
    existing = set(columns(c, "product_barcodes"))
    print(f"[DEBUG] Colunas atuais: {sorted(existing)}", flush=True)

    changed = False
    for col, ddl in want.items():
        if col not in existing:
            print(f"[MIGRATION] Adicionando coluna {col}...", flush=True)
            c.execute(ddl)
            changed = True

    if changed:
        conn.commit()
        print("[OK] Colunas garantidas/atualizadas.", flush=True)
    else:
        print("[OK] Todas as colunas necessárias já existem.", flush=True)

    print(">>> migrate_barcode_created_at: done", flush=True)
    conn.close()
