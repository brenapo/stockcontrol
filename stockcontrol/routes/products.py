import math
from flask import Blueprint, render_template, request, redirect, url_for, flash, abort
from flask_login import login_required, current_user
from ..config import Config
from ..db import get_conn
from ..utils import parse_float, parse_int, now_str
from ..services.inventory import recalc_avg_cost_on_in, find_product

bp = Blueprint("products", __name__)

def role_allowed(*roles):
    return current_user.is_authenticated and current_user.role in roles

@bp.route("/")
@login_required
def index():
    q = (request.args.get("q") or "").strip()
    sort = request.args.get("sort") or "name"
    direction = request.args.get("dir") or "asc"
    page = max(1, parse_int(request.args.get("page"), 1))
    per_page = max(1, parse_int(request.args.get("per_page"), Config.PER_PAGE))
    cat = parse_int(request.args.get("cat") or 0, 0)
    sup = parse_int(request.args.get("sup") or 0, 0)
    offset = (page - 1) * per_page

    sort_map = { "name":"p.name","sku":"p.sku","qty":"p.current_qty","price":"p.price","margin":"(p.price - p.avg_cost)" }
    order_by = sort_map.get(sort, "p.name")
    dir_sql = "DESC" if direction.lower()=="desc" else "ASC"

    where = []; params = []
    if q:
        where.append("(p.name LIKE ? OR p.sku LIKE ?)")
        like = f"%{q}%"; params += [like, like]
    if cat: where.append("p.category_id=?"); params.append(cat)
    if sup: where.append("p.supplier_id=?"); params.append(sup)
    where_sql = "WHERE " + " AND ".join(where) if where else ""

    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT id, name FROM categories ORDER BY name"); cats = c.fetchall()
    c.execute("SELECT id, name FROM suppliers ORDER BY name"); sups = c.fetchall()

    c.execute(f"SELECT COUNT(*) FROM products p {where_sql}", params)
    total = c.fetchone()[0]
    pages = max(1, math.ceil(total / per_page)) if per_page else 1

    c.execute(f"""
        SELECT p.id, p.sku, p.name, p.unit,
               COALESCE(cat.name,'') AS category,
               COALESCE(sup.name,'') AS supplier,
               printf('%.2f', p.price) AS price,
               printf('%.2f', p.avg_cost) AS avg_cost,
               printf('%.2f', p.current_qty) AS current_qty,
               printf('%.2f', p.min_qty) AS min_qty,
               printf('%.2f', (p.price - p.avg_cost)) AS margin_abs,
               CASE WHEN p.price>0 THEN printf('%.2f', 100.0*(p.price - p.avg_cost)/p.price) ELSE printf('%.2f', 0) END AS margin_pct
        FROM products p
        LEFT JOIN categories cat ON cat.id = p.category_id
        LEFT JOIN suppliers sup  ON sup.id = p.supplier_id
        {where_sql}
        ORDER BY {order_by} {dir_sql}, p.id ASC
        LIMIT ? OFFSET ?
    """, (*params, per_page, offset))
    produtos = c.fetchall(); conn.close()

    return render_template("index.html", produtos=produtos, q=q, sort=sort, direction=direction,
                           page=page, pages=pages, per_page=per_page, total=total,
                           cats=cats, sups=sups, cat_sel=cat, sup_sel=sup)

