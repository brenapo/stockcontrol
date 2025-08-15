from flask import Blueprint, render_template, request, redirect, url_for, flash
from flask_login import login_required, current_user
from ..db import get_conn

bp = Blueprint("categories", __name__, url_prefix="/categorias")

def role_ok(): return current_user.is_authenticated and current_user.role in ["admin","operador"]

@bp.route("/", methods=["GET","POST"])
@login_required
def view():
    if request.method == "POST":
        if not role_ok():
            flash("Permissão insuficiente.", "error")
            return redirect(url_for("categories.view"))
        name = (request.form.get("name") or "").strip()
        conn = get_conn(); c = conn.cursor()
        if not name:
            flash("Nome da categoria é obrigatório.", "error")
        else:
            try:
                c.execute("INSERT INTO categories(name) VALUES(?)", (name,))
                conn.commit(); flash("Categoria criada.", "success")
            except:
                flash("Categoria já existe.", "error")
        conn.close()
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT id, name FROM categories ORDER BY name")
    cats = c.fetchall(); conn.close()
    return render_template("categorias.html", cats=cats)

@bp.post("/excluir/<int:cid>")
@login_required
def delete(cid):
    if current_user.role != "admin":
        flash("Apenas admin pode remover.", "error")
        return redirect(url_for("categories.view"))
    conn = get_conn(); c = conn.cursor()
    c.execute("DELETE FROM categories WHERE id=?", (cid,))
    conn.commit(); conn.close()
    flash("Categoria removida.", "success")
    return redirect(url_for("categories.view"))
