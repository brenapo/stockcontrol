# tools/migrate_barcode_primary_index.py
import os, sys

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from app import create_app
from stockcontrol.db import get_conn

print(">>> migrate_barcode_primary_index: start", flush=True)
app = create_app()
with app.app_context():
    conn = get_conn()
    c = conn.cursor()
    c.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ux_barcode_primary_per_product
        ON product_barcodes(product_id)
        WHERE is_primary = 1
    """)
    conn.commit()
    conn.close()
print(">>> migrate_barcode_primary_index: done", flush=True)