@bp.route("/novo", methods=["GET","POST"])
@login_required
def novo():
    if not role_allowed("admin","operador"):
        flash("Permissão insuficiente para cadastrar.", "error")
        return redirect(url_for("products.index"))

    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT id, name FROM categories ORDER BY name"); cats = c.fetchall()
    c.execute("SELECT id, name FROM suppliers ORDER BY name"); sups = c.fetchall()

    if request.method == "POST":
        sku = (request.form.get("sku") or "").strip()
        name = (request.form.get("name") or "").strip()
        category_id = parse_int(request.form.get("category_id") or 0, 0)
        supplier_id = parse_int(request.form.get("supplier_id") or 0, 0)
        unit = (request.form.get("unit") or "un").strip() or "un"
        price = parse_float(request.form.get("price"), 0.0)
        min_qty = parse_float(request.form.get("min_qty"), 0.0)
        start_qty = parse_float(request.form.get("qty"), 0.0)
        start_cost = parse_float(request.form.get("start_cost"), None)

        if not sku or not name:
            flash("SKU e Nome são obrigatórios.", "error")
            conn.close(); return render_template("novo.html", form=request.form, cats=cats, sups=sups)

        try:
            c.execute("""INSERT INTO products(sku,name,category_id,supplier_id,unit,price,avg_cost,min_qty,current_qty,created_at)
                         VALUES(?,?,?,?,?,?,?,?,?,?)""",
                      (sku, name, category_id or None, supplier_id or None, unit, price, 0.0, min_qty, 0.0, now_str()))
            pid = c.lastrowid
            if start_qty > 0:
                if start_cost is not None:
                    c.execute("UPDATE products SET avg_cost=? WHERE id=?", (start_cost, pid))
                c.execute("""INSERT INTO stock_movements(product_id,type,quantity,unit_cost,reason,note,ts)
                             VALUES(?,?,?,?,?,?,?)""",
                          (pid, "IN", start_qty, start_cost, "Estoque inicial", "", now_str()))
                c.execute("UPDATE products SET current_qty = current_qty + ? WHERE id=?", (start_qty, pid))
            conn.commit()
            if start_qty > 0 and start_cost is not None:
                recalc_avg_cost_on_in(pid, start_qty, start_cost)
            flash("Produto criado com sucesso.", "success")
            return redirect(url_for("products.index"))
        except:
            flash("SKU já existe. Use outro.", "error")
            return render_template("novo.html", form=request.form, cats=cats, sups=sups)
        finally:
            conn.close()

    conn.close()
    return render_template("novo.html", form={}, cats=cats, sups=sups)

@bp.route("/editar/<int:pid>", methods=["GET","POST"])
@login_required
def editar(pid):
    if not role_allowed("admin","operador"):
        flash("Permissão insuficiente para editar.", "error")
        return redirect(url_for("products.index"))

    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT * FROM products WHERE id=?", (pid,))
    p = c.fetchone()
    if not p:
        conn.close(); return abort(404)

    c.execute("SELECT id, name FROM categories ORDER BY name"); cats = c.fetchall()
    c.execute("SELECT id, name FROM suppliers ORDER BY name"); sups = c.fetchall()

    if request.method == "POST":
        sku = (request.form.get("sku") or "").strip()
        name = (request.form.get("name") or "").strip()
        category_id = parse_int(request.form.get("category_id") or 0, 0)
        supplier_id = parse_int(request.form.get("supplier_id") or 0, 0)
        unit = (request.form.get("unit") or "un").strip() or "un"
        price = parse_float(request.form.get("price"), 0.0)
        min_qty = parse_float(request.form.get("min_qty"), 0.0)

        if not sku or not name:
            flash("SKU e Nome são obrigatórios.", "error")
            conn.close(); return render_template("editar.html", p=p, cats=cats, sups=sups)

        try:
            c.execute("""UPDATE products
                         SET sku=?, name=?, category_id=?, supplier_id=?, unit=?, price=?, min_qty=?
                         WHERE id=?""",
                      (sku, name, category_id or None, supplier_id or None, unit, price, min_qty, pid))
            conn.commit(); flash("Produto atualizado.", "success")
            return redirect(url_for("products.index"))
        except:
            flash("SKU já existe em outro produto.", "error")
            return render_template("editar.html", p=p, cats=cats, sups=sups)
        finally:
            conn.close()

    conn.close()
    return render_template("editar.html", p=p, cats=cats, sups=sups)

