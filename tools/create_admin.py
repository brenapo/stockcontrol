# tools/create_admin.py
import os, sys, traceback
from werkzeug.security import generate_password_hash

print(">>> create_admin: start", flush=True)

# Garante que a raiz do projeto (pai de tools/) está no sys.path
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)
print(f">>> PROJECT_ROOT = {PROJECT_ROOT}", flush=True)

# Importa a factory
try:
    from app import create_app
    print(">>> usando create_app de app.py", flush=True)
except Exception as e:
    print("!!! falhou import create_app de app.py")
    traceback.print_exc()
    sys.exit(1)

# Importa db e User (ajuste aqui se seu layout for diferente)
db = None
User = None
last_err = None
for path in [
    ("stockcontrol", "db", "stockcontrol.models", "User"),
    ("stockcontrol", "db", "stockcontrol", "User"),            # se User estiver em __init__
    ("app", "db", "app", "User"),                              # fallback raro
]:
    try:
        pkg_db_mod, db_attr, pkg_user_mod, user_cls = path
        mod_db = __import__(pkg_db_mod, fromlist=[db_attr])
        db = getattr(mod_db, db_attr)
        mod_user = __import__(pkg_user_mod, fromlist=[user_cls])
        User = getattr(mod_user, user_cls)
        print(f">>> db= {pkg_db_mod}.{db_attr}  |  User= {pkg_user_mod}.{user_cls}", flush=True)
        break
    except Exception as e:
        last_err = e

if db is None or User is None:
    print("!!! não consegui importar db/User automaticamente")
    if last_err:
        traceback.print_exc()
    sys.exit(1)

app = create_app()
with app.app_context():
    try:
        # Se o banco ainda não existe/tabelas vazias, tenta criar
        try:
            db.create_all()
            print(">>> db.create_all() executado (ok se já existiam tabelas)", flush=True)
        except Exception as e:
            print(">>> db.create_all() não necessário ou falhou (provavelmente usa Migrate). Ignorando.", flush=True)

        u = User.query.filter_by(username="admin").first()
        if not u:
            u = User(username="admin", role="admin")
            u.password_hash = generate_password_hash("admin")
            db.session.add(u)
            db.session.commit()
            print(">>> Admin CRIADO: admin / admin", flush=True)
        else:
            u.password_hash = generate_password_hash("admin")
            # garante role admin
            if hasattr(u, "role"):
                u.role = "admin"
            db.session.commit()
            print(">>> Admin ATUALIZADO: admin / admin", flush=True)

        # Sanity check
        count = User.query.count()
        print(f">>> Users na base: {count}", flush=True)

    except Exception as e:
        print("!!! erro ao criar/atualizar admin")
        traceback.print_exc()
        sys.exit(1)

print(">>> create_admin: done", flush=True)
