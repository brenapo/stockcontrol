from datetime import datetime

def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def parse_float(s, default=0.0):
    if s is None: return default
    s = str(s).strip().replace("R$", "").replace(".", "").replace(",", ".")
    try: return float(s)
    except: return default

def parse_int(s, default=0):
    if s is None: return default
    try: return int(s)
    except: return default