@bp.post("/excluir/<int:pid>")
@login_required
def excluir(pid):
    if not role_allowed("admin"):
        flash("Permissão insuficiente para excluir.", "error")
        return redirect(url_for("products.index"))
    conn = get_conn(); c = conn.cursor()
    c.execute("DELETE FROM stock_movements WHERE product_id=?", (pid,))
    c.execute("DELETE FROM products WHERE id=?", (pid,))
    conn.commit(); conn.close()
    flash("Produto e histórico removidos.", "success")
    return redirect(url_for("products.index"))

@bp.post("/entrada/<int:pid>")
@login_required
def entrada(pid):
    if not role_allowed("admin","operador"):
        flash("Permissão insuficiente.", "error")
        return redirect(url_for("products.index"))

    qty = parse_float(request.form.get("qtd"), 0)
    unit_cost = request.form.get("unit_cost")
    unit_cost = parse_float(unit_cost, None) if unit_cost not in (None, "") else None
    reason = (request.form.get("reason") or "Compra").strip()
    note = (request.form.get("note") or "").strip()

    if qty <= 0:
        flash("Quantidade deve ser maior que zero.", "error")
        return redirect(url_for("products.index"))

    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT id FROM products WHERE id=?", (pid,))
    if not c.fetchone():
        conn.close(); return abort(404)

    c.execute("""INSERT INTO stock_movements(product_id,type,quantity,unit_cost,reason,note,ts)
                 VALUES(?,?,?,?,?,?,?)""",
              (pid, "IN", qty, unit_cost, reason, note, now_str()))
    c.execute("UPDATE products SET current_qty = current_qty + ? WHERE id=?", (qty, pid))
    conn.commit(); conn.close()

    recalc_avg_cost_on_in(pid, qty, unit_cost)
    flash("Entrada registrada.", "success")
    return redirect(url_for("products.index"))

@bp.post("/saida/<int:pid>")
@login_required
def saida(pid):
    if not role_allowed("admin","operador"):
        flash("Permissão insuficiente.", "error")
        return redirect(url_for("products.index"))

    qty = parse_float(request.form.get("qtd"), 0)
    reason = (request.form.get("reason") or "Venda").strip()
    note = (request.form.get("note") or "").strip()

    if qty <= 0:
        flash("Quantidade deve ser maior que zero.", "error")
        return redirect(url_for("products.index"))

    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT current_qty FROM products WHERE id=?", (pid,))
    row = c.fetchone()
    if not row:
        conn.close(); return abort(404)
    if qty > float(row["current_qty"] or 0):
        conn.close(); flash("Estoque insuficiente.", "error")
        return redirect(url_for("products.index"))

    c.execute("""INSERT INTO stock_movements(product_id,type,quantity,unit_cost,reason,note,ts)
                 VALUES(?,?,?,?,?,?,?)""",
              (pid, "OUT", qty, None, reason, note, now_str()))
    c.execute("UPDATE products SET current_qty = current_qty - ? WHERE id=?", (qty, pid))
    conn.commit(); conn.close()
    flash("Saída registrada.", "success")
    return redirect(url_for("products.index"))

@bp.get("/produto/<int:pid>")
@login_required
def produto(pid):
    start = (request.args.get("start") or "").strip()
    end = (request.args.get("end") or "").strip()
    p = find_product(pid)
    if not p: return abort(404)

    conn = get_conn(); c = conn.cursor()
    where = "WHERE product_id=?"; params = [pid]
    if start: where += " AND date(ts) >= date(?)"; params.append(start)
    if end:   where += " AND date(ts) <= date(?)"; params.append(end)
    c.execute(f"""SELECT id, ts, type, quantity, unit_cost, reason, note
                  FROM stock_movements {where} ORDER BY ts DESC""", params)
    movs = c.fetchall(); conn.close()
    return render_template("produto.html", p=p, movs=movs, start=start, end=end)
