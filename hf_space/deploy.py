# -*- coding: utf-8 -*-
"""
Despliegue del Space estático en Hugging Face.

⚠️ ESTE SPACE ES PRIVADO POR DEFECTO. Contiene proyecciones de matrícula por
   asignatura y sede de la institución. Publicarlo requiere autorización de la Dirección:
   por eso hay que pasar --publico explícitamente, y el script vuelve a preguntar.

Requisitos:
    pip install huggingface_hub

Autenticación (elige una):
    a) huggingface-cli login            <- recomendado, guarda el token en ~/.cache/huggingface
    b) set HF_TOKEN=hf_xxx              <- variable de entorno

El token debe tener permiso de ESCRITURA.
NUNCA pegues el token como argumento en la línea de comandos: queda en el historial.

Uso:
    python exporta_datos.py                       <- primero, regenera data/
    python deploy.py --dry-run                    <- valida sin subir
    python deploy.py --repo TU_USUARIO/proyeccion-asignaturas
"""
import argparse
import os
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
ARCHIVOS_MINIMOS = ["index.html", "styles.css", "i18n.js", "charts.js", "app.js",
                    "README.md", "data/dashboard.json", "data/serie.json",
                    "data/celdas.json"]
IGNORAR = ["deploy.py", "exporta_datos.py", "__pycache__/*", "*.pyc", ".DS_Store"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="proyeccion-demanda-asignaturas",
                    help="nombre del Space, o usuario/nombre.")
    ap.add_argument("--publico", action="store_true",
                    help="⚠️ crear el Space PÚBLICO. Requiere autorización de la Dirección.")
    ap.add_argument("--dry-run", action="store_true", help="sólo validar, no subir")
    ap.add_argument("--message", default="Actualiza el dashboard de proyección")
    a = ap.parse_args()

    if a.repo.count("/") > 1:
        sys.exit("ERROR: el id del Space admite a lo más un '/' (usuario/nombre).")
    mal = set(a.repo.replace("/", "")) - set("abcdefghijklmnopqrstuvwxyz"
                                             "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")
    if mal:
        sys.exit(f"ERROR: el id del Space sólo admite letras sin tilde, números, '-', '_' y '.'.\n"
                 f"       Caracteres no válidos: {sorted(mal)}\n"
                 f"       El título con espacios y acentos va en el campo 'title' del README.")

    # --- validación local antes de tocar la red ---
    print("Validando contenido local…")
    faltan = [f for f in ARCHIVOS_MINIMOS if not (AQUI / f).exists()]
    if faltan:
        sys.exit(f"ERROR: faltan archivos: {faltan}\n"
                 f"       Ejecuta antes:  python exporta_datos.py")

    cab = (AQUI / "README.md").read_text(encoding="utf-8").lstrip()
    if not cab.startswith("---") or "sdk: static" not in cab.split("---")[1]:
        sys.exit("ERROR: README.md debe empezar con el frontmatter YAML de HF y declarar 'sdk: static'")

    total = 0
    for f in sorted(AQUI.rglob("*")):
        if f.is_file() and "__pycache__" not in str(f) and f.name not in ("deploy.py", "exporta_datos.py"):
            kb = f.stat().st_size / 1024
            total += kb
            print(f"  {f.relative_to(AQUI).as_posix():<34s} {kb:>9,.0f} KB")
    print(f"  {'TOTAL':<34s} {total:>9,.0f} KB")

    if a.dry_run:
        print("\n[--dry-run] validación OK, no se subió nada.")
        return

    try:
        from huggingface_hub import HfApi, create_repo
    except ImportError:
        sys.exit("ERROR: falta huggingface_hub.  pip install huggingface_hub")

    token = os.environ.get("HF_TOKEN")     # si es None, usa el login guardado
    api = HfApi(token=token)
    try:
        usuario = api.whoami().get("name")
    except Exception as e:
        sys.exit(f"ERROR de autenticación: {e}\n"
                 f"       Ejecuta 'huggingface-cli login' con un token de ESCRITURA.")

    repo = a.repo if "/" in a.repo else f"{usuario}/{a.repo}"
    print(f"\nAutenticado como: {usuario}")
    print(f"Destino: {repo}  ·  {'PÚBLICO' if a.publico else 'PRIVADO'}  ·  sdk=static")

    # Doble confirmación para lo público: son datos internos de la universidad.
    if a.publico:
        print("\n  ⚠️  Vas a publicar proyecciones de matrícula por asignatura y sede de la institución.")
        print("      Un Space público queda indexado por buscadores casi de inmediato.")
        if input("      Escribe PUBLICAR para confirmar: ").strip() != "PUBLICAR":
            sys.exit("Cancelado.")
    elif input("¿Continuar? [s/N] ").strip().lower() not in ("s", "si", "sí", "y", "yes"):
        sys.exit("Cancelado por el usuario.")

    create_repo(repo_id=repo, repo_type="space", space_sdk="static",
                private=not a.publico, exist_ok=True, token=token)
    print("Subiendo archivos…")
    api.upload_folder(folder_path=str(AQUI), repo_id=repo, repo_type="space",
                      commit_message=a.message, ignore_patterns=IGNORAR)
    print(f"\nListo → https://huggingface.co/spaces/{repo}")
    print("El Space estático queda disponible en menos de un minuto.")
    if not a.publico:
        print("Es PRIVADO: sólo tú (y quien invites desde Settings) puede verlo.")


if __name__ == "__main__":
    main()
