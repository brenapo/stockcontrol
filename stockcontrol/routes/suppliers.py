from flask import Blueprint, render_template, request, redirect, url_for, flash
from flask_login import login_required, current_user
from ..db import get_conn

bp = Blueprint("suppliers", __name__, url_prefix="/fornecedores")

def role_ok(): return current_user.is_authenticated and current_user.role in ["admin","operador"]

@bp.route("/", methods=["GET","POST"])
@login_required
def view():
    conn = get_conn(); c = conn.cursor()
    if request.method == "POST":
        if not role_ok():
            flash("Permissão insuficiente.", "error")
        else:
            name = (request.form.get("name") or "").strip()
            contact = (request.form.get("contact") or "").strip()
            if not name:
                flash("Nome do fornecedor é obrigatório.", "error")
            else:
                try:
                    c.execute("INSERT INTO suppliers(name,contact) VALUES(?,?)", (name, contact))
                    conn.commit(); flash("Fornecedor criado.", "success")
                except:
                    flash("Fornecedor já existe.", "error")
    q = (request.args.get("q") or "").strip()
    if q:
        like = f"%{q}%"
        c.execute("SELECT id,name,COALESCE(contact,'') contact FROM suppliers WHERE name LIKE ? OR contact LIKE ? ORDER BY name", (like, like))
    else:
        c.execute("SELECT id,name,COALESCE(contact,'') contact FROM suppliers ORDER BY name")
    sups = c.fetchall(); conn.close()
    return render_template("fornecedores.html", sups=sups, q=q)

@bp.post("/excluir/<int:sid>")
@login_required
def delete(sid):
    if current_user.role != "admin":
        flash("Apenas admin pode remover.", "error")
        return redirect(url_for("suppliers.view"))
    conn = get_conn(); c = conn.cursor()
    c.execute("DELETE FROM suppliers WHERE id=?", (sid,))
    conn.commit(); conn.close()
    flash("Fornecedor removido.", "success")
    return redirect(url_for("suppliers.view"))
