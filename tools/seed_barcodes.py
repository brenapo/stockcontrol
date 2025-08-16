# tools/seed_barcodes.py
import os, sys

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from app import create_app
from stockcontrol.db import get_conn
from stockcontrol.utils import now_str

BARCODE = "7891234567895"  # EAN-13 válido
SKU = "CANETA-AZ"
NAME = "Caneta Azul"

app = create_app()
with app.app_context():
    conn = get_conn()
    c = conn.cursor()

    # categoria/fornecedor básicos
    c.execute("INSERT OR IGNORE INTO categories(name) VALUES(?)", ("Papelaria",))
    c.execute("INSERT OR IGNORE INTO suppliers(name, contact) VALUES(?,?)", ("ACME", "acme@sup.com"))
    conn.commit()

    cat_id = c.execute("SELECT id FROM categories WHERE name=?", ("Papelaria",)).fetchone()["id"]
    sup_id = c.execute("SELECT id FROM suppliers WHERE name=?", ("ACME",)).fetchone()["id"]

    # produto
    row = c.execute("SELECT id FROM products WHERE sku=?", (SKU,)).fetchone()
    if row:
        pid = row["id"]
        print(f"[INFO] Produto já existe: {SKU} (id={pid})")
    else:
        c.execute("""
            INSERT INTO products (sku, name, category_id, supplier_id, unit, price, avg_cost, min_qty, current_qty, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (SKU, NAME, cat_id, sup_id, "un", 3.50, 0.0, 10.0, 0.0, now_str()))
        pid = c.lastrowid
        print(f"[OK] Produto criado: {SKU} (id={pid})")

        # estoque inicial 20 un a R$1,20 (gatilhos ajustam current_qty)
        c.execute("""INSERT INTO stock_movements(product_id, type, quantity, unit_cost, reason, note, ts)
                     VALUES (?,?,?,?,?,?,?)""",
                  (pid, "IN", 20, 1.20, "Seed inicial", "", now_str()))
        print("[OK] Movimento IN inicial criado")

    # barcode
    b = c.execute("SELECT id FROM product_barcodes WHERE product_id=? AND code=?", (pid, BARCODE)).fetchone()
    if b:
        print(f"[INFO] Barcode já existia para pid={pid}: {BARCODE}")
    else:
        c.execute("""INSERT INTO product_barcodes(product_id, symbology, code, pack_qty, label, is_primary, created_at)
                     VALUES(?,?,?,?,?,?,?)""",
                  (pid, "EAN13", BARCODE, 1, "UN", 1, now_str()))
        print(f"[OK] Barcode adicionado: {BARCODE} (EAN13) -> pid={pid}")

    # resumo
    p = c.execute("SELECT id, sku, name, current_qty, avg_cost FROM products WHERE id=?", (pid,)).fetchone()
    print(f"[RESULT] {p['sku']} - {p['name']} | qty={p['current_qty']} | avg_cost={p['avg_cost']:.2f}")

    conn.commit()
    conn.close()
