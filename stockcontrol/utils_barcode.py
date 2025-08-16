# stockcontrol/utils_barcode.py
import re

def _only_digits(s: str) -> str:
    return re.sub(r"\D+", "", s or "")

def normalize_ean13(code: str) -> str:
    """
    Remove caracteres não-numéricos e normaliza:
      - Se vier com 12 dígitos (UPC-A), prefixa '0' => EAN-13.
      - Exige exatamente 13 dígitos após normalização.
    """
    d = _only_digits(code)
    if len(d) == 12:
        d = "0" + d  # UPC-A -> EAN-13
    if len(d) != 13:
        raise ValueError("EAN-13 deve ter 13 dígitos (aceita UPC-A de 12; será normalizado com zero à esquerda).")
    return d

def calc_ean13_check(d12: str) -> str:
    """
    Calcula o dígito verificador do EAN-13 a partir dos 12 primeiros dígitos.
    """
    if len(d12) != 12 or not d12.isdigit():
        raise ValueError("Para calcular o DV, informe exatamente 12 dígitos.")
    soma = 0
    # posições 1..12 (1-based): ímpares *1, pares *3
    for i, ch in enumerate(d12, start=1):
        n = ord(ch) - 48
        soma += n if (i % 2 == 1) else 3 * n
    dv = (10 - (soma % 10)) % 10
    return str(dv)

def validate_and_normalize_ean13(code: str) -> str:
    """
    Retorna o EAN-13 normalizado (13 dígitos) se o DV estiver correto.
    Lança ValueError com mensagem explicativa em caso de erro.
    """
    norm = normalize_ean13(code)
    expected = calc_ean13_check(norm[:12])
    got = norm[-1]
    if got != expected:
        raise ValueError(f"Dígito verificador inválido (esperado {expected}, recebido {got}).")
    return norm
