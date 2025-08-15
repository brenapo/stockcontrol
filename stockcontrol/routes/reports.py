from flask import Blueprint, render_template, send_file
from flask_login import login_required
import csv, io
from ..db import get_conn

bp = Blueprint("reports", __name__, url_prefix="/relatorios")

@bp.get("/baixo-estoque")
@login_required
def low_stock():
    conn = get_conn(); c = conn.cursor()
    c.execute("""SELECT id, sku, name, unit,
                        printf('%.2f', current_qty) AS current_qty,
                        printf('%.2f', min_qty) AS min_qty
                 FROM products
                 WHERE current_qty <= min_qty
                 ORDER BY name""")
    itens = c.fetchall(); conn.close()
    return render_template("rel_baixo_estoque.html", itens=itens)

@bp.get("/valorizacao")
@login_required
def valuation():
    conn = get_conn(); c = conn.cursor()
    c.execute("""SELECT name, sku, unit,
                        printf('%.2f', current_qty) AS current_qty,
                        printf('%.2f', price) AS price,
                        printf('%.2f', avg_cost) AS avg_cost,
                        printf('%.2f', (current_qty * price)) AS subtotal,
                        printf('%.2f', (current_qty * avg_cost)) AS custo_total
                 FROM products ORDER BY name""")
    rows = c.fetchall()
    c.execute("SELECT SUM(current_qty * price), SUM(current_qty * avg_cost) FROM products")
    total_price, total_cost = c.fetchone()
    total_price = total_price or 0.0
    total_cost = total_cost or 0.0
    conn.close()
    return render_template("rel_valorizacao.html", rows=rows, total_price=total_price, total_cost=total_cost)

# Exportações (fora de /relatorios para manter urls curtas)
from flask import Blueprint as _BP2
bp_export = _BP2("export", __name__, url_prefix="/export")

@bp_export.get("/produtos.csv")
@login_required
def export_products():
    conn = get_conn(); c = conn.cursor()
    c.execute("""SELECT id, sku, name, unit, price, avg_cost, min_qty, current_qty, created_at, category_id, supplier_id
                 FROM products ORDER BY id""")
    rows = c.fetchall(); conn.close()
    output = io.StringIO(); w = csv.writer(output)
    w.writerow(["id","sku","name","unit","price","avg_cost","min_qty","current_qty","created_at","category_id","supplier_id"])
    for r in rows:
        w.writerow([r["id"], r["sku"], r["name"], r["unit"], r["price"], r["avg_cost"], r["min_qty"], r["current_qty"], r["created_at"], r["category_id"], r["supplier_id"]])
    mem = io.BytesIO(output.getvalue().encode("utf-8"))
    return send_file(mem, mimetype="text/csv", as_attachment=True, download_name="produtos.csv")

@bp_export.get("/movimentos.csv")
@login_required
def export_moves():
    conn = get_conn(); c = conn.cursor()
    c.execute("""SELECT id, product_id, type, quantity, unit_cost, reason, note, ts
                 FROM stock_movements ORDER BY id""")
    rows = c.fetchall(); conn.close()
    output = io.StringIO(); w = csv.writer(output)
    w.writerow(["id","product_id","type","quantity","unit_cost","reason","note","ts"])
    for r in rows:
        w.writerow([r["id"], r["product_id"], r["type"], r["quantity"], r["unit_cost"], r["reason"], r["note"], r["ts"]])
    mem = io.BytesIO(output.getvalue().encode("utf-8"))
    return send_file(mem, mimetype="text/csv", as_attachment=True, download_name="movimentos.csv")
