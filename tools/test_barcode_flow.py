# tools/test_barcode_flow.py
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

def ensure_seed():
    conn = get_conn(); c = conn.cursor()
    # categoria/fornecedor
    c.execute("INSERT OR IGNORE INTO categories(name) VALUES(?)", ("Papelaria",))
    c.execute("INSERT OR IGNORE INTO suppliers(name, contact) VALUES(?,?)", ("ACME", "acme@sup.com"))
    conn.commit()

    cat_id = c.execute("SELECT id FROM categories WHERE name=?", ("Papelaria",)).fetchone()["id"]
    sup_id = c.execute("SELECT id FROM suppliers WHERE name=?", ("ACME",)).fetchone()["id"]

    # produto
    row = c.execute("SELECT id FROM products WHERE sku=?", (SKU,)).fetchone()
    if row:
        pid = row["id"]
    else:
        c.execute("""INSERT INTO products (sku, name, category_id, supplier_id, unit, price, avg_cost, min_qty, current_qty, created_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?)""",
                  (SKU, NAME, cat_id, sup_id, "un", 3.50, 0.0, 10.0, 0.0, now_str()))
        pid = c.lastrowid
        # IN inicial 20 a 1.20 (triggers ajustam current_qty)
        c.execute("""INSERT INTO stock_movements(product_id, type, quantity, unit_cost, reason, note, ts)
                     VALUES (?,?,?,?,?,?,?)""",
                  (pid, "IN", 20, 1.20, "Seed inicial", "", now_str()))
        conn.commit()

    # barcode
    b = c.execute("SELECT id FROM product_barcodes WHERE product_id=? AND code=?", (pid, BARCODE)).fetchone()
    if not b:
        c.execute("""INSERT INTO product_barcodes(product_id, symbology, code, pack_qty, label, is_primary, created_at)
                     VALUES (?,?,?,?,?,?,?)""", (pid, "EAN13", BARCODE, 1, "UN", 1, now_str()))
        conn.commit()

    qty = float(c.execute("SELECT current_qty FROM products WHERE id=?", (pid,)).fetchone()["current_qty"])
    conn.close()
    return pid, qty

def get_qty(pid):
    conn = get_conn()
    c = conn.cursor()
    qty = float(c.execute("SELECT current_qty FROM products WHERE id=?", (pid,)).fetchone()["current_qty"])
    conn.close()
    return qty

if __name__ == "__main__":
    print(">>> iniciando test_barcode_flow", flush=True)
    app = create_app()
    # desliga CSRF só no client de teste
    app.config.update(TESTING=True, WTF_CSRF_ENABLED=False)

    with app.app_context():
        pid, qty0 = ensure_seed()
        print(f">>> seed ok: pid={pid}, qty0={qty0}")

        with app.test_client() as client:
            # login
            r = client.post("/login", data={"username": "admin", "password": "admin123"}, follow_redirects=True)
            print(f"POST /login -> {r.status_code}")

            # scan
            r = client.post("/scan", data={"barcode": BARCODE}, follow_redirects=False)
            print(f"POST /scan -> {r.status_code}")
            loc = r.headers.get("Location", "")
            print(f"Location: {loc}")
            assert r.status_code in (302, 303) and f"/produto/{pid}" in loc, "Scan não redirecionou para a página do produto esperado"

            # entrada por barcode (qtd 3, custo 1.00)
            r = client.post(f"/entrada/{pid}", data={"barcode": BARCODE, "qtd": "3", "unit_cost": "1.00", "reason": "Compra"}, follow_redirects=True)
            print(f"POST /entrada (barcode) -> {r.status_code}")
            qty1 = get_qty(pid)
            print(f"qty após entrada: {qty1} (antes {qty0})")
            assert qty1 == qty0 + 3, "Quantidade não aumentou corretamente após ENTRADA por barcode"

            # saída por barcode (qtd 2)
            r = client.post(f"/saida/{pid}", data={"barcode": BARCODE, "qtd": "2", "reason": "Venda"}, follow_redirects=True)
            print(f"POST /saida (barcode) -> {r.status_code}")
            qty2 = get_qty(pid)
            print(f"qty após saída: {qty2} (antes {qty1})")
            assert qty2 == qty1 - 2, "Quantidade não diminuiu corretamente após SAÍDA por barcode"

            print(">>> teste de fluxo por barcode: OK ✅", flush=True)
