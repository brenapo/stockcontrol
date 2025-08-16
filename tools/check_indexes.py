# tools/check_indexes.py
import os, sys
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from app import create_app
from stockcontrol.db import get_conn

app = create_app()
with app.app_context():
    conn = get_conn()
    c = conn.cursor()
    rows = c.execute("PRAGMA index_list('product_barcodes')").fetchall()
    for r in rows:
        print(dict(r))
    conn.close()
