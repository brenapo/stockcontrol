# tools/seed_sample.py
import os, sys

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from app import create_app
from stockcontrol.db import get_conn
from stockcontrol.utils import now_str

SKU = "CANETA-AZ"
PROD_NAME = "Caneta Azul"
CAT_NAME = "Papelaria"
SUP_NAME = "ACME"
SUP_CONTACT = "acme@sup.com"

SEED_IN_NOTE  = "seed: lote inicial"
SEED_OUT_NOTE = "seed: saída teste"

app = create_app()

def one(conn, query, params=()):
    cur = conn.execute(query, params)
    return cur.fetchone()

def val(row, key, default=None):
    return row[key] if row and key in row.keys() else default

with app.app_context():
    conn = get_conn()
    c = conn.cursor()

    # 1) Categoria / Fornecedor
    c.execute("INSERT OR IGNORE INTO categories(name) VALUES(?)", (CAT_NAME,))
    c.execute("INSERT OR IGNORE INTO suppliers(name, contact) VALUES(?,?)", (SUP_NAME, SUP_CONTACT))
    conn.commit()

    cat_id = val(one(conn, "SELECT id FROM categories WHERE name=?", (CAT_NAME,)), "id")
    sup_id = val(one(conn, "SELECT id FROM suppliers WHERE name=?", (SUP_NAME,)), "id")

    if not cat_id or not sup_id:
        raise RuntimeError("Falha ao obter IDs de categoria/fornecedor.")

    # 2) Produto (cria se não existir; se existir, garante dados básicos)
    row = one(conn, "SELECT id FROM products WHERE sku=?", (SKU,))
    if row is None:
        c.execute(
            """INSERT INTO products
               (sku, name, category_id, supplier_id, unit, price, avg_cost, min_qty, current_qty, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (SKU, PROD_NAME, cat_id, sup_id, "un", 3.50, 0.0, 10.0, 0.0, now_str()),
        )
        conn.commit()
        pid = c.lastrowid
        print(f"[OK] Produto criado: {SKU} (id={pid})")
    else:
        pid = row["id"]
        # opcional: ajustar alguns campos padrão
        c.execute(
            """UPDATE products
               SET name=?, category_id=?, supplier_id=?, unit=?, price=?, min_qty=?
             WHERE id=?""",
            (PROD_NAME, cat_id, sup_id, "un", 3.50, 10.0, pid),
        )
        conn.commit()
        print(f"[OK] Produto já existia: {SKU} (id={pid}) — dados atualizados")

    # 3) Seed de movimentos (insere apenas se ainda não inseriu)
    exist_in  = one(conn, "SELECT id FROM stock_movements WHERE product_id=? AND note=?", (pid, SEED_IN_NOTE))
    exist_out = one(conn, "SELECT id FROM stock_movements WHERE product_id=? AND note=?", (pid, SEED_OUT_NOTE))

    if not exist_in:
        c.execute(
            """INSERT INTO stock_movements(product_id, type, quantity, unit_cost, reason, note, ts)
               VALUES (?,?,?,?,?,?,?)""",
            (pid, "IN", 50.0, 1.20, "Compra", SEED_IN_NOTE, now_str()),
        )
        print("[OK] Movimento IN (seed) inserido")
    else:
        print("[=] Movimento IN (seed) já existia — pulando")

    if not exist_out:
        c.execute(
            """INSERT INTO stock_movements(product_id, type, quantity, unit_cost, reason, note, ts)
               VALUES (?,?,?,?,?,?,?)""",
            (pid, "OUT", 5.0, None, "Venda", SEED_OUT_NOTE, now_str()),
        )
        print("[OK] Movimento OUT (seed) inserido")
    else:
        print("[=] Movimento OUT (seed) já existia — pulando")

    conn.commit()

    # 4) Resultado final do produto
    p = one(conn, "SELECT id, sku, name, current_qty, avg_cost FROM products WHERE id=?", (pid,))
    if p:
        print(f"[RESULT] {p['sku']} - {p['name']} | qty={p['current_qty']} | avg_cost={p['avg_cost']:.2f}")
    else:
        print("[WARN] Produto não encontrado após seed (algo estranho ocorreu).")

    conn.close()
