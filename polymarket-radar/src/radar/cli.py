"""Línea de comandos: ``radar <comando>``.

Comandos:
  db-upgrade         aplica las migraciones de Alembic
  check              verifica base de datos y conectividad con Gamma y CLOB
  ingest             ejecuta una corrida de ingesta manual
  report             genera el reporte Markdown de una corrida
  status             muestra la última corrida
  scheduler          ingesta programada cada RADAR_SCHEDULE_INTERVAL_MINUTES
  api                levanta el backend FastAPI
  dashboard          levanta el dashboard Streamlit
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import socket
import subprocess
import sys
from pathlib import Path

from radar.config import get_settings
from radar.logging_setup import configure_logging, get_logger

log = get_logger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _settings_with_overrides(args: argparse.Namespace):  # type: ignore[no-untyped-def]
    settings = get_settings()
    overrides = {}
    if getattr(args, "max_pages", None) is not None:
        overrides["gamma_max_pages"] = args.max_pages
    return settings.model_copy(update=overrides) if overrides else settings


def cmd_db_upgrade(args: argparse.Namespace) -> int:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(PROJECT_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(PROJECT_ROOT / "migrations"))
    cfg.attributes["database_url"] = get_settings().database_url
    command.upgrade(cfg, args.revision)
    print(f"migraciones aplicadas hasta {args.revision}")
    return 0


def cmd_prune(args: argparse.Namespace) -> int:
    from radar.db.session import get_engine
    from radar.retention import prune

    settings = get_settings()
    out = prune(
        get_engine(settings.database_url),
        live_days=settings.retention_live_days,
        snapshot_days=settings.retention_snapshot_days,
    )
    print(json.dumps(out, ensure_ascii=False))
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    from radar.connectivity import check_all

    result = check_all(get_settings())
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if all(v["ok"] for v in result.values()) else 1


def cmd_ingest(args: argparse.Namespace) -> int:
    from radar.db.session import get_engine
    from radar.ingestion.pipeline import RunAlreadyInProgressError, run_ingestion

    settings = _settings_with_overrides(args)
    engine = get_engine(settings.database_url)
    try:
        run_id = run_ingestion(engine, settings, trigger=args.trigger)
    except RunAlreadyInProgressError as exc:
        print(f"no se inició: {exc}", file=sys.stderr)
        return 2
    _print_run(run_id)
    if args.report:
        return cmd_report(argparse.Namespace(run_id=run_id, out=args.report_dir))
    return 0


def _print_run(run_id: int | None) -> int:
    from sqlalchemy.orm import Session

    from radar import queries
    from radar.db.models import IngestionRun
    from radar.db.session import get_engine

    with Session(get_engine()) as session:
        run = session.get(IngestionRun, run_id) if run_id else queries.latest_run(session)
        if run is None:
            print("Información insuficiente: no hay corridas registradas.")
            return 1
        data = queries.run_to_dict(run)
    print(json.dumps(data, indent=2, ensure_ascii=False, default=str))
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    return _print_run(None)


def cmd_report(args: argparse.Namespace) -> int:
    from sqlalchemy.orm import Session

    from radar import queries
    from radar.db.models import IngestionRun
    from radar.db.session import get_engine
    from radar.reports import build_run_report, default_report_name

    settings = get_settings()
    with Session(get_engine()) as session:
        run = (
            session.get(IngestionRun, args.run_id)
            if args.run_id
            else queries.latest_run(session, finished_only=True)
        )
        if run is None:
            print("Información insuficiente: no hay corridas registradas.", file=sys.stderr)
            return 1
        text = build_run_report(session, settings, run)
        if args.out == "-":
            print(text)
            return 0
        out_dir = Path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / default_report_name(run)
    path.write_text(text, encoding="utf-8")
    print(f"reporte escrito en {path}")
    return 0


def cmd_scheduler(args: argparse.Namespace) -> int:
    from radar.scheduler import run_scheduler

    run_scheduler(get_settings())
    return 0


def dual_stack_socket(port: int) -> socket.socket:
    """Socket en "::" que acepta IPv4 e IPv6.

    Con host="::", asyncio deja IPV6_V6ONLY activo y el servidor no responde por IPv4."""
    sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    sock.bind(("::", port))
    return sock


def cmd_api(args: argparse.Namespace) -> int:
    import uvicorn

    if args.host == "::":
        server = uvicorn.Server(uvicorn.Config("radar.api.main:app", log_level="info"))
        server.run(sockets=[dual_stack_socket(args.port)])
        return 0
    uvicorn.run("radar.api.main:app", host=args.host, port=args.port, log_level="info")
    return 0


def check_api(base_url: str, attempts: int = 10, wait_s: float = 3.0) -> bool:
    """Registra si el backend responde; el dashboard arranca igual si no responde."""
    import time

    import httpx

    url = f"{base_url.rstrip('/')}/api/health"
    error = ""
    for _ in range(attempts):
        try:
            r = httpx.get(url, timeout=5)
            log.info("api_check", url=url, status=r.status_code)
            return r.status_code == 200
        except httpx.HTTPError as exc:
            error = f"{type(exc).__name__}: {exc}"
            time.sleep(wait_s)
    log.error("api_check_failed", url=url, error=error)
    return False


def cmd_dashboard(args: argparse.Namespace) -> int:
    app = Path(__file__).resolve().parent / "dashboard" / "app.py"
    cmd = [
        sys.executable,
        "-m",
        "streamlit",
        "run",
        str(app),
        "--server.port",
        str(args.port),
        "--server.address",
        args.host,
        "--server.headless",
        "true",
        "--browser.gatherUsageStats",
        "false",
        # Tema oscuro (ver radar.dashboard.theme)
        "--theme.base",
        "dark",
        "--theme.primaryColor",
        "#6fbf73",
        "--theme.backgroundColor",
        "#0a0e0c",
        "--theme.secondaryBackgroundColor",
        "#1b1e1a",
        "--theme.textColor",
        "#f1f1ec",
    ]
    return subprocess.call(cmd, env=os.environ.copy())  # noqa: S603 - argumentos fijos


def cmd_serve(args: argparse.Namespace) -> int:
    """Arranque en contenedor según RADAR_ROLE (api | dashboard | scheduler) y PORT.

    El scheduler aplica las migraciones antes de empezar: es el único que las corre."""
    role = os.environ.get("RADAR_ROLE", "api")
    port = os.environ.get("PORT")
    if role == "scheduler":
        code = cmd_db_upgrade(argparse.Namespace(revision="head"))
        return code or cmd_scheduler(args)
    if role == "dashboard":
        # En el contenedor el dashboard es lo único expuesto, detrás de la contraseña.
        dash = argparse.Namespace(host="0.0.0.0", port=int(port or 8501))  # noqa: S104
        check_api(os.environ.get("RADAR_API_BASE_URL", "http://localhost:8000"))
        return cmd_dashboard(dash)
    if role == "api":
        # "::" con socket doble: IPv4 e IPv6 (red privada de Railway).
        return cmd_api(argparse.Namespace(host="::", port=int(port or 8000)))
    print(f"RADAR_ROLE desconocido: {role}", file=sys.stderr)
    return 2


def cmd_elections(args: argparse.Namespace) -> int:
    from radar.db.session import get_engine
    from radar.elections import service

    settings = get_settings()
    engine = get_engine(settings.database_url)
    out_dir = Path(args.out)
    if args.elections_command == "discover":
        run_id, summary = service.run_discovery(engine)
        print(json.dumps({"run_id": run_id, **summary}, indent=2, ensure_ascii=False))
    elif args.elections_command == "calibrate":
        build = service.build_calibration(settings)
        from dataclasses import asdict

        from radar.elections.models import validate_loo

        out = {
            "contiendas": [c.key for c in build.contests],
            "problemas": build.issues,
            "validacion_ponderado": asdict(validate_loo(build.contests, "weighted")),
        }
        out["validacion_ponderado"].pop("forecasts")
        print(json.dumps(out, indent=2, ensure_ascii=False, default=str))
    elif args.elections_command == "backtest":
        result = service.run_br2026_backtest(engine, settings, out_dir)
        print(json.dumps(service.summarize_backtest(result), indent=2, ensure_ascii=False))
    elif args.elections_command == "evaluate":
        out = service.run_world_evaluation(engine, settings, out_dir)
        print(json.dumps(out["agregado"], indent=2, ensure_ascii=False, default=str))
    elif args.elections_command == "scan":
        print(
            json.dumps(
                service.run_live_scan(engine, settings), indent=2, ensure_ascii=False, default=str
            )
        )
    elif args.elections_command == "verify-ledger":
        from radar.elections.alerts import AlertLedger, verify_chain

        recs = AlertLedger(Path(args.path)).records()
        problems = verify_chain(recs)
        print(json.dumps({"registros": len(recs), "problemas": problems}, ensure_ascii=False))
        return 1 if problems else 0
    return 0


def cmd_predict(args: argparse.Namespace) -> int:
    from datetime import UTC, datetime

    from radar.db.session import get_engine
    from radar.predict import service

    settings = get_settings()
    if args.predict_command == "collect":
        start = datetime.fromisoformat(args.start).replace(tzinfo=UTC)
        end = datetime.fromisoformat(args.end).replace(tzinfo=UTC)
        meta = service.collect_crypto_dataset(settings, start, end)
        print(json.dumps(meta, indent=2, ensure_ascii=False, default=str))
        return 0
    if args.predict_command == "backtest-v2":
        report = service.run_crypto_backtest_v2(
            settings, out_dir=Path(args.out), evaluate_test=args.prueba
        )
        print(
            json.dumps(
                {k: report[k] for k in ("version", "counts", "params_v2_sha256")}
                | {"params_v2": report["params_v2"]},
                indent=2,
                ensure_ascii=False,
            )
        )
        return 0
    engine = get_engine(settings.database_url)
    if args.predict_command == "backtest":
        run_id = service.start_run(engine, "backtest")
        try:
            report = service.run_crypto_backtest(settings, out_dir=Path(args.out))
            n = service.persist_evaluations(engine, run_id, report)
        except Exception as exc:
            service.finish_run(engine, run_id, "failed", {"error": repr(exc)})
            raise
        summary = service.backtest_summary(report) | {"evaluaciones_guardadas": n}
        service.finish_run(
            engine, run_id, "success", summary, str(Path(args.out) / "backtest_cripto.md")
        )
        print(json.dumps(summary, indent=2, ensure_ascii=False, default=str))
    elif args.predict_command == "live":
        out = service.predict_live(settings, engine, max_markets=args.max_markets)
        print(json.dumps(out, indent=2, ensure_ascii=False, default=str))
    elif args.predict_command == "forward":
        from radar.predict import forward

        print(json.dumps(forward.update(settings, engine), indent=2, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="radar", description="Polymarket AI Radar (solo lectura)")
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("db-upgrade", help="aplica migraciones")
    s.add_argument("revision", nargs="?", default="head")
    s.set_defaults(func=cmd_db_upgrade)

    s = sub.add_parser("serve", help="arranque en contenedor según RADAR_ROLE y PORT")
    s.set_defaults(func=cmd_serve)

    s = sub.add_parser("prune", help="borra datos voluminosos viejos (ver radar.retention)")
    s.set_defaults(func=cmd_prune)

    s = sub.add_parser("check", help="verifica base de datos y APIs")
    s.set_defaults(func=cmd_check)

    s = sub.add_parser("ingest", help="corrida manual de ingesta")
    s.add_argument("--max-pages", type=int, default=None, help="tope de páginas de Gamma")
    s.add_argument("--trigger", default="manual", choices=["manual", "scheduled"])
    s.add_argument("--report", action="store_true", help="escribe el reporte al terminar")
    s.add_argument("--report-dir", default="reports")
    s.set_defaults(func=cmd_ingest)

    s = sub.add_parser("report", help="reporte Markdown de una corrida")
    s.add_argument("--run-id", type=int, default=None)
    s.add_argument("--out", default="reports", help="directorio de salida, o '-' para stdout")
    s.set_defaults(func=cmd_report)

    s = sub.add_parser("status", help="última corrida")
    s.set_defaults(func=cmd_status)

    s = sub.add_parser("scheduler", help="ingesta programada")
    s.set_defaults(func=cmd_scheduler)

    s = sub.add_parser("api", help="backend FastAPI")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    s.set_defaults(func=cmd_api)

    s = sub.add_parser("elections", help="motor de discrepancias electorales")
    esub = s.add_subparsers(dest="elections_command", required=True)
    esub.add_parser("discover", help="clasifica los mercados electorales abiertos")
    esub.add_parser("calibrate", help="calibración y validación con contiendas históricas")
    esub.add_parser("backtest", help="backtest retrospectivo de Brasil 2026 (2.ª vuelta)")
    esub.add_parser("evaluate", help="evaluación sobre múltiples elecciones")
    esub.add_parser("scan", help="escaneo en vivo de contiendas configuradas")
    v = esub.add_parser("verify-ledger", help="verifica la cadena de hashes de un ledger")
    v.add_argument("path")
    s.add_argument("--out", default="reports")
    s.set_defaults(func=cmd_elections)

    s = sub.add_parser("predict", help="modelos predictivos (cripto, elecciones, abstenciones)")
    s.add_argument("--out", default="reports", help="carpeta de reportes")
    psub = s.add_subparsers(dest="predict_command", required=True)
    c = psub.add_parser("collect", help="conjunto de mercados cripto resueltos")
    c.add_argument("--start", default="2026-05-01")
    c.add_argument("--end", default="2026-10-26")
    psub.add_parser("backtest", help="ajuste, validación y prueba de los modelos cripto")
    b2 = psub.add_parser("backtest-v2", help="ajuste de cripto2-vol (PREREGISTRO_CRIPTO_V2)")
    b2.add_argument("--prueba", action="store_true", help="mide la partición de prueba (una vez)")
    lv = psub.add_parser("live", help="predice y valora los mercados abiertos")
    lv.add_argument("--max-markets", type=int, default=None)
    psub.add_parser(
        "forward", help="evaluación en vivo y cartera de papel (docs/PREREGISTRO_VIVO.md)"
    )
    s.set_defaults(func=cmd_predict)

    s = sub.add_parser("dashboard", help="dashboard Streamlit")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8501)
    s.set_defaults(func=cmd_dashboard)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = get_settings()  # valida la configuración (incluido el modo papel)
    configure_logging(settings.log_level)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
