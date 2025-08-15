# tools/smoke_test.py
import os, sys, re


print(">>> iniciando smoke_test", flush=True)

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)
    print(f">>> PROJECT_ROOT adicionado ao sys.path: {PROJECT_ROOT}", flush=True)

from app import create_app

def hit(client, method, path, expect=(200, 302), **kwargs):
    m = getattr(client, method.lower())
    r = m(path, **kwargs)
    ok = r.status_code in (expect if isinstance(expect, (list, tuple, set)) else (expect,))
    print(f"{method:6} {path:35} -> {r.status_code}{' OK' if ok else ' !!'}", flush=True)
    if not ok:
        # ajuda a debugar rapidamente
        try:
            txt = r.get_data(as_text=True)
            print(txt[:500], flush=True)
        except Exception:
            pass
    return r

app = create_app()
# desliga CSRF só aqui no client de teste
app.config.update(TESTING=True, WTF_CSRF_ENABLED=False)

with app.app_context():
    with app.test_client() as client:
        # LOGIN
        hit(client, "GET", "/login", expect=200)
        hit(client, "POST", "/login",
        data={"username": "admin", "password": "admin123"},
        follow_redirects=True,
        expect=(200, 302))



        # GETs principais (devem responder 200 logado)
        for path in [
            "/", "/novo",
            "/categorias/", "/fornecedores/", "/usuarios/",
            "/relatorios/baixo-estoque", "/relatorios/valorizacao",
            "/export/produtos.csv", "/export/movimentos.csv",
            "/produto/1", "/editar/1",
        ]:
            hit(client, "GET", path, expect=(200, 404))  # /produto/1 pode não existir -> 404 aceitável

        # Logout
        hit(client, "POST", "/logout", follow_redirects=True, expect=(200, 302))

print(">>> smoke_test finalizado", flush=True)
