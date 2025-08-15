from ..db import get_conn
from ..utils import now_str

def find_product(pid: int):
    conn = get_conn()
    c = conn.cursor()
    c.execute("""
      SELECT p.*,
             COALESCE(cat.name,'') AS category_name,
             COALESCE(sup.name,'') AS supplier_name
      FROM products p
      LEFT JOIN categories cat ON cat.id = p.category_id
      LEFT JOIN suppliers  sup ON sup.id = p.supplier_id
      WHERE p.id = ?
    """, (pid,))
    row = c.fetchone()
    conn.close()
    return row

def recalc_avg_cost_on_in(product_id: int, qty_in: float, unit_cost):
    if unit_cost is None:
        return
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT current_qty, avg_cost FROM products WHERE id=?", (product_id,))
    row = c.fetchone()
    if not row:
        conn.close(); return
    current_qty = float(row["current_qty"] or 0)
    avg_cost = float(row["avg_cost"] or 0)
    new_qty = current_qty + qty_in
    new_avg = unit_cost if new_qty <= 0 else ((current_qty * avg_cost) + (qty_in * unit_cost)) / new_qty
    c.execute("UPDATE products SET avg_cost=? WHERE id=?", (new_avg, product_id))
    conn.commit(); conn.close()